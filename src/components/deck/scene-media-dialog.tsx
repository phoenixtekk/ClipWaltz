"use client";
// Edit a WaltzDeck scene's media: framing (drag to reposition, zoom to crop), rotation, which part of a video
// plays — or delete the file from the project. Framing and the video start are per scene; rotation is the
// file's (every scene and the timeline editor use it).
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pause, Play, RotateCw, Trash2, X, ZoomIn } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { unwrap } from "@/lib/action-result";
import { nextRotation } from "@/lib/rotation";
import { aspectNumber, frameRect, MAX_FRAME_ZOOM, normFrame, type SceneFrameBox } from "@/lib/deck/frame";
import { updateScene, type DeckAsset } from "@/lib/deck-actions";
import { deleteAsset, setAssetRotation } from "@/lib/asset-actions";
import type { DeckScene } from "@/lib/deck/types";
import { SceneFrame, type FrameBrand } from "./scene-frame";

const CENTRED: SceneFrameBox = { x: 0.5, y: 0.5, zoom: 1 };

export function SceneMediaDialog({ projectId, scene, asset, aspectCss, wide, brand, usedBy, onClose, onSaved }: {
  projectId: string; scene: DeckScene; asset: DeckAsset; aspectCss: string; wide: boolean; brand: FrameBrand;
  /** How many scenes use this file (for the delete warning). */
  usedBy: number;
  onClose: () => void; onSaved: () => void;
}) {
  const isVideo = asset.kind === "video";
  const [rotation, setRotation] = useState(asset.rotation ?? 0);
  const [frame, setFrame] = useState<SceneFrameBox>(scene.frame ?? CENTRED);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [dur, setDur] = useState(asset.durationSec ?? 0);
  const [auto, setAuto] = useState(scene.inSec == null);
  const [start, setStart] = useState(scene.inSec ?? 0);
  // Only a start you changed is saved (before the clip length is known, the clamp below would move it to 0).
  const [timingTouched, setTimingTouched] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ px: number; py: number; cx: number; cy: number; w: number; h: number } | null>(null);

  const maxStart = Math.max(0, dur - scene.durationSec);
  const startAt = isVideo && !auto ? Math.min(start, maxStart) : null;
  const aspect = aspectNumber(aspectCss);
  const turned = rotation % 180 !== 0;
  const rect = natural ? frameRect(frame, turned ? natural.h : natural.w, turned ? natural.w : natural.h, aspect) : null;

  // Close on Escape.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // "Play scene" plays the scene's length once, then stops on the start frame again.
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setPlaying(false), scene.durationSec * 1000);
    return () => clearTimeout(t);
  }, [playing, scene.durationSec]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, cx: rect.l + rect.w / 2, cy: rect.t + rect.h / 2, w: rect.w, h: rect.h };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const box = stage.current?.getBoundingClientRect();
    if (!d || !box) return;
    // Dragging the picture right shows more of its left side: the centre moves the other way, scaled from frame
    // pixels to a fraction of the source.
    const x = Math.max(d.w / 2, Math.min(1 - d.w / 2, d.cx - ((e.clientX - d.px) / box.width) * d.w));
    const y = Math.max(d.h / 2, Math.min(1 - d.h / 2, d.cy - ((e.clientY - d.py) / box.height) * d.h));
    setFrame((f) => ({ ...f, x, y }));
  };
  const endDrag = () => { drag.current = null; };

  async function save() {
    setBusy("save");
    try {
      if (rotation !== (asset.rotation ?? 0)) unwrap(await setAssetRotation(projectId, asset.id, rotation));
      // Your own framing is kept by re-plans, like your own text.
      unwrap(await updateScene(projectId, scene.id, {
        frame: normFrame(frame), ...(isVideo && timingTouched ? { inSec: auto ? null : Math.round(Math.min(start, maxStart) * 10) / 10 } : {}), locked: true,
      }));
      toast.success("Scene media saved.");
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't save the changes.");
      setBusy(null);
    }
  }

  async function remove() {
    const scenes = usedBy === 1 ? "1 scene uses it and becomes a text card" : `${usedBy} scenes use it and become text cards`;
    if (!window.confirm(`Delete "${asset.name}" from this project? ${scenes}. The file stays in your media library.`)) return;
    setBusy("delete");
    try {
      unwrap(await deleteAsset(projectId, asset.id));
      toast.success("Removed from the project.");
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't delete it.");
      setBusy(null);
    }
  }

  const framed = frame.zoom !== 1 || frame.x !== 0.5 || frame.y !== 0.5;
  return (
    <div role="dialog" aria-modal="true" aria-label={`Edit media for scene ${scene.orderIndex + 1}`} onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4">
      <div onClick={(e) => e.stopPropagation()} className="my-auto w-full max-w-xl space-y-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold">Edit media · <span className="font-normal text-muted-foreground">{asset.name}</span></h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-muted-foreground hover:text-foreground"><X className="size-5" /></button>
        </div>

        <div className={cn("relative mx-auto", wide ? "max-w-full" : "max-w-[300px]")}>
          <div ref={stage}>
            <SceneFrame projectId={projectId} scene={{ ...scene, frame }} asset={{ ...asset, rotation }} aspectCss={aspectCss} brand={brand}
              startAt={startAt} playing={playing} onMediaSize={(w, h) => setNatural({ w, h })} />
          </div>
          {/* Drag layer over the text, so the whole frame moves the picture. */}
          <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
            className={cn("absolute inset-0 touch-none rounded-lg", rect ? "cursor-grab active:cursor-grabbing" : "cursor-wait")}
            aria-label="Drag to reposition" />
        </div>
        <p className="text-center text-xs text-muted-foreground">Drag the picture to choose what shows. Zoom in to crop tighter.</p>

        <div className="space-y-3 rounded-lg border border-border bg-background/50 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ZoomIn className="size-4 shrink-0 text-[color:var(--cw-violet)]" />
            <span className="w-10">Zoom</span>
            <input type="range" min={1} max={MAX_FRAME_ZOOM} step={0.05} value={frame.zoom} aria-label="Zoom"
              onChange={(e) => setFrame((f) => ({ ...f, zoom: Number(e.target.value) }))} className="flex-1" />
            <span className="w-10 text-right tabular-nums">{frame.zoom.toFixed(2)}×</span>
            <button type="button" disabled={!framed} onClick={() => setFrame(CENTRED)}
              className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:border-primary hover:text-primary disabled:opacity-40">Reset</button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {rotation ? `Turned ${rotation}° — for every scene that uses this file.` : "Sideways? Turn it upright (every scene using this file)."}
            </p>
            <Button type="button" variant="secondary" size="sm" aria-label="Rotate 90 degrees clockwise"
              onClick={() => { setRotation(nextRotation(rotation)); setFrame(CENTRED); }}>
              <RotateCw className="size-4" /> Rotate 90°
            </Button>
          </div>
        </div>

        {isVideo ? (
          <div className="space-y-2 rounded-lg border border-border bg-background/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Which part plays</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPlaying(!playing)}>
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />} {playing ? "Stop" : `Play ${scene.durationSec}s`}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setTimingTouched(true); }} />
              Auto — the render picks the most active part
            </label>
            {!auto ? (
              maxStart > 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="w-10">Start</span>
                  <input type="range" min={0} max={maxStart} step={0.1} value={Math.min(start, maxStart)} aria-label="Start"
                    onChange={(e) => { setStart(Number(e.target.value)); setTimingTouched(true); setPlaying(false); }} className="flex-1" />
                  <span className="w-24 text-right tabular-nums">{Math.min(start, maxStart).toFixed(1)}–{(Math.min(start, maxStart) + scene.durationSec).toFixed(1)}s</span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {dur ? `The clip (${dur.toFixed(1)}s) isn't longer than the scene (${scene.durationSec}s), so all of it plays.` : "Reading the clip length…"}
                </p>
              )
            ) : null}
            {/* The clip length when the file didn't record it: read from the video itself. */}
            {!dur ? <video src={`/api/projects/${projectId}/assets/${asset.id}`} preload="metadata" muted className="hidden"
              onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (d && Number.isFinite(d)) setDur(d); }} /> : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={remove} className="text-destructive hover:text-destructive">
            {busy === "delete" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete from project
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={onClose}>Cancel</Button>
            <Button type="button" size="sm" disabled={!!busy} onClick={save}>
              {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
