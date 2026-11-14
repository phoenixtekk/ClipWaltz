// Waltz Image compositor (plan G1 / G2 / G5). Draws the words of an ad, a carousel slide or a meme onto a picture with
// canvas, so the text is pixel-exact and editable — never asked of the diffusion model, which cannot spell. Ported from
// Social Publishing's `src/lib/ad-overlay.ts` (the legibility scrim, accent bar, word-safe wrap and auto-size loop),
// generalised to exact output sizes, brand-kit fonts/colours, a CTA button, carousel slides and meme layouts.
//
// Pure function of its inputs: the same spec gives the same bytes, which is what lets an edited headline re-composite
// instantly with no GPU job, and what the verification script relies on (render twice, diff).
//
// Used by the app (src/lib/image-ad/render.ts — previews, saves, exports) and by the worker (worker/image/comfy.mjs
// fitCover, to bring a model-sized render to the exact preset size). Server-only: @napi-rs/canvas is a native module.
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";

// ─── Fonts ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// @napi-rs/canvas loads the system's fonts by itself. Brand-kit families (Montserrat, Inter, Lato, Open Sans, Roboto,
// Noto Serif) are only present where they are installed — the AI box has them (Debian fonts-* packages), linuxg1 has
// only DejaVu / Liberation (checked 2026-11-14). IMAGE_FONTS_DIR adds a folder of .ttf/.otf files; a family that is
// still missing falls back to the first available sans below, and the caller is told so (`substituted`).
const FALLBACK_FAMILIES = ["Liberation Sans", "DejaVu Sans", "Arial", "Helvetica", "Segoe UI"];
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  const dir = process.env.IMAGE_FONTS_DIR;
  if (dir) {
    try {
      GlobalFonts.loadFontsFromDir(dir);
    } catch {
      /* a bad folder must not stop rendering — the fallback family still draws */
    }
  }
}

/** The family that will actually draw `name`, and whether it had to be substituted. */
export function resolveFont(name) {
  loadFonts();
  if (name && GlobalFonts.has(name)) return { family: name, substituted: false };
  for (const f of FALLBACK_FAMILIES) if (GlobalFonts.has(f)) return { family: f, substituted: true };
  return { family: "sans-serif", substituted: true };
}

const font = (weight, size, family) => `${weight} ${Math.round(size)}px "${family}"`;

// ─── Colour ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
function rgb(hex) {
  const m = HEX.exec(String(hex ?? "").trim());
  if (!m) return [139, 92, 246];
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
/** Relative luminance (WCAG). */
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Readable text colour on a solid background. */
export function textOn(hex) {
  return luminance(hex) > 0.45 ? "#111111" : "#ffffff";
}

// ─── Text fitting ────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Word-wrap to `maxWidth`. Honours explicit line breaks. A single word wider than the line (a URL, a hashtag run) is
 * broken by character rather than drawn off the edge.
 */
function wrapLines(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      if (out.length) out.push("");
      continue;
    }
    let cur = "";
    for (let w of words) {
      while (ctx.measureText(w).width > maxWidth && w.length > 1) {
        // Break an over-long token: flush the current line, then cut the token where it stops fitting.
        if (cur) { out.push(cur); cur = ""; }
        let cut = w.length - 1;
        while (cut > 1 && ctx.measureText(w.slice(0, cut)).width > maxWidth) cut--;
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const test = cur ? `${cur} ${w}` : w;
      if (cur && ctx.measureText(test).width > maxWidth) {
        out.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) out.push(cur);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/**
 * The largest size (stepping down from `maxSize`) at which `text` fits the box. Below `minSize` it stops shrinking and
 * keeps as many whole lines as fit, ending the last with an ellipsis — the only time words are dropped.
 */
function fitText(ctx, text, o) {
  const lh = o.lineHeight ?? 1.15;
  const t = String(text ?? "").trim();
  if (!t) return { size: o.maxSize, lines: [], height: 0, lineHeight: lh };
  const step = Math.max(1, Math.round(o.maxSize / 40));
  let size = Math.round(o.maxSize);
  let lines = [];
  for (; size >= o.minSize; size -= step) {
    ctx.font = font(o.weight, size, o.family);
    lines = wrapLines(ctx, o.upper ? t.toUpperCase() : t, o.maxWidth);
    if ((o.maxLines == null || lines.length <= o.maxLines) && lines.length * size * lh <= o.maxHeight) {
      return { size, lines, height: lines.length * size * lh, lineHeight: lh };
    }
  }
  size = Math.round(o.minSize);
  ctx.font = font(o.weight, size, o.family);
  lines = wrapLines(ctx, o.upper ? t.toUpperCase() : t, o.maxWidth);
  const keep = Math.max(1, Math.min(o.maxLines ?? Infinity, Math.floor(o.maxHeight / (size * lh))));
  if (lines.length > keep) {
    lines = lines.slice(0, keep);
    let last = lines[keep - 1].replace(/[^\w)"'’”]$/, "");
    while (last && ctx.measureText(`${last}…`).width > o.maxWidth) last = last.slice(0, -1).trimEnd();
    lines[keep - 1] = `${last}…`;
  }
  return { size, lines, height: lines.length * size * lh, lineHeight: lh };
}

function drawLines(ctx, fit, x, y, o) {
  ctx.font = font(o.weight, fit.size, o.family);
  ctx.textBaseline = "top";
  ctx.textAlign = o.align ?? "left";
  let yy = y;
  for (const ln of fit.lines) {
    if (o.stroke) {
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.lineWidth = Math.max(2, fit.size * o.stroke);
      ctx.strokeStyle = o.strokeColor ?? "#000000";
      ctx.strokeText(ln, x, yy);
    }
    ctx.fillStyle = o.color;
    ctx.fillText(ln, x, yy);
    yy += fit.size * fit.lineHeight;
  }
  return yy;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ─── Pictures ────────────────────────────────────────────────────────────────────────────────────────────────────────
function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

/** Scale + centre-crop any image to exactly `width`×`height` PNG. */
export async function fitCover(bytes, width, height) {
  const img = await loadImage(bytes);
  const canvas = createCanvas(width, height);
  drawCover(canvas.getContext("2d"), img, 0, 0, width, height);
  return canvas.toBuffer("image/png");
}

/** Read an image's pixel size. */
export async function imageSize(bytes) {
  const img = await loadImage(bytes);
  return { width: img.width, height: img.height };
}

/** PNG → JPEG (downloads). */
export async function toJpeg(png, quality = 92) {
  const img = await loadImage(png);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  return canvas.encode("jpeg", quality);
}

function brandGradient(ctx, W, H, primary, secondary) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, primary);
  g.addColorStop(1, secondary);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // A soft highlight so a template slide is not a flat fill.
  const r = ctx.createRadialGradient(W * 0.8, H * 0.15, 0, W * 0.8, H * 0.15, Math.max(W, H) * 0.7);
  r.addColorStop(0, "rgba(255,255,255,0.18)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);
}

async function drawLogo(ctx, logo, x, y, maxH, maxW) {
  if (!logo) return 0;
  try {
    const img = await loadImage(logo);
    const s = Math.min(maxH / img.height, maxW / img.width);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, x, y - h, w, h);
    return h;
  } catch {
    return 0; // an unreadable logo must not lose the image
  }
}

function drawButton(ctx, label, x, y, o) {
  ctx.font = font(700, o.size, o.family);
  const padX = o.size * 0.95, padY = o.size * 0.6;
  let text = label;
  while (text.length > 1 && ctx.measureText(text).width + padX * 2 > o.maxWidth) text = text.slice(0, -1);
  if (text !== label) text = `${text.trimEnd()}…`;
  const w = ctx.measureText(text).width + padX * 2, h = o.size + padY * 2;
  const bx = o.align === "center" ? x - w / 2 : x;
  ctx.fillStyle = o.fill;
  roundRect(ctx, bx, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = textOn(o.fill);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, bx + w / 2, y + h / 2 + o.size * 0.04);
  return h;
}

// ─── Layouts ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Compose one image.
 *
 * spec = { width, height, layout, background?: Buffer|null, logo?: Buffer|null,
 *          brand: { primary, secondary, headingFont, bodyFont },
 *          text: { headline?, subhead?, cta?, body?, top?, bottom?, caption? },
 *          slide?: { index, count, role: "hook"|"value"|"cta" } }
 *
 * layout: "none" | "ad-left" | "ad-center" | "ad-bottom" | "slide" | "meme-top-bottom" | "meme-caption" | "meme-bar"
 *         | "meme-quote"
 *
 * Returns { png, width, height, fonts: { heading, body }, substituted: string[] }.
 */
export async function composeImage(spec) {
  const W = Math.round(spec.width), H = Math.round(spec.height);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const primary = HEX.test(spec.brand?.primary ?? "") ? spec.brand.primary : "#8b5cf6";
  const secondary = HEX.test(spec.brand?.secondary ?? "") ? spec.brand.secondary : "#120a24";
  const heading = resolveFont(spec.brand?.headingFont || "Montserrat");
  const body = resolveFont(spec.brand?.bodyFont || "Inter");
  const substituted = [];
  if (heading.substituted) substituted.push(spec.brand?.headingFont || "Montserrat");
  if (body.substituted && (spec.brand?.bodyFont || "Inter") !== (spec.brand?.headingFont || "Montserrat")) substituted.push(spec.brand?.bodyFont || "Inter");
  const t = spec.text ?? {};
  const img = spec.background ? await loadImage(spec.background).catch(() => null) : null;
  const pad = Math.round(Math.min(W, H) * 0.07);
  const wide = W / H > 1.4;
  const layout = spec.layout || "none";

  // The caption meme puts the picture BELOW a white band, so it draws its own background.
  if (layout !== "meme-caption") {
    if (img) drawCover(ctx, img, 0, 0, W, H);
    else brandGradient(ctx, W, H, primary, secondary);
  }

  if (layout === "ad-left" || layout === "ad-center" || layout === "ad-bottom" || layout === "slide") {
    await drawAd(ctx, { W, H, pad, wide, layout, primary, secondary, heading, body, t, hasImage: !!img, logo: spec.logo, slide: spec.slide });
  } else if (layout.startsWith("meme-")) {
    await drawMeme(ctx, { W, H, pad, layout, primary, heading, body, t, img });
  }

  return { png: canvas.toBuffer("image/png"), width: W, height: H, fonts: { heading: heading.family, body: body.family }, substituted };
}

async function drawAd(ctx, o) {
  const { W, H, pad, wide, layout, primary, secondary, heading, body, t } = o;
  const headline = String(t.headline ?? "").trim();
  const sub = String(t.subhead ?? t.body ?? "").trim();
  const cta = String(t.cta ?? "").trim();
  const centered = layout === "ad-center" || (layout === "slide" && o.slide?.role !== "value");
  const short = Math.min(W, H);

  // Legibility layer.
  let area; // where the text block may go
  let ink = "#ffffff";
  if (layout === "ad-left") {
    const grad = ctx.createLinearGradient(0, 0, W * (wide ? 0.8 : 0.95), 0);
    grad.addColorStop(0, rgba(primary, 0.92));
    grad.addColorStop(0.55, rgba(primary, 0.55));
    grad.addColorStop(1, rgba(primary, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ink = textOn(primary);
    area = { x: pad, y: pad, w: W * (wide ? 0.56 : 0.8) - pad, h: H - pad * 2 - short * 0.08 };
  } else if (layout === "ad-bottom") {
    // The band's height follows its content, so measure first, then draw.
    ink = textOn(primary);
    area = { x: pad, y: 0, w: W - pad * 2, h: H * (wide ? 0.62 : 0.42) - pad * 2 };
  } else {
    // ad-center and slides: dim the picture (a template slide is already a solid brand gradient).
    if (o.hasImage) {
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, rgba(primary, 0.7));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else {
      ink = textOn(primary);
    }
    area = { x: pad, y: pad + short * 0.06, w: W - pad * 2, h: H - pad * 2 - short * 0.16 };
  }

  // Measure the block: headline, subhead, button.
  const role = o.slide?.role;
  const hMax = short * (role === "hook" ? 0.13 : wide ? 0.11 : 0.095);
  const subMax = short * (wide ? 0.05 : 0.045);
  const btnSize = Math.round(short * (wide ? 0.042 : 0.038));
  const btnH = cta ? btnSize * 2.2 : 0;
  const gap = short * 0.035;
  const subFit = sub ? fitText(ctx, sub, { maxWidth: area.w, maxHeight: area.h * 0.34, maxSize: subMax, minSize: short * 0.024, weight: 500, family: body.family, lineHeight: 1.3 }) : null;
  const headRoom = area.h - (subFit ? subFit.height + gap : 0) - (cta ? btnH + gap : 0);
  const headFit = headline ? fitText(ctx, headline, { maxWidth: area.w, maxHeight: Math.max(headRoom, short * 0.1), maxSize: hMax, minSize: short * 0.035, weight: 800, family: heading.family, lineHeight: 1.08 }) : null;
  const accentH = layout === "ad-left" && headline ? Math.round(short * 0.012) : 0;
  const blockH = (accentH ? accentH + gap : 0) + (headFit ? headFit.height : 0) + (subFit ? gap + subFit.height : 0) + (cta ? gap + btnH : 0);

  let y;
  if (layout === "ad-bottom") {
    const bandH = Math.min(H * 0.62, blockH + pad * 2);
    ctx.fillStyle = primary;
    ctx.fillRect(0, H - bandH, W, bandH);
    ctx.fillStyle = secondary;
    ctx.fillRect(0, H - bandH, W, Math.max(4, short * 0.008));
    y = H - bandH + pad;
  } else {
    y = area.y + Math.max(0, (area.h - blockH) / 2);
  }
  const x = centered ? W / 2 : area.x;
  const align = centered ? "center" : "left";

  if (accentH) {
    ctx.fillStyle = secondary;
    ctx.fillRect(area.x, y, Math.round(W * 0.09), accentH);
    y += accentH + gap;
  }
  if (headFit) y = drawLines(ctx, headFit, x, y, { weight: 800, family: heading.family, color: ink, align });
  if (subFit) {
    y += gap;
    y = drawLines(ctx, subFit, x, y, { weight: 500, family: body.family, color: ink === "#ffffff" ? "rgba(255,255,255,0.92)" : "rgba(17,17,17,0.85)", align });
  }
  if (cta) {
    y += gap;
    // On a solid brand colour the button is the ink colour (white or near-black); over a picture it is the secondary
    // brand colour — unless that is too dark to read as a button, in which case white.
    const onSolid = layout === "ad-bottom" || (!o.hasImage && layout !== "ad-left");
    const fill = onSolid ? ink : luminance(secondary) < 0.03 ? "#ffffff" : secondary;
    drawButton(ctx, cta, x, y, { size: btnSize, family: body.family, fill, align, maxWidth: area.w });
  }

  // Carousel position, top-right.
  if (o.slide && o.slide.count > 1) {
    const s = Math.round(short * 0.03);
    ctx.font = font(700, s, body.family);
    const label = `${o.slide.index + 1}/${o.slide.count}`;
    const w = ctx.measureText(label).width + s * 1.4, h = s * 1.9;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, W - pad - w, pad * 0.7, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, W - pad - w / 2, pad * 0.7 + h / 2);
  }

  // Logo: bottom-left (top-left over the picture when the band owns the bottom).
  const logoH = Math.min(short * 0.075, 110);
  if (layout === "ad-bottom") await drawLogo(ctx, o.logo, pad, pad + logoH, logoH, W * 0.3);
  else await drawLogo(ctx, o.logo, pad, H - pad * 0.7, logoH, W * 0.3);
}

async function drawMeme(ctx, o) {
  const { W, H, pad, layout, primary, heading, t, img } = o;
  const short = Math.min(W, H);
  const maxW = W - pad * 2;

  if (layout === "meme-top-bottom") {
    const opts = { maxWidth: maxW, maxHeight: H * 0.26, maxSize: short * 0.11, minSize: short * 0.04, weight: 900, family: heading.family, lineHeight: 1.05, upper: true };
    const style = { weight: 900, family: heading.family, color: "#ffffff", align: "center", stroke: 0.14, strokeColor: "#000000" };
    const top = fitText(ctx, t.top, opts);
    if (top.lines.length) drawLines(ctx, top, W / 2, pad * 0.6, style);
    const bottom = fitText(ctx, t.bottom, opts);
    if (bottom.lines.length) drawLines(ctx, bottom, W / 2, H - pad * 0.6 - bottom.height, style);
    return;
  }

  if (layout === "meme-caption") {
    const fit = fitText(ctx, t.caption, { maxWidth: maxW, maxHeight: H * 0.4, maxSize: short * 0.065, minSize: short * 0.03, weight: 600, family: o.body.family, lineHeight: 1.25 });
    const bandH = fit.lines.length ? Math.round(fit.height + pad * 1.4) : 0;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, bandH);
    if (img) drawCover(ctx, img, 0, bandH, W, H - bandH);
    else {
      ctx.save();
      ctx.translate(0, bandH);
      brandGradient(ctx, W, H - bandH, primary, "#120a24");
      ctx.restore();
    }
    if (fit.lines.length) drawLines(ctx, fit, pad, pad * 0.7, { weight: 600, family: o.body.family, color: "#111111", align: "left" });
    return;
  }

  if (layout === "meme-bar") {
    const fit = fitText(ctx, t.caption, { maxWidth: maxW, maxHeight: H * 0.24, maxSize: short * 0.075, minSize: short * 0.032, weight: 800, family: heading.family, lineHeight: 1.12 });
    if (!fit.lines.length) return;
    const bandH = Math.round(fit.height + pad * 1.2);
    ctx.fillStyle = primary;
    ctx.fillRect(0, H - bandH, W, bandH);
    drawLines(ctx, fit, W / 2, H - bandH + pad * 0.6, { weight: 800, family: heading.family, color: textOn(primary), align: "center" });
    return;
  }

  // meme-quote
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, W, H);
  const fit = fitText(ctx, t.caption, { maxWidth: W * 0.84, maxHeight: H * 0.7, maxSize: short * 0.12, minSize: short * 0.04, weight: 800, family: heading.family, lineHeight: 1.1 });
  if (fit.lines.length) drawLines(ctx, fit, W / 2, (H - fit.height) / 2, { weight: 800, family: heading.family, color: "#ffffff", align: "center" });
}
