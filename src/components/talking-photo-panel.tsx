"use client";
import { useRef, useState, useTransition } from "react";
import { Check, ImageIcon, Loader2, Mic, Play, ShieldCheck, Sparkles, Square, Type, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { CreditsLine, notEnough, useCredits } from "@/components/credits-line";
import { unwrap } from "@/lib/action-result";
import type { AssetSummary } from "@/lib/assets";
import { VOICES } from "@/lib/deck/types";
import { createTalkingPhoto } from "@/lib/talking-actions";
import type { GpuComputer } from "@/lib/computer-gpu";
import {
  TALKING_ASPECTS, TALKING_CONSENT_TEXT, TALKING_MAX_SECONDS, TALKING_QUALITY, TALKING_SCRIPT_MAX,
  estimateScriptSeconds, talkingCost, type TalkingAspect, type TalkingQuality,
} from "@/lib/talking-photo";

// Waltz AI → Talking photo (Phase C2): pick a photo, type what it should say (a Kokoro voice speaks it) or upload a
// recording, confirm consent, and the clip renders on ClipWaltz's own GPU (aiserver/talking). Lands under Generated
// versions with an "AI-generated" label. 1 credit per second, up to 30 s.

type Recording = { key: string; seconds: number; name: string };

export function TalkingPhotoPanel({
  projectId,
  photos,
  highAvailable,
  computers,
  busy,
  onStarted,
}: {
  projectId: string;
  photos: AssetSummary[];
  /** SeedVR2 restore enabled in the AI registry. */
  highAvailable: boolean;
  /** The user's online computers whose ComfyUI can render talking photos (Connector v0.2). */
  computers: GpuComputer[];
  busy: boolean;
  onStarted: (jobId: string) => void;
}) {
  const [photoId, setPhotoId] = useState<string | null>(photos[0]?.id ?? null);
  const [source, setSource] = useState<"script" | "audio">("script");
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState<string>("af_heart");
  const [speed, setSpeed] = useState(1);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [uploading, setUploading] = useState(false);
  const [aspect, setAspect] = useState<TalkingAspect>("9:16");
  const [quality, setQuality] = useState<TalkingQuality>("standard");
  const [where, setWhere] = useState<string>("clipwaltz"); // "clipwaltz" or a connector id
  const [consent, setConsent] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const credits = useCredits(busy);

  const seconds = source === "audio" ? recording?.seconds ?? 0 : estimateScriptSeconds(script, speed);
  const pc = computers.find((c) => c.id === where) ?? null;
  const q: TalkingQuality = quality === "high" && !highAvailable ? "standard" : quality;
  const cost = pc ? 0 : seconds > 0 ? talkingCost(seconds, q) : 0;
  const renderSecPerSec = TALKING_QUALITY[q].renderSecPerSec;
  const ready = !!photoId && consent && (source === "audio" ? !!recording : !!script.trim());

  function preview(id: string) {
    audioEl.current?.pause();
    if (playing === id) { setPlaying(null); return; }
    const a = new Audio(`/voices/${id}.mp3`);
    audioEl.current = a;
    a.onended = () => setPlaying(null);
    void a.play().then(() => setPlaying(id), () => setPlaying(null));
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/projects/${projectId}/talking-audio`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.text()) || "Upload failed");
      const j = (await r.json()) as { key: string; seconds: number; trimmed: boolean };
      setRecording({ key: j.key, seconds: j.seconds, name: file.name });
      if (j.trimmed) toast.message(`Only the first ${TALKING_MAX_SECONDS} seconds will be used.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function submit() {
    if (!photoId) return;
    start(async () => {
      try {
        const jobId = unwrap(await createTalkingPhoto({
          projectId, sourceAssetId: photoId, aspect, consent, quality: q, computerId: pc?.id ?? null,
          ...(source === "audio" ? { audioKey: recording?.key } : { script, voice, speed }),
        }));
        toast.success("Talking photo started — it'll appear under Generated versions");
        onStarted(jobId);
      } catch (e) {
        toast.error((e as Error).message || "Could not start the talking photo");
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Make a photo speak. Works best with a clear, front-facing portrait — one face, eyes and mouth visible.
      </p>

      <Section label="Photo">
        {photos.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border p-8 text-center">
            <ImageIcon className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No photos yet</p>
            <p className="text-xs text-muted-foreground">Add a portrait on the Import screen or the Timeline tab.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 @md:grid-cols-4 @2xl:grid-cols-6">
            {photos.map((p) => {
              const active = p.id === photoId;
              return (
                <button key={p.id} type="button" onClick={() => setPhotoId(p.id)} aria-pressed={active} title={p.name}
                  className={cn("relative aspect-square overflow-hidden rounded-lg border-2 bg-muted transition-all",
                    active ? "border-[color:var(--cw-violet)] ring-2 ring-[color:var(--cw-violet)]/30" : "border-transparent hover:border-border")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/projects/${projectId}/assets/${p.id}`} alt={p.name} className="size-full object-cover" />
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
      </Section>

      <Section label="What it says">
        <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
          {([["script", "Type a script", Type], ["audio", "Upload a recording", Mic]] as const).map(([k, l, Icon]) => (
            <button key={k} type="button" aria-pressed={source === k} onClick={() => setSource(k)}
              className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1", source === k ? "bg-muted font-medium" : "text-muted-foreground")}>
              <Icon className="size-3.5" /> {l}
            </button>
          ))}
        </div>
        {source === "script" ? (
          <div className="space-y-2">
            <textarea value={script} onChange={(e) => setScript(e.target.value.slice(0, TALKING_SCRIPT_MAX))} rows={4}
              placeholder="Hi! I'm so glad you're here. Let me tell you about…"
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-violet)]/40" />
            <p className="text-[11px] text-muted-foreground">
              {script.length}/{TALKING_SCRIPT_MAX} · about {Math.max(0, Math.round(seconds))} s of speech (up to {TALKING_MAX_SECONDS} s)
            </p>
            <div className="flex items-center gap-1.5">
              <select value={voice} onChange={(e) => { setVoice(e.target.value); audioEl.current?.pause(); setPlaying(null); }}
                aria-label="Voice" className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-xs">
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}{v.lang !== "en" ? ` · ${v.lang.toUpperCase()}` : ""}</option>
                ))}
              </select>
              <Button type="button" variant="outline" size="sm" onClick={() => preview(voice)} aria-label="Hear this voice">
                {playing === voice ? <Square className="size-3.5" /> : <Play className="size-3.5" />} Hear
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Write the script in the voice&apos;s language.</p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Pace
              <input type="range" min={0.8} max={1.2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-32" />
              <span className="tabular-nums">{speed.toFixed(2)}×</span>
            </label>
          </div>
        ) : (
          <div className="space-y-2">
            <input ref={fileInput} type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.webm" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            {recording ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="truncate">{recording.name} · {recording.seconds.toFixed(1)} s</span>
                <button type="button" onClick={() => setRecording(null)} aria-label="Remove recording" className="text-muted-foreground hover:text-destructive">
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Choose a recording
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground">MP3, M4A, WAV, OGG or FLAC, up to 20 MB. Only the first {TALKING_MAX_SECONDS} seconds are used.</p>
          </div>
        )}
      </Section>

      <Section label="Shape">
        <div className="flex flex-wrap gap-1.5">
          {TALKING_ASPECTS.map((a) => (
            <button key={a.key} type="button" aria-pressed={aspect === a.key} onClick={() => setAspect(a.key)}
              className={cn("rounded-full border px-3 py-1 text-xs",
                aspect === a.key ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)] text-white" : "border-border text-muted-foreground hover:text-foreground")}>
              {a.label}
            </button>
          ))}
        </div>
      </Section>

      {computers.length > 0 && (
        <Section label="Render on">
          <div className="flex flex-wrap gap-1.5">
            {[{ id: "clipwaltz", label: "ClipWaltz", sub: "uses AI credits" }, ...computers.map((c) => ({ id: c.id, label: `Your computer · ${c.name}`, sub: c.gpu ? `${c.gpu.name} · free` : "free" }))].map((o) => (
              <button key={o.id} type="button" aria-pressed={where === o.id} onClick={() => setWhere(o.id)}
                className={cn("rounded-lg border px-2.5 py-1.5 text-left text-xs",
                  where === o.id ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border hover:border-foreground/30")}>
                <span className="block font-medium">{o.label}</span>
                <span className="block text-muted-foreground">{o.sub}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {!pc && <Section label="Quality">
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(TALKING_QUALITY) as TalkingQuality[]).map((k) => {
            const off = k === "high" && !highAvailable;
            return (
              <button key={k} type="button" aria-pressed={q === k} disabled={off} onClick={() => setQuality(k)}
                className={cn("rounded-lg border px-2.5 py-2 text-left text-xs transition-colors disabled:opacity-50",
                  q === k ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border hover:border-foreground/30")}>
                <span className="block font-medium">{TALKING_QUALITY[k].label} · {TALKING_QUALITY[k].perSecond} cr/s</span>
                <span className="block text-muted-foreground">{off ? "Temporarily unavailable" : TALKING_QUALITY[k].hint}</span>
              </button>
            );
          })}
        </div>
      </Section>}

      <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-[color:var(--cw-violet)]" />
        <span>
          <span className="inline-flex items-center gap-1 font-medium"><ShieldCheck className="size-4" /> {TALKING_CONSENT_TEXT}</span>
          <span className="block text-xs text-muted-foreground">The video is labelled “AI-generated”. Don&apos;t use photos of public figures or anyone who hasn&apos;t agreed.</span>
        </span>
      </label>

      <Button onClick={submit} disabled={busy || pending || !ready || notEnough(credits, cost)} size="lg"
        className="h-14 w-full bg-[image:var(--cw-spectrum)] text-base font-semibold text-white shadow-lg hover:opacity-90">
        {pending ? <><Loader2 className="size-5 animate-spin" /> Starting…</> : <><Sparkles className="size-5" /> Make it talk</>}
      </Button>
      {pc ? (
        <p className="text-center text-[11px] text-muted-foreground">Free — rendered on {pc.name}. Keep the ClipWaltz Connector and ComfyUI running until it&apos;s done.</p>
      ) : cost > 0 ? (
        <CreditsLine cost={cost} balance={credits} className="w-full justify-center" />
      ) : (
        <p className="text-center text-[11px] text-muted-foreground">
          {TALKING_QUALITY[q].perSecond} AI credit{TALKING_QUALITY[q].perSecond === 1 ? "" : "s"} per second of speech, up to {TALKING_MAX_SECONDS} s.
        </p>
      )}
      <p className="text-center text-[11px] text-muted-foreground">
        {pc ? "How long it takes depends on your GPU — roughly a minute per second of speech on a 10 GB card." : <>Takes a while — about {renderSecPerSec} seconds of rendering per second of speech
        {seconds > 0 ? ` (≈ ${Math.max(1, Math.round((seconds * renderSecPerSec) / 60))} min for this one)` : ""}, plus any queue.</>}
      </p>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
