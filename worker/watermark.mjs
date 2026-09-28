// ─── Watermark (owner decision 2026-09-25: every video, bottom-left; admin can exempt paid plans) ──
// Shared by the generation worker and the remix composer (worker/remix-compose.mjs).
// The app decides per job (request_json.watermark / export_jobs.watermark); same logo, size and
// placement as the music-video render worker: 15.4% of the short side (30% smaller than the original 22%), 3% padding, 90% opacity.
// Keep WM_SCALE in sync with worker/render-worker.mjs.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WM_SCALE = 0.154;
export const WATERMARK_PATH = process.env.WATERMARK_PATH || join(dirname(fileURLToPath(import.meta.url)), "WaterMark.png");
const wmGeometry = (w, h) => {
  const s = Math.min(w, h) || 480;
  return { wmW: Math.max(24, Math.round(s * WM_SCALE)), pad: Math.round(s * 0.03) };
};
// Logo box on a w×h frame of a watermarked video, grown by `margin` px and kept strictly inside the
// frame (delogo needs a border). Used to erase the burned-in logo from remix seed frames: the i2v
// model otherwise redraws it and a warped ghost shows around the fresh logo (verified 2026-09-27).
let wmAspect;
export const wmBox = (w, h, margin = 6) => {
  if (wmAspect === undefined) {
    try { const b = readFileSync(WATERMARK_PATH); wmAspect = b.readUInt32BE(20) / b.readUInt32BE(16); } catch { wmAspect = 278 / 438; }
  }
  const { wmW, pad } = wmGeometry(w, h);
  const x = Math.max(1, pad - margin), y = Math.max(1, h - pad - Math.round(wmW * wmAspect) - margin);
  return { x, y, w: Math.min(pad + wmW + margin, w - 1) - x, h: Math.min(h - pad + margin, h - 1) - y };
};
// Overlay chain taking [base] → [out]. The logo is generated inside the graph (movie + loop +
// regular timestamps): on ffmpeg 7.x a PNG *input* drops the logo (single frame) or drops frames
// at random (-loop 1) — verified 2026-09-25 on the render worker.
export const wmChain = (base, w, h) => {
  const { wmW, pad } = wmGeometry(w, h);
  return `movie='${WATERMARK_PATH}',scale=${wmW}:-1,format=rgba,colorchannelmixer=aa=0.9,loop=loop=-1:size=1:start=0,setpts=N/30/TB[wm];` +
    `[${base}][wm]overlay=x=${pad}:y=main_h-overlay_h-${pad}:format=auto:shortest=1,format=yuv420p[out]`;
};
