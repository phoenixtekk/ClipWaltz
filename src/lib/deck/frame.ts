// Scene framing (crop / reposition): which part of the media fills a WaltzDeck scene. Stored per scene as
// { x, y, zoom } — the centre of the visible area as a fraction of the upright source (after rotation) and a
// zoom on top of "cover". Below 1 (down to MIN_FRAME_ZOOM) the whole media shrinks to a card on the scene's backdrop
// (cardRect in worker/deck/backdrop.mjs); x / y only apply from 1 up. The crop box always has the frame's shape, so the same framing survives an aspect
// change. Same maths as worker/deck/frame.mjs (the render and the slide exports) — keep them in sync.

export type SceneFrameBox = { x: number; y: number; zoom: number };

export const MAX_FRAME_ZOOM = 3;
export { MIN_FRAME_ZOOM, cardRect } from "../../../worker/deck/backdrop.mjs";
const MIN_ZOOM = 0.6; // = MIN_FRAME_ZOOM

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A valid framing from anything the client sent; null = the default (centred cover). */
export function normFrame(v: unknown): SceneFrameBox | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const zoom = clamp(Number(o.zoom) || 1, MIN_ZOOM, MAX_FRAME_ZOOM);
  // A card (zoom < 1) always shows the whole media, centred.
  const x = zoom < 1 ? 0.5 : clamp(Number(o.x), 0, 1), y = zoom < 1 ? 0.5 : clamp(Number(o.y), 0, 1);
  if (![x, y, zoom].every(Number.isFinite)) return null;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const f = { x: r(x), y: r(y), zoom: r(zoom) };
  return f.zoom === 1 && f.x === 0.5 && f.y === 0.5 ? null : f;
}

/**
 * The visible rectangle as fractions of the source ({ l, t, w, h }), for a source of sw×sh (upright) shown in
 * a frame of aspect `aspect` (width / height). Mirrors the ffmpeg crop in worker/deck/frame.mjs.
 */
export function frameRect(f: SceneFrameBox | null, sw: number, sh: number, aspect: number) {
  const { x, y } = f ?? { x: 0.5, y: 0.5 };
  const zoom = Math.max(1, f?.zoom ?? 1);
  const cw = Math.min(sw, sh * aspect) / zoom;
  const w = cw / sw, h = cw / aspect / sh;
  return { l: clamp(x - w / 2, 0, 1 - w), t: clamp(y - h / 2, 0, 1 - h), w, h };
}

/** "aspect-[16/9]" / "16:9" → 16/9 (width / height). */
export function aspectNumber(s: string): number {
  const m = /(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) / Number(m[2]) : 9 / 16;
}
