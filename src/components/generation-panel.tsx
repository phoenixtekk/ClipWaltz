"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Wand2,
  Sparkles,
  ImageIcon,
  Loader2,
  X,
  ChevronDown,
  Play,
  Star,
  Check,
  Film,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { AssetSummary } from "@/lib/assets";
import {
  createGenerationJob,
  getGenerationJob,
  cancelGenerationJob,
  listGenerationVersions,
  type GenerationVersionItem,
} from "@/lib/generation-actions";

// Wan 2.2 TI2V-5B drives both modes. Image→video needs a source photo; text→video needs a prompt.
const WORKFLOW_I2V = "wan-image-to-video-v1";
const WORKFLOW_T2V = "wan-text-to-video-v1";

// §9 Style chips + §9 Camera picker. There are no dedicated backend fields for these, so the
// chosen phrases are folded into the prompt text (see buildPrompt) — kept simple and documented.
const STYLES: { key: string; label: string; phrase: string }[] = [
  { key: "cinematic", label: "Cinematic", phrase: "cinematic style" },
  { key: "commercial", label: "Commercial", phrase: "polished commercial style" },
  { key: "documentary", label: "Documentary", phrase: "documentary style" },
  { key: "social", label: "Social", phrase: "vibrant social-media style" },
  { key: "action", label: "Action", phrase: "high-energy action style" },
  { key: "dreamlike", label: "Dreamlike", phrase: "dreamlike, surreal style" },
];
const CAMERAS: { key: string; label: string; phrase: string }[] = [
  { key: "static", label: "Static", phrase: "static camera" },
  { key: "push", label: "Push In", phrase: "camera slowly pushing in" },
  { key: "pull", label: "Pull Back", phrase: "camera pulling back" },
  { key: "orbit", label: "Orbit", phrase: "orbiting camera" },
  { key: "pan", label: "Pan", phrase: "panning camera" },
  { key: "tracking", label: "Tracking", phrase: "tracking camera" },
  { key: "handheld", label: "Handheld", phrase: "handheld camera" },
  { key: "drone", label: "Drone", phrase: "aerial drone shot" },
];

// §9 Motion slider: subtle ── balanced ── dynamic.
const MOTIONS = ["subtle", "balanced", "dynamic"] as const;
type Motion = (typeof MOTIONS)[number];

// §9 Duration pills. The backend currently uses a fixed clip length, but we pass durationSec for
// forward-compat (documented in the task brief).
const DURATIONS = [3, 5, 8] as const;

// §9 Aspect icons → width/height passed to createGenerationJob (all divisible by 16).
const ASPECTS: { key: string; label: string; w: number; h: number; box: string }[] = [
  { key: "16:9", label: "Landscape", w: 1280, h: 720, box: "h-6 w-10" },
  { key: "9:16", label: "Portrait", w: 720, h: 1280, box: "h-10 w-6" },
  { key: "1:1", label: "Square", w: 768, h: 768, box: "h-8 w-8" },
];

// §9 Quality cards. There is no backend field for quality yet, so this is a UI-only hint for now.
const QUALITIES: { key: string; label: string; note: string }[] = [
  { key: "preview", label: "Preview", note: "Fastest draft" },
  { key: "standard", label: "Standard", note: "Balanced" },
  { key: "high", label: "High", note: "Best detail" },
];

// §11 status → friendly phase name.
const PHASE: Record<string, string> = {
  queued: "Queued",
  preparing: "Preparing your scene",
  uploading_to_ai_node: "Sending to the studio",
  loading_model: "Loading AI model",
  generating: "Building motion",
  enhancing: "Enhancing detail",
  encoding: "Encoding video",
  uploading_output: "Finishing up",
};
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

type Job = {
  id: string;
  status: string;
  progress: number;
  errorMessage: string | null;
};

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function GenerationPanel({
  projectId,
  photos,
}: {
  projectId: string;
  photos: AssetSummary[];
}) {
  // Create-panel state
  const [mode, setMode] = useState<"image" | "text">(photos.length ? "image" : "text");
  const [sourceAssetId, setSourceAssetId] = useState<string | null>(photos[0]?.id ?? null);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [styleKey, setStyleKey] = useState<string | null>("cinematic");
  const [cameraKey, setCameraKey] = useState<string | null>("push");
  const [motionIdx, setMotionIdx] = useState(1); // balanced
  const [durationSec, setDurationSec] = useState<number>(5);
  const [aspectKey, setAspectKey] = useState("16:9");
  const [qualityKey, setQualityKey] = useState("standard");
  const [seed, setSeed] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Job + versions state
  const [job, setJob] = useState<Job | null>(null);
  const [pending, start] = useTransition();
  const [versions, setVersions] = useState<GenerationVersionItem[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const refreshVersions = useCallback(async () => {
    try {
      const list = await listGenerationVersions(projectId);
      setVersions(list);
      return list;
    } catch {
      /* transient — leave the current list in place */
      return null;
    }
  }, [projectId]);

  // Initial versions load.
  useEffect(() => {
    void refreshVersions();
  }, [refreshVersions]);

  // §11 poll the active job every ~3s until it reaches a terminal state.
  useEffect(() => {
    if (!job || TERMINAL.has(job.status)) return;
    const t = setInterval(async () => {
      try {
        const next = await getGenerationJob(job.id);
        setJob({
          id: next.id,
          status: next.status,
          progress: next.progress ?? 0,
          errorMessage: next.errorMessage ?? null,
        });
        if (next.status === "completed") {
          const list = await refreshVersions();
          const newest = list?.find((v) => v.jobId === next.id) ?? list?.[0];
          if (newest) setSelectedVersionId(newest.id);
          toast.success("Your clip is ready.");
        } else if (next.status === "failed") {
          toast.error(next.errorMessage || "Generation failed.");
        }
      } catch {
        /* transient — keep polling */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [job, refreshVersions]);

  const isGenerating = !!job && !TERMINAL.has(job.status);

  // Fold the style + camera choices into the prompt (no separate backend fields for them).
  function buildPrompt(): string {
    const parts = [prompt.trim()];
    const style = STYLES.find((s) => s.key === styleKey);
    const camera = CAMERAS.find((c) => c.key === cameraKey);
    if (style) parts.push(style.phrase);
    if (camera) parts.push(camera.phrase);
    return parts.filter(Boolean).join(", ");
  }

  function generate() {
    if (mode === "image" && !sourceAssetId) {
      toast.error("Pick a source photo first.");
      return;
    }
    if (mode === "text" && !prompt.trim()) {
      toast.error("Describe the video you want to create.");
      return;
    }
    const aspect = ASPECTS.find((a) => a.key === aspectKey)!;
    const seedNum = seed.trim() === "" ? null : Number.parseInt(seed.trim(), 10);
    if (seedNum != null && !Number.isFinite(seedNum)) {
      toast.error("Seed must be a whole number (leave blank for random).");
      return;
    }
    start(async () => {
      try {
        const jobId = await createGenerationJob({
          projectId,
          workflow: mode === "text" ? WORKFLOW_T2V : WORKFLOW_I2V,
          jobType: mode === "text" ? "text_to_video" : "image_to_video",
          sourceAssetId: mode === "text" ? undefined : sourceAssetId ?? undefined,
          prompt: buildPrompt() || undefined,
          negativePrompt: negativePrompt.trim() || undefined,
          width: aspect.w,
          height: aspect.h,
          durationSec,
          motion: MOTIONS[motionIdx] as Motion,
          seed: seedNum,
        });
        setJob({ id: jobId, status: "queued", progress: 0, errorMessage: null });
      } catch (e) {
        toast.error((e as Error).message || "Could not start generation.");
      }
    });
  }

  function cancel() {
    if (!job) return;
    const id = job.id;
    // Optimistically reflect the cancel; the poll will confirm.
    setJob((cur) => (cur ? { ...cur, status: "cancelled" } : cur));
    cancelGenerationJob(id).catch(() => {
      toast.error("Could not cancel the job.");
      void getGenerationJob(id).then((j) =>
        setJob({ id: j.id, status: j.status, progress: j.progress ?? 0, errorMessage: j.errorMessage ?? null }),
      );
    });
  }

  const selected = versions.find((v) => v.id === selectedVersionId) ?? null;

  return (
    <div className="space-y-6">
      {/* ── Create Panel (§9) ────────────────────────────────────────────── */}
      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <Wand2 className="size-4 text-[color:var(--cw-violet)]" />
          <h2 className="text-sm font-semibold">Generate with AI</h2>
        </div>

        {/* Mode: image→video vs text→video */}
        <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5 text-sm font-medium">
          {(["image", "text"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors",
                mode === m ? "bg-[color:var(--cw-violet)] text-white shadow" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "image" ? "From image" : "From text"}
            </button>
          ))}
        </div>

        {/* Source photo picker (image→video only) */}
        {mode === "image" ? (
          <Field label="Source photo" hint="Pick a photo to bring to life.">
          {photos.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border p-8 text-center">
              <ImageIcon className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">No photos yet</p>
              <p className="text-xs text-muted-foreground">
                Add photos on the Import screen or the Timeline tab, or switch to <b>From text</b>.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {photos.map((p) => {
                const active = p.id === sourceAssetId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSourceAssetId(p.id)}
                    aria-pressed={active}
                    title={p.name}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-lg border-2 bg-muted transition-all",
                      active
                        ? "border-[color:var(--cw-violet)] ring-2 ring-[color:var(--cw-violet)]/30"
                        : "border-transparent hover:border-border",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/projects/${projectId}/assets/${p.id}`}
                      alt={p.name}
                      className="size-full object-cover"
                    />
                    {active ? (
                      <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-[color:var(--cw-violet)] text-white shadow">
                        <Check className="size-3.5" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
          </Field>
        ) : null}

        {/* Prompt */}
        <Field label="Prompt" hint="Describe the motion, atmosphere, and feeling you want.">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Describe the shot, motion, atmosphere, and feeling you want."
            className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm outline-none transition-colors focus:border-[color:var(--cw-violet)]"
          />
        </Field>

        {/* Style chips */}
        <Field label="Style">
          <div className="flex flex-wrap gap-2">
            {STYLES.map((s) => (
              <Chip key={s.key} active={styleKey === s.key} onClick={() => setStyleKey(styleKey === s.key ? null : s.key)}>
                {s.label}
              </Chip>
            ))}
          </div>
        </Field>

        {/* Camera picker */}
        <Field label="Camera">
          <div className="grid grid-cols-4 gap-2">
            {CAMERAS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCameraKey(cameraKey === c.key ? null : c.key)}
                aria-pressed={cameraKey === c.key}
                className={cn(
                  "rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                  cameraKey === c.key
                    ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Field>

        {/* Motion slider */}
        <Field label="Motion">
          <div className="space-y-1.5">
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              value={motionIdx}
              onChange={(e) => setMotionIdx(Number(e.target.value))}
              className="w-full accent-[color:var(--cw-violet)]"
              aria-label="Motion amount"
            />
            <div className="flex justify-between text-[11px] font-medium">
              {MOTIONS.map((m, i) => (
                <span key={m} className={cn("capitalize", i === motionIdx ? "text-foreground" : "text-muted-foreground")}>
                  {m}
                </span>
              ))}
            </div>
          </div>
        </Field>

        {/* Duration + Aspect */}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Duration">
            <div className="flex gap-2">
              {DURATIONS.map((d) => (
                <Chip key={d} active={durationSec === d} onClick={() => setDurationSec(d)}>
                  {d}s
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Aspect ratio">
            <div className="flex gap-2">
              {ASPECTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAspectKey(a.key)}
                  aria-pressed={aspectKey === a.key}
                  title={`${a.label} ${a.key}`}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 transition-colors",
                    aspectKey === a.key
                      ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10"
                      : "border-border hover:border-border/80",
                  )}
                >
                  <span
                    className={cn(
                      "rounded-sm border-2",
                      a.box,
                      aspectKey === a.key ? "border-[color:var(--cw-violet)]" : "border-muted-foreground",
                    )}
                  />
                  <span className="text-[11px] font-medium">{a.key}</span>
                </button>
              ))}
            </div>
          </Field>
        </div>

        {/* Quality cards (UI hint only for now) */}
        <Field label="Quality" hint="A hint for now — quality tiers aren't wired to the model yet.">
          <div className="grid grid-cols-3 gap-2">
            {QUALITIES.map((q) => (
              <button
                key={q.key}
                type="button"
                onClick={() => setQualityKey(q.key)}
                aria-pressed={qualityKey === q.key}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left transition-colors",
                  qualityKey === q.key
                    ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10"
                    : "border-border hover:border-border/80",
                )}
              >
                <div className="text-sm font-semibold">{q.label}</div>
                <div className="text-[11px] text-muted-foreground">{q.note}</div>
              </button>
            ))}
          </div>
        </Field>

        {/* Advanced (§10) — collapsed by default */}
        <div className="rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            aria-expanded={advancedOpen}
            className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium"
          >
            <span>Advanced settings</span>
            <ChevronDown className={cn("size-4 transition-transform", advancedOpen && "rotate-180")} />
          </button>
          {advancedOpen ? (
            <div className="space-y-4 border-t border-border p-3">
              <Field label="Seed" hint="Leave blank for a random seed.">
                <input
                  type="text"
                  inputMode="numeric"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="Random"
                  className="h-9 w-40 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-[color:var(--cw-violet)]"
                />
              </Field>
              <Field label="Negative prompt" hint="Things to avoid in the generated clip.">
                <textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  rows={2}
                  placeholder="blurry, distorted, low quality"
                  className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm outline-none focus:border-[color:var(--cw-violet)]"
                />
              </Field>
            </div>
          ) : null}
        </div>

        {/* CTA (§9) — dominant Generate button, or the §11 progress state while running */}
        {isGenerating ? (
          <GenerationProgress job={job!} onCancel={cancel} />
        ) : (
          <Button
            onClick={generate}
            disabled={pending || (mode === "image" ? !sourceAssetId : !prompt.trim())}
            size="lg"
            className="h-14 w-full bg-[image:var(--cw-spectrum)] text-base font-semibold text-white shadow-lg hover:opacity-90"
          >
            {pending ? (
              <>
                <Loader2 className="size-5 animate-spin" /> Starting…
              </>
            ) : (
              <>
                <Sparkles className="size-5" /> Generate
              </>
            )}
          </Button>
        )}
      </section>

      {/* ── Preview + Version Browser (§12) ──────────────────────────────── */}
      {selected && selected.hasOutput ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Preview</h3>
          <div className="overflow-hidden rounded-xl border border-border bg-black">
            <video
              key={selected.id}
              src={`/api/generations/${selected.id}/watch`}
              controls
              autoPlay
              playsInline
              className="max-h-[60vh] w-full"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Version {selected.versionNumber} · {relTime(selected.createdAt)}
          </p>
        </section>
      ) : null}

      <VersionBrowser
        versions={versions}
        selectedId={selectedVersionId}
        onSelect={setSelectedVersionId}
      />
    </div>
  );
}

/** §11 Generation progress — friendly phase name, progress bar, cancel action. */
function GenerationProgress({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const phase = PHASE[job.status] ?? "Working…";
  const pct = Math.max(0, Math.min(100, Math.round(job.progress ?? 0)));
  return (
    <div className="space-y-3 rounded-xl border border-[color:var(--cw-violet)]/40 bg-[color:var(--cw-violet)]/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin text-[color:var(--cw-violet)]" />
          {phase}
        </div>
        <Button variant="outline" size="sm" onClick={onCancel}>
          <X className="size-3.5" /> Cancel
        </Button>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[image:var(--cw-spectrum)] transition-[width] duration-500"
          style={{ width: `${pct || 6}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {pct > 0 ? `${pct}% · ` : ""}You can keep editing — we&apos;ll drop the clip here when it&apos;s ready.
      </p>
    </div>
  );
}

/** §12 Version browser — grid of generated clips, newest first. Selecting one shows it above. */
function VersionBrowser({
  versions,
  selectedId,
  onSelect,
}: {
  versions: GenerationVersionItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Film className="size-4 text-[color:var(--cw-violet)]" />
        <h3 className="text-sm font-semibold">Generated versions</h3>
        {versions.length > 0 ? (
          <span className="text-xs text-muted-foreground">{versions.length}</span>
        ) : null}
      </div>

      {versions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border p-8 text-center">
          <Sparkles className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No generations yet</p>
          <p className="text-xs text-muted-foreground">Your generated clips will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {versions.map((v) => {
            const active = v.id === selectedId;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => v.hasOutput && onSelect(v.id)}
                disabled={!v.hasOutput}
                aria-pressed={active}
                className={cn(
                  "group relative flex aspect-video flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border-2 bg-muted transition-all",
                  active
                    ? "border-[color:var(--cw-violet)] ring-2 ring-[color:var(--cw-violet)]/30"
                    : "border-transparent hover:border-border",
                  !v.hasOutput && "cursor-default opacity-70",
                )}
              >
                {v.hasOutput ? (
                  <video
                    src={`/api/generations/${v.id}/watch#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    className="absolute inset-0 size-full object-cover"
                  />
                ) : (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                )}

                {/* play affordance on hover for ready clips */}
                {v.hasOutput ? (
                  <span className="absolute inset-0 z-10 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/25">
                    <span className="grid size-8 place-items-center rounded-full bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                      <Play className="size-4 translate-x-0.5 fill-foreground text-foreground" />
                    </span>
                  </span>
                ) : null}

                {/* meta row */}
                <span className="absolute left-1.5 top-1.5 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  v{v.versionNumber}
                </span>
                {v.favorite ? (
                  <Star className="absolute right-1.5 top-1.5 z-20 size-3.5 fill-amber-400 text-amber-400" />
                ) : null}
                {v.selected ? (
                  <span className="absolute right-1.5 bottom-1.5 z-20 grid size-4 place-items-center rounded-full bg-[color:var(--cw-violet)] text-white">
                    <Check className="size-3" />
                  </span>
                ) : null}
                <span className="absolute left-1.5 bottom-1.5 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  {v.hasOutput ? relTime(v.createdAt) : "Processing…"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Small labelled field wrapper to keep the create panel consistent. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** Pill-style toggle used for style + duration. */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
