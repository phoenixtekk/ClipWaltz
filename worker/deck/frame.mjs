// Scene framing (crop / reposition) for the render and the slide exports: deck_scenes.frame = { x, y, zoom } —
// the visible area's centre as a fraction of the upright source and a zoom ≥ 1 on top of "cover". Same maths as
// src/lib/deck/frame.ts (the editor preview) — keep them in sync.

/**
 * ffmpeg crop (with a trailing comma) that cuts the scene's framing out of the source, in the output's shape, so
 * the usual cover scale / camera / Ken Burns chain that follows fills the frame from it. "" = default framing.
 * Goes AFTER the user rotation (iw/ih are the upright source).
 */
export function vfFrame(frame, W, H) {
  if (!frame || typeof frame !== "object") return "";
  const n = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
  const x = n(frame.x, 0, 1, 0.5), y = n(frame.y, 0, 1, 0.5), z = n(frame.zoom, 1, 3, 1);
  // zoom < 1 is a media card on the backdrop (render-worker deckSegments / export.mjs): no crop here.
  if (Number(frame.zoom) < 1) return "";
  if (z === 1 && x === 0.5 && y === 0.5) return "";
  const A = (W / H).toFixed(6);
  const f = (v) => Number(v.toFixed(4));
  return `crop=w='min(iw,ih*${A})/${f(z)}':h='min(iw/${A},ih)/${f(z)}':x='max(0,min(iw-ow,iw*${f(x)}-ow/2))':y='max(0,min(ih-oh,ih*${f(y)}-oh/2))',`;
}
