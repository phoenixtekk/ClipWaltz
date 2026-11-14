import { createCanvas } from "@napi-rs/canvas";
import { registerFont } from "./fonts";
import type { ExplainerScript } from "./script";
import { BRAND } from "./compositor";
import { drawAmbient } from "./ambient";

// ─── Stage 5b: the thumbnail ─────────────────────────────────────────────────
//
// Drawn, never diffused. The spec allowed a ComfyUI background with text drawn
// on top; this uses the ambient generator for the background instead, for the
// same reasons the ambient layer itself is drawn: it is instant, it cannot fail
// when the AI Box does, and — the point here — a thumbnail is mostly TEXT, and
// the one thing diffusion reliably ruins is text.
//
// Verified against YouTube's own requirements on 2026-09-13:
//   aspect ratio   16:9
//   minimum width  640 px  (this renders 1920×1080, well clear)
//   formats        JPG or PNG
//
// A thumbnail is read at about 350 px wide in a sidebar, so everything here is
// sized to survive that: very few words, very large, high contrast against a
// darkened plate.

const FONT_BOLD = registerFont("ThumbBold", "bold");

const W = 1920;
const H = 1080;

/** Words that earn nothing at sidebar size. */
const FILLER = /^(the|a|an|and|or|of|in|to|for|is|are|what|why|how|really|actually|explained)$/i;

/**
 * Squeeze the title down to something readable at thumbnail size.
 *
 * A generated title like "Compliance policies vs configuration profiles — what
 * each is really for" is unreadable in a sidebar. The half before a dash or
 * colon is almost always the substantive half, and dropping filler words after
 * that gets it to a glanceable phrase without inventing anything.
 */
export function thumbnailText(script: ExplainerScript): string {
  const head = (script.title.split(/[—–:|]/)[0] ?? script.title).trim();
  const words = head.split(/\s+/).filter(Boolean);
  if (words.length <= 5) return head.toUpperCase();
  const kept = words.filter((w) => !FILLER.test(w));
  return (kept.length >= 3 ? kept : words).slice(0, 5).join(" ").toUpperCase();
}

function wrapBold(ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, text: string, size: number, maxW: number) {
  ctx.font = `700 ${size}px ${FONT_BOLD}`;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function renderThumbnail(script: ExplainerScript, opts: { seed?: number; kicker?: string } = {}): Buffer {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background: one frame of the ambient field, so thumbnails and videos share
  // a visual family without a second generator to maintain.
  drawAmbient(ctx, 1.5, { seed: opts.seed ?? 20260913, width: W, height: H });

  // Darken so type always wins, whatever the field is doing underneath.
  ctx.fillStyle = "#05060cc0";
  ctx.fillRect(0, 0, W, H);

  // Accent bar — the channel's signature mark.
  ctx.fillStyle = BRAND.cyan;
  ctx.fillRect(140, 250, 150, 12);

  const text = thumbnailText(script);
  let size = 168;
  let lines = wrapBold(ctx, text, size, W - 320);
  // Shrink until it fits three lines; a fourth is unreadable at sidebar size.
  while (lines.length > 3 && size > 96) {
    size -= 12;
    lines = wrapBold(ctx, text, size, W - 320);
  }

  ctx.textAlign = "left";
  ctx.font = `700 ${size}px ${FONT_BOLD}`;
  const blockH = lines.length * (size + 18);
  let y = (H - blockH) / 2 + size;

  for (const line of lines) {
    // A hard shadow, not a blur: it survives the aggressive recompression
    // YouTube applies to thumbnails.
    ctx.fillStyle = "#00000090";
    ctx.fillText(line, 146, y + 6);
    ctx.fillStyle = BRAND.ink;
    ctx.fillText(line, 140, y);
    y += size + 18;
  }

  const kicker = opts.kicker ?? "PHOENIXTEKK";
  ctx.font = `700 34px ${FONT_BOLD}`;
  ctx.fillStyle = BRAND.muted;
  ctx.fillText(kicker, 142, H - 130);

  return canvas.toBuffer("image/png");
}
