"use client";
// WaltzDeck Presentation mode: the storyboard full screen, one scene per slide, driven by keyboard or clicks.
// → / Space / PageDown next, ← / PageUp back, Home / End, N speaker notes, P auto-play (scene lengths), Esc leave.
import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, StickyNote, Play, Pause } from "lucide-react";
import { cn } from "cn";
import { aspectClass, aspectDims } from "@/lib/aspect";
import type { DeckScene } from "@/lib/deck/types";
import type { DeckAsset } from "@/lib/deck-actions";
import { SceneFrame, type FrameBrand } from "./scene-frame";

export function PresentView({ projectId, scenes, assets, aspect, brand, start = 0, onClose }: {
  projectId: string; scenes: DeckScene[]; assets: Map<string, DeckAsset>; aspect: string; brand: FrameBrand; start?: number; onClose: () => void;
}) {
  const [i, setI] = useState(Math.min(start, scenes.length - 1));
  const [notes, setNotes] = useState(false);
  const [auto, setAuto] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const wasFull = useRef(false);
  // The parent passes a fresh onClose each render (it polls); effects read the latest one without re-running.
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const go = useCallback((d: number) => setI((x) => Math.max(0, Math.min(scenes.length - 1, x + d))), [scenes.length]);

  // Full screen on open (the overlay still works if the browser refuses); leaving full screen leaves the view.
  useEffect(() => {
    const el = root.current;
    el?.requestFullscreen?.().then(() => { wasFull.current = true; }).catch(() => {});
    const onFs = () => { if (!document.fullscreenElement && wasFull.current) close.current(); };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " " || e.key === "Enter") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "Backspace") { e.preventDefault(); go(-1); }
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(scenes.length - 1);
      else if (e.key === "n" || e.key === "N") setNotes((v) => !v);
      else if (e.key === "p" || e.key === "P") setAuto((v) => !v);
      else if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, scenes.length]);

  const cur = scenes[i];
  useEffect(() => {
    if (!auto || !cur) return;
    const t = setTimeout(() => (i + 1 < scenes.length ? setI(i + 1) : setAuto(false)), cur.durationSec * 1000);
    return () => clearTimeout(t);
  }, [auto, i, cur, scenes.length]);

  if (!cur) return null;
  const { w, h } = aspectDims(aspect);
  const asset = cur.assetId ? assets.get(cur.assetId) ?? null : null;
  const note = (cur.voice ?? "").trim();
  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label="Presentation" className="fixed inset-0 z-[100] flex flex-col bg-black text-white">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* Click the left third to go back, anywhere else to go forward. */}
        <button type="button" aria-label="Previous slide" onClick={() => go(-1)} className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-w-resize" />
        <button type="button" aria-label="Next slide" onClick={() => go(1)} className="absolute inset-y-0 right-0 z-10 w-2/3 cursor-e-resize" />
        {/* As large as fits: the full width, or the height left after the control bar (2.75rem) and notes (9rem). */}
        <div style={{ width: `min(100vw, calc((100vh - ${notes ? "11.75rem" : "2.75rem"}) * ${w} / ${h}))` }}>
          <SceneFrame key={cur.id} projectId={projectId} scene={cur} asset={asset} aspectCss={cn(aspectClass(aspect), "rounded-none")} playing startAt={cur.inSec} brand={brand} />
        </div>
      </div>
      {notes ? (
        <div className="h-36 shrink-0 overflow-y-auto border-t border-white/15 bg-neutral-950 px-6 py-3 text-base leading-relaxed text-neutral-200">
          {note || <span className="text-neutral-500">No notes on this slide.</span>}
        </div>
      ) : null}
      <div className="flex shrink-0 items-center gap-1 bg-black/80 px-3 py-1.5 text-xs text-neutral-300">
        <Ctl label="Previous (←)" onClick={() => go(-1)} disabled={i === 0}><ChevronLeft className="size-4" /></Ctl>
        <span className="tabular-nums">{i + 1} / {scenes.length}</span>
        <Ctl label="Next (→)" onClick={() => go(1)} disabled={i === scenes.length - 1}><ChevronRight className="size-4" /></Ctl>
        <Ctl label={auto ? "Stop auto-play (P)" : "Auto-play with scene lengths (P)"} onClick={() => setAuto(!auto)} active={auto}>
          {auto ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Ctl>
        <Ctl label="Speaker notes (N)" onClick={() => setNotes(!notes)} active={notes}><StickyNote className="size-4" /></Ctl>
        <span className="ml-auto hidden text-neutral-500 sm:inline">← → move · N notes · P auto-play · Esc leave</span>
        <Ctl label="Leave (Esc)" onClick={onClose}><X className="size-4" /></Ctl>
      </div>
    </div>
  );
}

const Ctl = ({ label, onClick, disabled, active, children }: {
  label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode;
}) => (
  <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
    className={cn("grid size-8 place-items-center rounded-md hover:bg-white/10 disabled:opacity-30", active && "bg-white/15 text-white")}>
    {children}
  </button>
);
