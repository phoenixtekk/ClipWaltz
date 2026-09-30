"use client";
import { useRef, useState } from "react";
import { Clock, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { AssetSummary } from "@/lib/assets";
import { setAssetDuration, setAssetTrim, setClipReframe, setAssetTags, setAssetRotation } from "@/lib/asset-actions";
import { nextRotation, rotatedFill, rotationParent } from "@/lib/rotation";
import { unwrap } from "@/lib/action-result";

// Default screen time when no manual time is set (the timeline sizes auto-timed clips by it too).
const PHOTO_SEC = 2;
const VIDEO_SEC = 4;
export const autoSec = (a: AssetSummary) => (a.kind === "video" ? VIDEO_SEC : PHOTO_SEC);

const REFRAME_VIEWS = [
  { key: "follow", label: "Follow action", hint: "The camera turns to wherever the most movement is — best for action." },
  { key: "flat", label: "Front", hint: "A steady view straight out of the lens." },
  { key: "tiny", label: "Tiny planet", hint: "The whole scene wrapped into a little planet (needs a two-lens 360 file)." },
];

/**
 * One clip's settings (studio inspector): preview it (play/scrub), turn it upright, pick a 360 view,
 * TRIM a video (choose the part to render) or set an image's manual screen time, and tag it.
 * State is seeded from `asset` once — the parent re-keys it when the saved clip changes.
 */
export function ClipInspector({
  projectId,
  asset,
  onSaved,
  onClose,
}: {
  projectId: string;
  asset: AssetSummary;
  onSaved: () => void;
  onClose: () => void;
}) {
  const isVideo = asset.kind === "video";
  const [dur, setDur] = useState(asset.durationSec ?? 0); // filled from the <video> metadata if unknown
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [saving, setSaving] = useState(false);
  const src = `/api/projects/${projectId}/assets/${asset.id}`;

  // Image: manual screen time.
  const [manual, setManual] = useState(asset.durationOverride != null);
  const [secs, setSecs] = useState(asset.durationOverride ?? autoSec(asset));

  // Video: trim in/out.
  const [trimmed, setTrimmed] = useState(asset.trimStart != null && asset.trimEnd != null);
  const [start, setStart] = useState(asset.trimStart ?? 0);
  const [end, setEnd] = useState(asset.trimEnd ?? (dur || 0));
  const clampStart = (v: number) => Math.max(0, Math.min(v, (end || dur) - 0.4));
  const clampEnd = (v: number) => Math.min(dur || v, Math.max(v, start + 0.4));
  const seek = (t: number) => { if (videoRef.current) { videoRef.current.currentTime = t; videoRef.current.pause(); } };

  // 360 clips (Insta360 .insv/.lrv): which way the flat video looks.
  const is360 = asset.sourceFormat === "insv" || asset.sourceFormat === "lrv";
  const initialView = asset.reframeMode ?? "follow";
  const [view, setView] = useState(initialView);
  const initialTags = (asset.tags ?? []).join(", ");
  const [tagText, setTagText] = useState(initialTags);
  // Rotation on top of the file's own flag (phone clips that come out sideways).
  const [rotation, setRotation] = useState(asset.rotation ?? 0);

  async function save() {
    setSaving(true);
    try {
      if (tagText !== initialTags) {
        unwrap(await setAssetTags(projectId, asset.id, tagText.split(",")));
      }
      if (rotation !== (asset.rotation ?? 0)) {
        unwrap(await setAssetRotation(projectId, asset.id, rotation));
      }
      if (is360 && view !== initialView) {
        unwrap(await setClipReframe(projectId, asset.id, view));
        toast.message("Re-making this 360 clip with the new view — it's ready in a few minutes.");
      }
      if (isVideo) {
        unwrap(await setAssetTrim(projectId, asset.id, trimmed ? start : null, trimmed ? end : null));
      } else {
        unwrap(await setAssetDuration(projectId, asset.id, manual ? secs : null));
      }
      toast.success("Clip saved.");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message || "Could not save the clip.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="truncate text-sm font-semibold" title={asset.name}>{asset.name}</p>
      {/* Rotated clips get a fixed-height stage (the rotated element is sized from it); the video's
          own controls would turn with it, so tap the picture to play/pause instead. */}
      <div className={cn("overflow-hidden rounded-lg bg-black", rotation && "h-[32vh]")} style={rotationParent(rotation)}>
        {isVideo ? (
          <video
            ref={videoRef}
            src={src}
            controls={!rotation}
            playsInline
            onClick={rotation ? (e) => { const v = e.currentTarget; if (v.paused) void v.play(); else v.pause(); } : undefined}
            onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (d && Number.isFinite(d)) { setDur(d); if (end <= 0) setEnd(d); } }}
            className={cn("max-h-[32vh] w-full", rotation && "cursor-pointer object-contain")}
            style={rotatedFill(rotation)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={asset.name} className="max-h-[32vh] w-full object-contain" style={rotatedFill(rotation)} />
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {rotation ? `Turned ${rotation}° — applies to the preview and the render.${isVideo ? " Tap the picture to play or pause." : ""}` : "Sideways? Turn it upright."}
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={() => setRotation(nextRotation(rotation))} aria-label="Rotate 90 degrees clockwise" className="shrink-0">
          <RotateCw className="size-4" /> Rotate 90°
        </Button>
      </div>

      {is360 ? (
        <div className="space-y-2 rounded-lg border border-border bg-background/50 p-3">
          <div className="text-sm font-medium">360 view</div>
          <div className="flex flex-wrap gap-2">
            {REFRAME_VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                aria-pressed={view === v.key}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  view === v.key ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{REFRAME_VIEWS.find((v) => v.key === view)?.hint}</p>
        </div>
      ) : null}

      {isVideo ? (
        <div className="space-y-3 rounded-lg border border-border bg-background/50 p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={trimmed} onChange={(e) => setTrimmed(e.target.checked)} />
            <Clock className="size-4 shrink-0 text-[color:var(--cw-violet)]" /> Trim — render only part of this video
          </label>
          {trimmed && dur > 0 ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-8 shrink-0">Start</span>
                  <input type="range" min={0} max={dur} step={0.1} value={start} onChange={(e) => { const v = clampStart(Number(e.target.value)); setStart(v); seek(v); }} className="min-w-0 flex-1" />
                  <span className="w-10 shrink-0 text-right tabular-nums">{start.toFixed(1)}s</span>
                  <button type="button" onClick={() => setStart(clampStart(videoRef.current?.currentTime ?? start))} className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] hover:border-primary hover:text-primary">Set ⏱</button>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-8 shrink-0">End</span>
                  <input type="range" min={0} max={dur} step={0.1} value={end} onChange={(e) => { const v = clampEnd(Number(e.target.value)); setEnd(v); seek(v); }} className="min-w-0 flex-1" />
                  <span className="w-10 shrink-0 text-right tabular-nums">{end.toFixed(1)}s</span>
                  <button type="button" onClick={() => setEnd(clampEnd(videoRef.current?.currentTime ?? end))} className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] hover:border-primary hover:text-primary">Set ⏱</button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Rendering <span className="font-medium text-foreground">{start.toFixed(1)}s–{end.toFixed(1)}s</span> ({(end - start).toFixed(1)}s of the {dur.toFixed(1)}s clip). Play the video, pause at a spot, then <span className="font-medium">Set ⏱</span>.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Off — ClipWaltz auto-picks the liveliest part{dur > 0 ? ` of this ${dur.toFixed(1)}s clip` : ""}.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-border bg-background/50 p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
            <Clock className="size-4 shrink-0 text-[color:var(--cw-violet)]" /> Set screen time manually
          </label>
          {manual ? (
            <div className="flex items-center gap-2">
              <input type="range" min={0.4} max={60} step={0.1} value={secs} onChange={(e) => setSecs(Number(e.target.value))} className="min-w-0 flex-1" />
              <input type="number" min={0.4} max={60} step={0.1} value={secs} onChange={(e) => setSecs(Number(e.target.value))} aria-label="Screen time in seconds" className="h-8 w-16 shrink-0 rounded-md border border-border bg-background px-1 text-center text-sm" />
              <span className="text-xs text-muted-foreground">sec</span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Auto — ClipWaltz picks the time from the beat/length ({autoSec(asset)}s baseline).</p>
          )}
        </div>
      )}

      <label className="block space-y-1 rounded-lg border border-border bg-background/50 p-3">
        <span className="text-sm font-medium">Tags</span>
        <input
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          placeholder="e.g. jet ski, sunset, cesar"
          maxLength={300}
          className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-[color:var(--cw-violet)]"
        />
        <span className="block text-xs text-muted-foreground">Separate with commas. Use tags to find clips fast in the timeline.</span>
      </label>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Close</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}
