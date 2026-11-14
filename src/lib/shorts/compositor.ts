import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { registerFont } from "@/lib/explainer/fonts";
import { BRAND } from "@/lib/explainer/compositor";
import type { ShortScript } from "./script";
import type { WordTiming } from "@/lib/explainer/voice";

// ─── Drawing a vertical short ────────────────────────────────────────────────
//
// A separate renderer from the explainer compositor, not a flag on it. That one
// is 1920×1080 with every margin, box and type size tuned for a landscape frame
// on a desktop; the same numbers at 1080×1920 give a column of tiny text down
// the middle of a phone. The palette and brand are shared, the geometry is not.
//
// Three things are true of a vertical short and of nothing else here:
//
//  1. **It is watched muted.** Captions are not an accessibility extra, they
//     are the only way most viewers receive the words, so they are burned in
//     and sized to be read at arm's length.
//
//  2. **The platform draws on top of the frame.** YouTube Shorts, Reels and
//     TikTok all overlay controls across roughly the bottom 15% and a column
//     down the right ~12%. Anything placed there is covered on at least one
//     platform, so the safe area is enforced rather than eyeballed.
//
//  3. **Type has to be enormous.** The body size here (46px) is larger than the
//     explainer's HEADING, because the frame is half as wide and read on a
//     phone held in one hand.

export const WIDTH = 1080;
export const HEIGHT = 1920;

/** Platform chrome. Content never enters these margins. */
const SAFE = { top: 120, bottom: 430, x: 72, right: 150 } as const;
const CONTENT_W = WIDTH - SAFE.x - SAFE.right;

const FONT = registerFont("ShSans", "regular");
const FONT_BOLD = registerFont("ShSansBold", "bold");

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ease = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : 1 - Math.pow(1 - p, 3));

function wrap(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      if (lines.length === maxLines - 1) {
        lines.push(`${cur}…`);
        return lines;
      }
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Where a content block of height `h` starts so it sits centred in the band
 * between the top safe margin and the captions.
 *
 * Top-aligning the content leaves roughly 900px of empty frame between the text
 * and the caption bar — on a phone that reads as a broken render, not as
 * deliberate space. The block is centred in the room it actually has instead.
 */
function blockTop(h: number): number {
  const bandTop = SAFE.top + 40;
  const bandBottom = HEIGHT - SAFE.bottom - CAPTION_BAND;
  return Math.max(bandTop, bandTop + (bandBottom - bandTop - h) / 2);
}

/** Room reserved for the caption block, so content never collides with it. */
const CAPTION_BAND = 280;

/** The scene showing at time `t`. Derived from the narration's own timings. */
export interface Scene {
  kind: "hook" | "step" | "payoff";
  start: number;
  end: number;
  /** 1-based, for the step counter. */
  index?: number;
  total?: number;
  heading: string;
  body: string;
}

function background(ctx: SKRSContext2D, p: number) {
  ctx.fillStyle = BRAND.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // A slow vertical wash so a static card is never a dead flat rectangle.
  const g = ctx.createLinearGradient(0, 0, WIDTH * 0.6, HEIGHT);
  g.addColorStop(0, `${BRAND.violet}22`);
  g.addColorStop(0.5, "#00000000");
  g.addColorStop(1, `${BRAND.cyan}18`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Accent rail that grows across the scene — a progress cue without a bar.
  ctx.fillStyle = BRAND.cyan;
  ctx.fillRect(0, 0, WIDTH * ease(p), 8);
}

function drawHook(ctx: SKRSContext2D, s: Scene, p: number) {
  ctx.textAlign = "left";
  ctx.font = `700 92px ${FONT_BOLD}`;
  const lines = wrap(ctx, s.heading, CONTENT_W, 5);
  ctx.font = `400 46px ${FONT}`;
  const sub = s.body ? wrap(ctx, s.body, CONTENT_W, 4) : [];

  const h = 60 + lines.length * 108 + (sub.length ? 40 + sub.length * 62 : 0);
  let y = blockTop(h);

  ctx.font = `600 34px ${FONT_BOLD}`;
  ctx.fillStyle = BRAND.cyan;
  ctx.globalAlpha = ease(p * 3);
  ctx.fillText("QUICK TIP", SAFE.x, y);
  y += 60;

  ctx.font = `700 92px ${FONT_BOLD}`;
  ctx.fillStyle = BRAND.ink;
  lines.forEach((ln, i) => {
    ctx.globalAlpha = ease((p - i * 0.06) * 4);
    ctx.fillText(ln, SAFE.x, y + 76 + i * 108);
  });
  y += lines.length * 108;

  if (sub.length) {
    ctx.font = `400 46px ${FONT}`;
    ctx.fillStyle = BRAND.muted;
    sub.forEach((ln, i) => {
      ctx.globalAlpha = ease((p - 0.15 - i * 0.05) * 4);
      ctx.fillText(ln, SAFE.x, y + 90 + i * 62);
    });
  }
  ctx.globalAlpha = 1;
}

function drawStep(ctx: SKRSContext2D, s: Scene, p: number) {
  ctx.textAlign = "left";
  const chip = 96;

  ctx.font = `700 64px ${FONT_BOLD}`;
  const labelLines = wrap(ctx, s.heading, CONTENT_W, 3);
  ctx.font = `400 46px ${FONT}`;
  const body = wrap(ctx, s.body, CONTENT_W, 8);

  const h = 40 + chip + 46 + labelLines.length * 76 + 40 + body.length * 62;
  let y = blockTop(h);

  ctx.font = `700 30px ${FONT_BOLD}`;
  ctx.fillStyle = BRAND.muted;
  ctx.fillText(`STEP ${s.index} OF ${s.total}`, SAFE.x, y);
  y += 40;

  ctx.globalAlpha = ease(p * 4);
  ctx.fillStyle = BRAND.violet;
  roundRect(ctx, SAFE.x, y, chip, chip, 24);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 54px ${FONT_BOLD}`;
  ctx.textAlign = "center";
  ctx.fillText(String(s.index), SAFE.x + chip / 2, y + chip / 2 + 19);
  ctx.globalAlpha = 1;
  y += chip + 46;

  ctx.textAlign = "left";
  ctx.font = `700 64px ${FONT_BOLD}`;
  ctx.fillStyle = BRAND.ink;
  labelLines.forEach((ln, i) => ctx.fillText(ln, SAFE.x, y + 54 + i * 76));
  y += labelLines.length * 76 + 40;

  ctx.font = `400 46px ${FONT}`;
  ctx.fillStyle = BRAND.muted;
  body.forEach((ln, i) => {
    ctx.globalAlpha = ease((p - 0.1 - i * 0.05) * 4);
    ctx.fillText(ln, SAFE.x, y + 46 + i * 62);
  });
  ctx.globalAlpha = 1;
}

function drawPayoff(ctx: SKRSContext2D, s: Scene, p: number) {
  ctx.textAlign = "left";
  ctx.font = `700 74px ${FONT_BOLD}`;
  const lines = wrap(ctx, s.heading, CONTENT_W, 5);

  const cardH = s.body ? 130 : 0;
  const h = lines.length * 90 + (cardH ? 60 + cardH : 0);
  let y = blockTop(h);

  ctx.fillStyle = BRAND.ink;
  lines.forEach((ln, i) => {
    ctx.globalAlpha = ease((p - i * 0.06) * 4);
    ctx.fillText(ln, SAFE.x, y + 66 + i * 90);
  });
  ctx.globalAlpha = 1;
  y += lines.length * 90;

  if (s.body) {
    const cardY = y + 60;
    ctx.fillStyle = BRAND.panel;
    roundRect(ctx, SAFE.x, cardY, CONTENT_W, cardH, 22);
    ctx.fill();
    ctx.strokeStyle = BRAND.cyan;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = `600 34px ${FONT_BOLD}`;
    ctx.fillStyle = BRAND.cyan;
    ctx.fillText("FULL GUIDE", SAFE.x + 32, cardY + 52);
    ctx.font = `400 34px ${FONT}`;
    ctx.fillStyle = BRAND.ink;
    ctx.fillText(wrap(ctx, s.body, CONTENT_W - 64, 1)[0] ?? "", SAFE.x + 32, cardY + 98);
  }
}

/**
 * Burned-in captions, sat ABOVE the platform's chrome.
 *
 * Placed by `SAFE.bottom` rather than at the foot of the frame: on YouTube
 * Shorts the bottom of a 1920-tall frame is under the title, the channel name
 * and the action rail, so captions drawn there are simply not visible on the
 * platform the video is made for.
 */
function drawCaptions(ctx: SKRSContext2D, words: WordTiming[], t: number) {
  const live = words.filter((w) => t >= w.start - 0.4 && t <= w.end + 1.6);
  if (live.length === 0) return;

  ctx.font = `700 52px ${FONT_BOLD}`;
  ctx.textAlign = "center";

  // Build the visible window, wrapped, then draw it as a block.
  const phrase = live.map((w) => w.word).join(" ");
  const lines = wrap(ctx, phrase, CONTENT_W, 3);
  const lineH = 68;
  const padY = 30;
  const blockH = lines.length * lineH;
  // Baselines sit `lineH` below the box top plus padding, so the visual gap
  // above and below the text block matches instead of pooling underneath.
  const boxTop = HEIGHT - SAFE.bottom - blockH - padY * 2;

  ctx.fillStyle = "#000000b0";
  roundRect(ctx, SAFE.x - 24, boxTop, CONTENT_W + 48, blockH + padY * 2, 20);
  ctx.fill();

  const cx = SAFE.x + CONTENT_W / 2;
  ctx.fillStyle = BRAND.ink;
  lines.forEach((ln, i) => ctx.fillText(ln, cx, boxTop + padY + 50 + i * lineH));
  ctx.textAlign = "left";
}

/** Turn a script + its measured timings into the scene list. */
export function scenesFor(script: ShortScript, sectionTimes: { start: number; end: number }[]): Scene[] {
  const out: Scene[] = [];
  const at = (i: number) => sectionTimes[i] ?? { start: 0, end: 0 };
  let i = 0;

  // Hook and problem share one card: they are two sentences of the same beat,
  // and cutting between them inside four seconds reads as a glitch.
  const hook = at(i++);
  const problem = at(i++);
  out.push({
    kind: "hook",
    start: hook.start,
    end: problem.end || hook.end,
    heading: script.hook,
    body: script.problem,
  });

  script.steps.forEach((s, n) => {
    const t = at(i++);
    out.push({
      kind: "step",
      start: t.start,
      end: t.end,
      index: n + 1,
      total: script.steps.length,
      heading: s.label,
      body: s.detail,
    });
  });

  const pay = at(i++);
  out.push({
    kind: "payoff",
    start: pay.start,
    end: pay.end,
    heading: script.payoff,
    body: script.sourceUrl ? script.sourceUrl.replace(/^https?:\/\//, "") : "",
  });

  return out;
}

interface FrameOpts {
  scene: Scene;
  words: WordTiming[];
  t: number;
}

function paint(opts: FrameOpts) {
  const { scene, words, t } = opts;
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  const span = Math.max(0.001, scene.end - scene.start);
  const p = Math.min(1, Math.max(0, (t - scene.start) / span));

  background(ctx, p);
  if (scene.kind === "hook") drawHook(ctx, scene, p);
  else if (scene.kind === "step") drawStep(ctx, scene, p);
  else drawPayoff(ctx, scene, p);
  drawCaptions(ctx, words, t);
  return canvas;
}

/** A PNG, for thumbnails and for looking at a frame while tuning the layout. */
export function renderShortFrame(opts: FrameOpts): Buffer {
  return paint(opts).toBuffer("image/png");
}

/**
 * Raw RGBA straight to ffmpeg's pipe.
 *
 * Encoding a PNG per frame would be pure waste here: ffmpeg only decodes it
 * again, and at ~30 frames a second for 45 seconds that is 1,350 needless
 * compress/decompress round trips.
 */
export function renderShortFrameRaw(opts: FrameOpts): Buffer {
  const canvas = paint(opts);
  return Buffer.from(canvas.getContext("2d").getImageData(0, 0, WIDTH, HEIGHT).data.buffer);
}

/** The scene live at `t`, or the last one once the narration has finished. */
export function sceneAt(scenes: Scene[], t: number): Scene {
  return scenes.find((s) => t >= s.start && t < s.end) ?? scenes[scenes.length - 1];
}
