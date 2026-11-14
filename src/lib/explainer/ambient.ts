import { createCanvas } from "@napi-rs/canvas";
import { BRAND, WIDTH, HEIGHT } from "./compositor";

// ─── The ambient layer, drawn rather than diffused ───────────────────────────
//
// This sits behind the info layer and does one job: stop a 1080p field of flat
// black from looking like a dead slide, without ever competing with the text in
// front of it.
//
// The spec reached for Stable Video Diffusion here. Measured against what that
// actually costs and delivers, drawing it wins on every axis that matters for a
// BACKGROUND:
//
//   render cost   SVD ~5 minutes of GPU per 4-second clip (measured, see
//                 video-gen.ts) · this, seconds of CPU, no GPU at all
//   looping       SVD clips do not loop — they end, and a visible seam lands in
//                 the middle of a sentence. This loops EXACTLY, by construction.
//   drift         SVD warps content when motion is raised; `motion_bucket_id`
//                 had to be pinned to 70 after 110 reanimated a subject's arm
//                 into an impossible shape. Nothing here can warp.
//   dependency    SVD needs the AI Box up and its ROCm context healthy. That
//                 box lost its GPU context once already and published a day of
//                 imageless posts. This has no failure mode beyond the process.
//
// Diffusion is still the better tool for a HERO shot — a trailer, an intro
// sting — where the picture is the point. Behind text, it is paying five
// minutes of GPU for a prettier blur.
//
// ── Why it loops exactly ─────────────────────────────────────────────────────
// Every animated quantity is a sine or cosine of `(t / period) * 2π * k` with
// INTEGER k. At t = period each term has completed a whole number of cycles and
// is back where it started, so the last frame joins the first with no seam. That
// is what lets a five-minute video reuse one six-second loop: 180 frames drawn
// instead of 9,000, and ffmpeg repeats it.

/** One drifting light. Integer `k` values are what make the loop seamless. */
interface Blob {
  hue: string;
  /** Centre, as a fraction of the frame. */
  x: number;
  y: number;
  /** Drift amplitude, as a fraction of the frame. */
  ax: number;
  ay: number;
  /** Whole cycles per loop — must be integers. */
  kx: number;
  ky: number;
  /** Radius as a fraction of the width, and how much it breathes. */
  r: number;
  kr: number;
  alpha: number;
}

const BLOBS: Blob[] = [
  { hue: BRAND.violet, x: 0.26, y: 0.32, ax: 0.05, ay: 0.035, kx: 1, ky: 2, r: 0.42, kr: 1, alpha: 0.2 },
  { hue: BRAND.cyan, x: 0.76, y: 0.62, ax: 0.045, ay: 0.03, kx: 2, ky: 1, r: 0.36, kr: 2, alpha: 0.15 },
  { hue: BRAND.magenta, x: 0.55, y: 0.18, ax: 0.035, ay: 0.045, kx: 1, ky: 1, r: 0.3, kr: 1, alpha: 0.1 },
];

/** Deterministic PRNG so a given seed always yields the same particle field. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface Particle {
  x: number;
  y: number;
  r: number;
  /** Whole cycles per loop. */
  k: number;
  phase: number;
  drift: number;
  alpha: number;
}

function particles(count: number, seed: number): Particle[] {
  const rand = rng(seed);
  return Array.from({ length: count }, () => ({
    x: rand(),
    y: rand(),
    r: 0.8 + rand() * 2.2,
    // 1–3 whole cycles per loop keeps every particle seamless.
    k: 1 + Math.floor(rand() * 3),
    phase: rand() * Math.PI * 2,
    drift: 0.01 + rand() * 0.03,
    alpha: 0.12 + rand() * 0.35,
  }));
}

export interface AmbientOptions {
  /** Seconds in one seamless loop. */
  periodSec?: number;
  frameRate?: number;
  /** Changes the particle field without changing the look. */
  seed?: number;
  width?: number;
  height?: number;
}

/**
 * One frame of the ambient layer at time `t` within the loop.
 *
 * Opaque: this is the bottom of the stack, and the info layer composites over it.
 */
export function renderAmbientFrame(t: number, opts: AmbientOptions = {}): Buffer {
  const W = opts.width ?? WIDTH;
  const H = opts.height ?? HEIGHT;
  const canvas = createCanvas(W, H);
  drawAmbient(canvas.getContext("2d"), t, opts);
  return canvas.toBuffer("image/png");
}

/**
 * Paint the ambient field directly onto an existing context.
 *
 * Exists so callers that already have a canvas — the thumbnail, chiefly — can
 * use the field as a background WITHOUT a PNG encode and decode in between.
 * The first version of the thumbnail did exactly that round trip, the decode
 * silently produced nothing, and the result shipped as a flat grey plate. Same
 * lesson as the assembly path: do not encode pixels you are about to draw.
 */
export function drawAmbient(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  t: number,
  opts: AmbientOptions = {},
): void {
  const W = opts.width ?? WIDTH;
  const H = opts.height ?? HEIGHT;
  const period = opts.periodSec ?? 6;
  const pts = particles(140, opts.seed ?? 20260913);
  const turn = (t / period) * Math.PI * 2;

  // Base: a near-black field, very slightly lifted towards the brand violet so
  // it does not read as pure void.
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, "#05060c");
  base.addColorStop(0.5, "#080a16");
  base.addColorStop(1, "#05060c");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Drifting lights. `lighter` so overlaps bloom instead of muddying.
  ctx.globalCompositeOperation = "lighter";
  for (const b of BLOBS) {
    const cx = (b.x + Math.cos(turn * b.kx) * b.ax) * W;
    const cy = (b.y + Math.sin(turn * b.ky) * b.ay) * H;
    const r = (b.r + Math.sin(turn * b.kr) * 0.03) * W;

    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `${b.hue}${Math.round(b.alpha * 255).toString(16).padStart(2, "0")}`);
    g.addColorStop(1, `${b.hue}00`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // A fine drifting field — this is what stops the frame reading as a still.
  for (const p of pts) {
    const x = (p.x + Math.cos(turn * p.k + p.phase) * p.drift) * W;
    const y = (p.y + Math.sin(turn * p.k + p.phase) * p.drift) * H;
    // Twinkle rides the same integer cycle, so it loops with everything else.
    const a = p.alpha * (0.55 + 0.45 * Math.sin(turn * p.k + p.phase));
    ctx.fillStyle = `rgba(233,237,255,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  // Vignette: pushes the eye to the middle, where the content is.
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
  v.addColorStop(0, "#00000000");
  v.addColorStop(1, "#000000b0");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

/**
 * Every frame of one seamless loop.
 *
 * `period * frameRate` frames, and frame 0 is the join — so the caller can feed
 * these to ffmpeg once and repeat the result for the whole video rather than
 * drawing five minutes of unique background.
 */
export function ambientLoopFrames(opts: AmbientOptions = {}): Buffer[] {
  const period = opts.periodSec ?? 6;
  const fps = opts.frameRate ?? 30;
  const n = Math.round(period * fps);
  return Array.from({ length: n }, (_, i) => renderAmbientFrame((i / n) * period, opts));
}
