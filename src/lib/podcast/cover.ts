import { createCanvas } from "@napi-rs/canvas";
import { registerFont } from "@/lib/explainer/fonts";
import { drawAmbient } from "@/lib/explainer/ambient";

// Podcast show cover art.
//
// Apple's specification, read from help.apple.com "A Podcaster's Guide to RSS"
// and podcasters.apple.com "Show Cover" on 2026-09-15:
//
//   size         1400×1400 minimum, 3000×3000 maximum — "the largest size is
//                preferred", so this renders 3000×3000
//   format       JPEG or PNG, and the URL's extension must match the real type
//   resolution   72 dpi
//   colour       RGB
//   transparency "Show Covers cannot contain transparency and should not contain
//                an alpha channel. Make sure your artwork has a solid background
//                before exporting."
//
// That last one decides the format. A canvas is RGBA and `toBuffer("image/png")`
// writes an alpha channel even when every pixel is opaque — the image looks
// right and the feed can still be rejected. @napi-rs/canvas offers no alpha-free
// PNG encode (checked against the installed `index.d.ts`: encode/encodeSync/
// toBuffer, no RGB variant), so the cover is encoded as **JPEG**, which Apple
// accepts and which has no alpha channel by construction. It is also far smaller
// than a 3000×3000 PNG of a gradient, which matters because clients download
// this before they play anything.

const FONT_BOLD = registerFont("CoverBold", "bold");
const FONT_REG = registerFont("CoverReg", "regular");

/** Apple's preferred size, and its maximum. */
export const COVER_SIZE = 3000;

/** What the cover is encoded as — the serving route's extension must match. */
export const COVER_MIME = "image/jpeg";
export const COVER_EXT = "jpg";

function wrap(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Render a show cover.
 *
 * The title is set large and centred: Apple's own guidance is to "make your
 * podcast title clear and prominent" and to keep it legible at thumbnail size,
 * which in most clients is about 120 px square.
 */
export function renderCover(opts: { title: string; subtitle?: string }): Buffer {
  const canvas = createCanvas(COVER_SIZE, COVER_SIZE);
  const ctx = canvas.getContext("2d");

  // Opaque ground first — required, and also what the ambient field is drawn on.
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
  drawAmbient(ctx, 0, { width: COVER_SIZE, height: COVER_SIZE });

  // Darken so the type holds at any size, on any background.
  ctx.fillStyle = "rgba(6, 10, 24, 0.55)";
  ctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);

  const margin = COVER_SIZE * 0.1;
  const maxWidth = COVER_SIZE - margin * 2;

  // Fit the title by stepping the size down until it occupies at most four
  // lines — beyond that it stops reading as a title at thumbnail size.
  let size = Math.round(COVER_SIZE * 0.13);
  let lines: string[] = [];
  for (; size > COVER_SIZE * 0.05; size -= 8) {
    ctx.font = `bold ${size}px ${FONT_BOLD}`;
    lines = wrap(ctx, opts.title, maxWidth);
    if (lines.length <= 4) break;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineHeight = size * 1.18;
  const blockHeight = lines.length * lineHeight;
  let y = COVER_SIZE / 2 - blockHeight / 2 + lineHeight / 2;

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${size}px ${FONT_BOLD}`;
  for (const line of lines) {
    ctx.fillText(line, COVER_SIZE / 2, y);
    y += lineHeight;
  }

  if (opts.subtitle) {
    const subSize = Math.round(size * 0.38);
    ctx.font = `${subSize}px ${FONT_REG}`;
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(opts.subtitle, COVER_SIZE / 2, y + subSize * 0.9);
  }

  // JPEG, not PNG — see the note at the top of this file. Quality 92 keeps the
  // type crisp; the gradient behind it is exactly what JPEG compresses well.
  return canvas.toBuffer("image/jpeg", 92);
}
