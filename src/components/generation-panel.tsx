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
  Trash2,
  Columns2,
  Copy,
  RefreshCw,
  Download,
  Clapperboard,
  Bookmark,
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
  deleteGenerationVersion,
  regenerateFromVersion,
  enhanceVersion,
  toggleVersionFavorite,
  setVersionSelected,
  type GenerationVersionItem,
} from "@/lib/generation-actions";
import {
  createExportJob,
  listExportJobs,
  deleteExportJob,
  type ExportFormat,
  type ExportResolution,
  type ExportJobItem,
} from "@/lib/export-actions";

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

// Export chooser options.
const EXPORT_FORMATS: { key: ExportFormat; label: string }[] = [
  { key: "mp4", label: "MP4" },
  { key: "webm", label: "WebM" },
];
const EXPORT_RESOLUTIONS: { key: ExportResolution; label: string }[] = [
  { key: "native", label: "Native" },
  { key: "720p", label: "720p" },
  { key: "1080p", label: "1080p" },
];

// Export job status → friendly label + chip colour.
const EXPORT_TERMINAL = new Set(["completed", "failed"]);
const EXPORT_STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-muted text-muted-foreground" },
  processing: { label: "Processing", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  completed: { label: "Completed", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Failed", cls: "bg-destructive/15 text-destructive" },
};

function exportLabel(e: ExportJobItem): string {
  const fmt = e.outputFormat.toUpperCase();
  const res = e.resolution ? (e.resolution === "native" ? "Native" : e.resolution) : "Native";
  return `${fmt} · ${res}`;
}

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
  const [compareId, setCompareId] = useState<string | null>(null);

  // Export state
  const [exports, setExports] = useState<ExportJobItem[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("mp4");
  const [exportResolution, setExportResolution] = useState<ExportResolution>("1080p");
  const [exportPending, startExport] = useTransition();

  // Enhance state
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [enhanceEngine, setEnhanceEngine] = useState<"ffmpeg" | "ai">("ffmpeg");
  const [enhanceInterp, setEnhanceInterp] = useState(true);
  const [enhanceUpscale, setEnhanceUpscale] = useState(true);

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

  const refreshExports = useCallback(async () => {
    try {
      const list = await listExportJobs(projectId);
      setExports(list);
      return list;
    } catch {
      /* transient — leave the current list in place */
      return null;
    }
  }, [projectId]);

  // Initial versions + exports load.
  useEffect(() => {
    void refreshVersions();
    void refreshExports();
  }, [refreshVersions, refreshExports]);

  // Poll the export list every ~3s while any export is still queued/processing.
  const exportsActive = exports.some((e) => !EXPORT_TERMINAL.has(e.status));
  useEffect(() => {
    if (!exportsActive) return;
    const t = setInterval(() => {
      void refreshExports();
    }, 3000);
    return () => clearInterval(t);
  }, [exportsActive, refreshExports]);

  // §11 realtime job status via SSE (one connection per active job; server pushes changes).
  const activeJobId = job && !TERMINAL.has(job.status) ? job.id : null;
  useEffect(() => {
    if (!activeJobId) return;
    const es = new EventSource(`/api/generations/${activeJobId}/events`);
    es.onmessage = (ev) => {
      let d: { status?: string; progress?: number; errorMessage?: string | null };
      try { d = JSON.parse(ev.data); } catch { return; }
      if (!d.status || d.status === "gone") { es.close(); return; }
      setJob({ id: activeJobId, status: d.status, progress: d.progress ?? 0, errorMessage: d.errorMessage ?? null });
      if (d.status === "completed") {
        es.close();
        void refreshVersions().then((list) => {
          const newest = list?.find((v) => v.jobId === activeJobId) ?? list?.[0];
          if (newest) setSelectedVersionId(newest.id);
        });
        toast.success("Your clip is ready.");
      } else if (d.status === "failed") {
        es.close();
        toast.error(d.errorMessage || "Generation failed.");
      } else if (d.status === "cancelled") {
        es.close();
      }
    };
    // Backstop: SSE gives realtime progress, but if the stream is buffered/dropped (e.g. a proxy),
    // a slow poll still catches terminal completion so the UI never gets stuck.
    const backstop = setInterval(async () => {
      try {
        const next = await getGenerationJob(activeJobId);
        setJob({ id: activeJobId, status: next.status, progress: next.progress ?? 0, errorMessage: next.errorMessage ?? null });
        if (next.status === "completed") {
          const list = await refreshVersions();
          const newest = list?.find((v) => v.jobId === activeJobId) ?? list?.[0];
          if (newest) setSelectedVersionId(newest.id);
        }
      } catch { /* transient */ }
    }, 10000);
    // EventSource auto-reconnects on transient drops; on terminal we close it above.
    return () => { es.close(); clearInterval(backstop); };
  }, [activeJobId, refreshVersions]);

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

  // Toggle a version into the compare slot (side-by-side against the selected one).
  function toggleCompare(id: string) {
    setCompareId((cur) => (cur === id ? null : id));
    if (!selectedVersionId) setSelectedVersionId(id);
  }

  // Delete a version (row + MinIO object), clearing it from selection/compare.
  function removeVersion(id: string) {
    if (!window.confirm("Delete this version? The video is removed permanently.")) return;
    deleteGenerationVersion(id)
      .then(async () => {
        if (selectedVersionId === id) setSelectedVersionId(null);
        if (compareId === id) setCompareId(null);
        await refreshVersions();
        toast.success("Version deleted.");
      })
      .catch((e) => toast.error((e as Error).message || "Could not delete the version."));
  }

  // Duplicate (same seed) or regenerate (fresh seed) a new job from an existing version.
  function regenFrom(versionId: string, fresh: boolean) {
    regenerateFromVersion(versionId, fresh)
      .then((jobId) => {
        setCompareId(null);
        setJob({ id: jobId, status: "queued", progress: 0, errorMessage: null });
        toast.message(fresh ? "Regenerating a new variation…" : "Duplicating this version…");
      })
      .catch((e) => toast.error((e as Error).message || "Could not start generation."));
  }

  // Enhance the selected version (ffmpeg interpolate/upscale → new version). It's an enhancement
  // generation_job, so the existing job poller tracks it and refreshes the versions on completion.
  function runEnhance() {
    if (!enhanceInterp && !enhanceUpscale) {
      toast.error("Pick at least one enhancement.");
      return;
    }
    const versionId = selectedVersionId;
    if (!versionId) return;
    setEnhanceOpen(false);
    start(async () => {
      try {
        const jobId = await enhanceVersion({ versionId, engine: enhanceEngine, interpolate: enhanceInterp, upscale: enhanceUpscale });
        setCompareId(null);
        setJob({ id: jobId, status: "queued", progress: 0, errorMessage: null });
        toast.message("Enhancing this version…");
      } catch (e) {
        toast.error((e as Error).message || "Could not start enhancement.");
      }
    });
  }

  // Toggle favorite / set the project's selected pick, then refresh the list.
  function favVersion(id: string) {
    setVersions((cur) => cur.map((v) => (v.id === id ? { ...v, favorite: !v.favorite } : v))); // optimistic
    toggleVersionFavorite(id).then(() => refreshVersions()).catch(() => { void refreshVersions(); toast.error("Could not update favorite."); });
  }
  function pickVersion(id: string) {
    setVersions((cur) => cur.map((v) => ({ ...v, selected: v.id === id }))); // optimistic (one pick/project)
    setVersionSelected(id).then(() => refreshVersions()).catch(() => { void refreshVersions(); toast.error("Could not set the pick."); });
  }

  const selected = versions.find((v) => v.id === selectedVersionId) ?? null;
  const compare =
    compareId && compareId !== selectedVersionId
      ? versions.find((v) => v.id === compareId) ?? null
      : null;

  // Queue an export of the selected version, then refresh the Export Center + collapse the chooser.
  function runExport() {
    if (!selected || !selected.hasOutput) return;
    const versionId = selected.id;
    startExport(async () => {
      try {
        await createExportJob({ versionId, outputFormat: exportFormat, resolution: exportResolution });
        toast.success("Export started…");
        setExportOpen(false);
        await refreshExports();
      } catch (e) {
        toast.error((e as Error).message || "Could not start the export.");
      }
    });
  }

  // Delete an export job (row + MinIO object), then refresh the Export Center.
  function removeExport(id: string) {
    deleteExportJob(id)
      .then(async () => {
        await refreshExports();
        toast.success("Export deleted.");
      })
      .catch((e) => toast.error((e as Error).message || "Could not delete the export."));
  }

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
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{compare ? "Compare" : "Preview"}</h3>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => regenFrom(selected.id, false)} disabled={isGenerating || pending} title="Make an exact copy (same settings + seed)">
                <Copy className="size-3.5" /> Duplicate
              </Button>
              <Button variant="outline" size="sm" onClick={() => regenFrom(selected.id, true)} disabled={isGenerating || pending} title="Generate a new variation (same settings, new seed)">
                <RefreshCw className="size-3.5" /> Regenerate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEnhanceOpen((o) => !o)}
                disabled={isGenerating || pending || !selected.hasOutput}
                aria-expanded={enhanceOpen}
                title="Enhance this version (smoother motion / upscale)"
              >
                <Sparkles className="size-3.5" /> Enhance
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportOpen((o) => !o)}
                disabled={isGenerating || exportPending || !selected.hasOutput}
                aria-expanded={exportOpen}
                title="Export this version as a downloadable video"
              >
                <Download className="size-3.5" /> Export
              </Button>
              {compare ? (
                <Button variant="ghost" size="sm" onClick={() => setCompareId(null)}>
                  <X className="size-3.5" /> Exit compare
                </Button>
              ) : null}
            </div>
          </div>

          {/* Inline enhance chooser — smoother motion / upscale, then confirm. */}
          {enhanceOpen ? (
            <div className="space-y-3 rounded-xl border border-[color:var(--cw-violet)]/40 bg-[color:var(--cw-violet)]/5 p-3">
              <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5 text-sm font-medium">
                {(["ffmpeg", "ai"] as const).map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEnhanceEngine(e)}
                    aria-pressed={enhanceEngine === e}
                    className={cn(
                      "rounded-md px-3 py-1.5 transition-colors",
                      enhanceEngine === e ? "bg-[color:var(--cw-violet)] text-white shadow" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {e === "ffmpeg" ? "Fast" : "AI upscale"}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Chip active={enhanceInterp} onClick={() => setEnhanceInterp((v) => !v)}>
                  Smoother motion
                </Chip>
                <Chip active={enhanceUpscale} onClick={() => setEnhanceUpscale((v) => !v)}>
                  Upscale 2×
                </Chip>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {enhanceEngine === "ai"
                  ? "AI (GPU): smoother motion uses RIFE frame interpolation; upscale uses Real-ESRGAN 2× super-resolution. Best quality, takes longer. Creates a new version."
                  : "Fast (ffmpeg): smoother motion interpolates to a higher frame rate; upscale doubles the resolution. Creates a new version."}
              </p>
              <div className="flex items-center justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEnhanceOpen(false)} disabled={pending}>
                  <X className="size-3.5" /> Cancel
                </Button>
                <Button size="sm" onClick={runEnhance} disabled={pending || (!enhanceInterp && !enhanceUpscale)}>
                  <Sparkles className="size-3.5" /> Enhance
                </Button>
              </div>
            </div>
          ) : null}

          {/* Inline export chooser — format + resolution, then confirm. */}
          {exportOpen ? (
            <div className="space-y-3 rounded-xl border border-[color:var(--cw-violet)]/40 bg-[color:var(--cw-violet)]/5 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Format</label>
                  <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5 text-sm font-medium">
                    {EXPORT_FORMATS.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setExportFormat(f.key)}
                        aria-pressed={exportFormat === f.key}
                        className={cn(
                          "rounded-md px-3 py-1.5 transition-colors",
                          exportFormat === f.key
                            ? "bg-[color:var(--cw-violet)] text-white shadow"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Resolution</label>
                  <div className="flex flex-wrap gap-2">
                    {EXPORT_RESOLUTIONS.map((r) => (
                      <Chip key={r.key} active={exportResolution === r.key} onClick={() => setExportResolution(r.key)}>
                        {r.label}
                      </Chip>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => setExportOpen(false)} disabled={exportPending}>
                  <X className="size-3.5" /> Cancel
                </Button>
                <Button size="sm" onClick={runExport} disabled={exportPending}>
                  {exportPending ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Starting…
                    </>
                  ) : (
                    <>
                      <Download className="size-3.5" /> Export
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : null}
          {compare && compare.hasOutput ? (
            <div className="grid grid-cols-2 gap-2">
              {[selected, compare].map((v) => (
                <div key={v.id} className="space-y-1">
                  <div className="overflow-hidden rounded-xl border border-border bg-black">
                    <video key={v.id} src={`/api/generations/${v.id}/watch`} controls playsInline className="max-h-[50vh] w-full" />
                  </div>
                  <p className="text-center text-xs font-medium text-muted-foreground">v{v.versionNumber} · {relTime(v.createdAt)}</p>
                </div>
              ))}
            </div>
          ) : (
            <>
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
            </>
          )}
        </section>
      ) : null}

      <VersionBrowser
        versions={versions}
        selectedId={selectedVersionId}
        compareId={compareId}
        onSelect={setSelectedVersionId}
        onCompare={toggleCompare}
        onDelete={removeVersion}
        onFavorite={favVersion}
        onPick={pickVersion}
      />

      {exports.length > 0 ? <ExportCenter exports={exports} onDelete={removeExport} /> : null}
    </div>
  );
}

/** Export Center — lists a project's export jobs with status, download + delete. */
function ExportCenter({
  exports,
  onDelete,
}: {
  exports: ExportJobItem[];
  onDelete: (id: string) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Clapperboard className="size-4 text-[color:var(--cw-violet)]" />
        <h3 className="text-sm font-semibold">Exports</h3>
        <span className="text-xs text-muted-foreground">{exports.length}</span>
      </div>

      <ul className="space-y-2">
        {exports.map((e) => {
          const status = EXPORT_STATUS[e.status] ?? { label: e.status, cls: "bg-muted text-muted-foreground" };
          const active = !EXPORT_TERMINAL.has(e.status);
          return (
            <li
              key={e.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-background p-3"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Film className="size-4" />
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{exportLabel(e)}</span>
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", status.cls)}>
                    {active ? <Loader2 className="size-3 animate-spin" /> : e.status === "completed" ? <Check className="size-3" /> : e.status === "failed" ? <X className="size-3" /> : null}
                    {status.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{relTime(e.createdAt)}</span>
                </div>
                {e.status === "failed" && e.errorMessage ? (
                  <p className="truncate text-[11px] text-destructive" title={e.errorMessage}>
                    {e.errorMessage}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {e.hasOutput ? (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={`/api/exports/${e.id}/download`} download />}
                    title="Download this export"
                  >
                    <Download className="size-3.5" /> Download
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onDelete(e.id)}
                  title="Delete export"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
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

/** §12 Version browser — grid of generated clips, newest first. Click to preview; hover for
    Compare (side-by-side) and Delete. */
function VersionBrowser({
  versions,
  selectedId,
  compareId,
  onSelect,
  onCompare,
  onDelete,
  onFavorite,
  onPick,
}: {
  versions: GenerationVersionItem[];
  selectedId: string | null;
  compareId: string | null;
  onSelect: (id: string) => void;
  onCompare: (id: string) => void;
  onDelete: (id: string) => void;
  onFavorite: (id: string) => void;
  onPick: (id: string) => void;
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
            const comparing = v.id === compareId;
            return (
              <div
                key={v.id}
                className={cn(
                  "group relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border-2 bg-muted transition-all",
                  active
                    ? "border-[color:var(--cw-violet)] ring-2 ring-[color:var(--cw-violet)]/30"
                    : comparing
                      ? "border-sky-400 ring-2 ring-sky-400/30"
                      : "border-transparent hover:border-border",
                  !v.hasOutput && "opacity-70",
                )}
              >
                {v.hasOutput ? (
                  <video
                    src={`/api/generations/${v.id}/watch#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    className="pointer-events-none absolute inset-0 size-full object-cover"
                  />
                ) : (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                )}

                {/* click-to-preview layer (below the hover action buttons) */}
                {v.hasOutput ? (
                  <button
                    type="button"
                    onClick={() => onSelect(v.id)}
                    aria-pressed={active}
                    aria-label={`Preview version ${v.versionNumber}`}
                    className="absolute inset-0 z-10 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/25"
                  >
                    <span className="grid size-8 place-items-center rounded-full bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                      <Play className="size-4 translate-x-0.5 fill-foreground text-foreground" />
                    </span>
                  </button>
                ) : null}

                {/* hover actions: favorite, pick, compare, delete */}
                {v.hasOutput ? (
                  <div className="absolute right-1.5 top-1.5 z-30 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => onFavorite(v.id)}
                      aria-pressed={v.favorite}
                      title={v.favorite ? "Unfavorite" : "Favorite"}
                      className={cn(
                        "grid size-6 place-items-center rounded-md text-white shadow",
                        v.favorite ? "bg-amber-500" : "bg-black/70 hover:bg-amber-500",
                      )}
                    >
                      <Star className={cn("size-3.5", v.favorite && "fill-white")} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onPick(v.id)}
                      aria-pressed={v.selected}
                      title={v.selected ? "This is the pick" : "Set as pick"}
                      className={cn(
                        "grid size-6 place-items-center rounded-md text-white shadow",
                        v.selected ? "bg-[color:var(--cw-violet)]" : "bg-black/70 hover:bg-[color:var(--cw-violet)]",
                      )}
                    >
                      <Bookmark className={cn("size-3.5", v.selected && "fill-white")} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onCompare(v.id)}
                      aria-pressed={comparing}
                      title={comparing ? "Stop comparing" : "Compare"}
                      className={cn(
                        "grid size-6 place-items-center rounded-md text-white shadow",
                        comparing ? "bg-sky-500" : "bg-black/70 hover:bg-sky-500",
                      )}
                    >
                      <Columns2 className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(v.id)}
                      title="Delete version"
                      className="grid size-6 place-items-center rounded-md bg-black/70 text-white shadow hover:bg-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ) : null}

                {/* meta */}
                <span className="pointer-events-none absolute left-1.5 top-1.5 z-20 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  v{v.versionNumber}
                  {v.selected ? (
                    <span className="flex items-center gap-0.5 text-[color:var(--cw-violet)]"><Bookmark className="size-2.5 fill-current" /> Pick</span>
                  ) : null}
                </span>
                {v.favorite ? (
                  <Star className="pointer-events-none absolute left-1.5 bottom-1.5 z-20 size-3.5 fill-amber-400 text-amber-400" />
                ) : null}
                <span className="pointer-events-none absolute right-1.5 bottom-1.5 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  {v.hasOutput ? relTime(v.createdAt) : "Processing…"}
                </span>
              </div>
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
