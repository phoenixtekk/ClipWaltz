"use client";
import { useEffect, useRef, useState } from "react";
import { Type, Smile, Trash2, Layers } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { Overlay, OverlayAnim } from "@/lib/overlays";
import { setProjectOverlays } from "@/lib/overlay-actions";

const EMOJI_PALETTE = ["❤️", "🎉", "✨", "😍", "🔥", "😂", "🥳", "😎", "🌞", "🌊", "🎂", "💯", "👏", "🙌", "⭐", "🎶"];
const ANIMS: { key: OverlayAnim; label: string }[] = [
  { key: "fade", label: "Fade" },
  { key: "slide", label: "Slide" },
  { key: "pop", label: "Pop" },
  { key: "none", label: "None" },
];

function uid() {
  return crypto.randomUUID();
}

export function OverlayEditor({
  projectId,
  initialOverlays,
  aspect,
  backdropAssetId,
  lengthSec,
}: {
  projectId: string;
  initialOverlays: Overlay[];
  aspect: string;
  backdropAssetId: string | null;
  lengthSec: number;
}) {
  const wide = aspect === "16:9";
  const [overlays, setOverlays] = useState<Overlay[]>(initialOverlays);
  const [selected, setSelected] = useState<string | null>(initialOverlays[0]?.id ?? null);
  const [stageH, setStageH] = useState(360);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageH(el.clientHeight));
    ro.observe(el);
    setStageH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  function persist(next: Overlay[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setProjectOverlays(projectId, next).catch(() => toast.error("Could not save overlays."));
    }, 500);
  }
  function update(next: Overlay[]) {
    setOverlays(next);
    persist(next);
  }
  function patch(id: string, p: Partial<Overlay>) {
    update(overlays.map((o) => (o.id === id ? { ...o, ...p } : o)));
  }

  function addText() {
    const o: Overlay = { id: uid(), type: "text", content: "Your text", x: 0.5, y: 0.15, size: 0.09, color: "#ffffff", box: true, start: null, end: null, anim: "fade", beatSnap: false };
    update([...overlays, o]);
    setSelected(o.id);
  }
  function addEmoji(e: string) {
    const o: Overlay = { id: uid(), type: "emoji", content: e, x: 0.5, y: 0.5, size: 0.18, color: "#ffffff", box: false, start: null, end: null, anim: "pop", beatSnap: false };
    update([...overlays, o]);
    setSelected(o.id);
  }
  function remove(id: string) {
    update(overlays.filter((o) => o.id !== id));
    if (selected === id) setSelected(null);
  }

  // pointer drag on the stage
  function onPointerDown(e: React.PointerEvent, id: string) {
    e.preventDefault();
    setSelected(id);
    dragRef.current = { id };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setOverlays((cur) => cur.map((o) => (o.id === dragRef.current!.id ? { ...o, x, y } : o)));
  }
  function onPointerUp() {
    if (dragRef.current) {
      dragRef.current = null;
      persist(overlays);
    }
  }

  const sel = overlays.find((o) => o.id === selected) ?? null;

  return (
    <section className="cw-glass space-y-3 rounded-xl p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        <Layers className="size-4 text-[color:var(--cw-violet)]" /> Overlays
      </h2>

      <div className="grid gap-4 lg:grid-cols-[auto_1fr] lg:items-start">
        {/* drag stage */}
        <div
          ref={stageRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          className={cn(
            "relative mx-auto w-full overflow-hidden rounded-xl border border-border bg-black",
            wide ? "aspect-[16/9] max-w-[420px]" : "aspect-[9/16] max-w-[220px]",
          )}
        >
          {backdropAssetId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/projects/${projectId}/assets/${backdropAssetId}`} alt="" className="absolute inset-0 size-full object-cover opacity-80" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[color:var(--cw-blue)]/40 via-[color:var(--cw-magenta)]/30 to-[color:var(--cw-coral)]/30" />
          )}
          {overlays.map((o) => (
            <div
              key={o.id}
              onPointerDown={(e) => onPointerDown(e, o.id)}
              className={cn(
                "absolute cursor-grab touch-none select-none active:cursor-grabbing",
                selected === o.id && "outline outline-2 outline-[color:var(--cw-violet)] outline-offset-2",
              )}
              style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, transform: "translate(-50%,-50%)" }}
            >
              {o.type === "text" ? (
                <span
                  style={{ fontSize: Math.max(10, o.size * stageH), color: o.color, lineHeight: 1.1 }}
                  className={cn("whitespace-pre font-bold", o.box && "rounded bg-black/45 px-1.5 py-0.5")}
                >
                  {o.content}
                </span>
              ) : (
                <span style={{ fontSize: Math.max(14, o.size * stageH) }} className="leading-none">
                  {o.content}
                </span>
              )}
            </div>
          ))}
          {overlays.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-white/70">
              Add a text or emoji overlay, then drag it into place.
            </div>
          ) : null}
        </div>

        {/* controls */}
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={addText} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/40">
              <Type className="size-3.5" /> Add text
            </button>
            <div className="flex flex-wrap items-center gap-1 rounded-full border border-border bg-card px-2 py-1">
              <Smile className="size-3.5 text-muted-foreground" />
              {EMOJI_PALETTE.slice(0, 8).map((e) => (
                <button key={e} type="button" onClick={() => addEmoji(e)} className="rounded px-0.5 text-base hover:bg-muted" aria-label={`Add ${e}`}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          {sel ? (
            <div className="space-y-2.5 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {sel.type === "text" ? "Text overlay" : "Emoji overlay"}
                </span>
                <button type="button" onClick={() => remove(sel.id)} aria-label="Delete overlay" className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="size-4" />
                </button>
              </div>

              {sel.type === "text" ? (
                <input
                  value={sel.content}
                  maxLength={120}
                  onChange={(e) => patch(sel.id, { content: e.target.value })}
                  className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
                />
              ) : (
                <input
                  value={sel.content}
                  maxLength={8}
                  onChange={(e) => patch(sel.id, { content: e.target.value })}
                  placeholder="Paste any emoji"
                  className="h-8 w-24 rounded-md border border-border bg-background px-2.5 text-center text-lg outline-none focus:border-primary"
                />
              )}

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Size
                <input type="range" min={0.03} max={0.4} step={0.01} value={sel.size} onChange={(e) => patch(sel.id, { size: Number(e.target.value) })} className="flex-1" />
              </label>

              {sel.type === "text" ? (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <label className="flex items-center gap-1.5">
                    Colour
                    <input type="color" value={sel.color} onChange={(e) => patch(sel.id, { color: e.target.value })} className="h-6 w-8 rounded border border-border bg-transparent" />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={sel.box} onChange={(e) => patch(sel.id, { box: e.target.checked })} /> Background
                  </label>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Animation</span>
                {ANIMS.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => patch(sel.id, { anim: a.key })}
                    className={cn("rounded-full border px-2 py-0.5 text-xs", sel.anim === a.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={sel.start == null}
                    onChange={(e) => patch(sel.id, e.target.checked ? { start: null, end: null } : { start: 0, end: Math.min(3, lengthSec) })}
                  />
                  Whole video
                </label>
                {sel.start != null ? (
                  <span className="flex items-center gap-1">
                    <input type="number" min={0} max={lengthSec} step={0.5} value={sel.start} onChange={(e) => patch(sel.id, { start: Number(e.target.value) })} className="h-7 w-16 rounded-md border border-border bg-background px-1.5 text-center" />
                    –
                    <input type="number" min={0} max={lengthSec} step={0.5} value={sel.end ?? ""} onChange={(e) => patch(sel.id, { end: e.target.value === "" ? null : Number(e.target.value) })} className="h-7 w-16 rounded-md border border-border bg-background px-1.5 text-center" />
                    s
                  </span>
                ) : null}
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={sel.beatSnap} onChange={(e) => patch(sel.id, { beatSnap: e.target.checked })} /> Snap to beat
                </label>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Select an overlay on the left to edit it, or add one above.</p>
          )}

          {overlays.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {overlays.length} overlay{overlays.length === 1 ? "" : "s"} · drag on the frame to position · auto-saved.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
