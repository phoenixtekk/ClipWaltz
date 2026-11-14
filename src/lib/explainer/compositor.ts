import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { registerFont } from "@/lib/explainer/fonts";
import type { ScriptSection, VisualType } from "./script";
import type { WordTiming } from "./voice";

// ─── Stage 3: the info layer ─────────────────────────────────────────────────
//
// This is where the real content of the video lives, and it is drawn
// deterministically — every diagram, label and caption is vector work from the
// script's `visual.spec`. Diffusion never touches this layer; it hallucinates
// letters, which is the whole reason the pipeline is built this way.
//
// Canvas rather than a browser, decided 2026-09-13 after measuring the
// alternative: a Remotion or Puppeteer compositor needs its own Chrome plus a
// package delta on linuxg1, which is a shared production host running GitLab,
// Zammad, PeerTube and Teknakul. `@napi-rs/canvas` is already a dependency and
// already draws production output in `ad-overlay.ts`, so this layer adds
// nothing to the host at all. The trade is ergonomics: animation here is
// per-frame drawing rather than CSS. For geometry, text and easing — which is
// all these five templates are — that is a fair trade.
//
// The geometry helpers below are deliberately local rather than shared with
// `ad-overlay.ts`: that file is working production code on the image path, and
// the video path needs its own easing and reveal behaviour. Coupling them would
// mean every animation tweak risks the ad overlay.

export const WIDTH = 1920;
export const HEIGHT = 1080;

/** Channel palette — the same one the landing and offer pages use. */
export const BRAND = {
  bg: "#05060c",
  ink: "#e9edff",
  muted: "#8b95bd",
  cyan: "#22e0d0",
  violet: "#7b5cff",
  magenta: "#ff4d9d",
  gold: "#f5c76a",
  line: "#ffffff1f",
  panel: "#ffffff0a",
} as const;

const FONT = registerFont("ExSans", "regular");
const FONT_BOLD = registerFont("ExSansBold", "bold");

// ─── Geometry + easing ───────────────────────────────────────────────────────

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Ease-out cubic — fast in, settles gently. Reads as deliberate, not bouncy. */
function ease(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  return 1 - Math.pow(1 - t, 3);
}

/**
 * How far into its own reveal element `i` of `n` is, at section progress `p`.
 *
 * Elements are staggered across the first 70% of the section so the last one has
 * landed well before the narration moves on — a reveal that completes exactly as
 * the section ends reads as a cut, not a build.
 */
function revealAt(p: number, i: number, n: number): number {
  const span = 0.7;
  const each = span / Math.max(1, n);
  return ease((p - i * each) / each);
}

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

/** Read an array of short labels out of a spec, tolerantly. */
function labels(spec: Record<string, unknown>, key: string, max = 5): string[] {
  const v = spec[key];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, max);
  // Fallback for a model that ignored the contract and emitted `step1`, `item2`…
  // The contract makes this rare; it is here so one bad generation degrades to a
  // plain list instead of an empty frame.
  const numbered = Object.keys(spec)
    .filter((k) => /^[a-z]+\d+$/i.test(k))
    .sort()
    .map((k) => String(spec[k]).trim())
    .filter(Boolean);
  return numbered.slice(0, max);
}

function text(spec: Record<string, unknown>, key: string): string {
  const v = spec[key];
  return typeof v === "string" ? v.trim() : "";
}

// ─── Templates ───────────────────────────────────────────────────────────────

function drawTitle(ctx: SKRSContext2D, spec: Record<string, unknown>, p: number) {
  const head = text(spec, "text") || "";
  const sub = text(spec, "subtext") || "";

  ctx.textAlign = "center";
  const a = revealAt(p, 0, 2);
  ctx.globalAlpha = a;
  ctx.fillStyle = BRAND.ink;
  ctx.font = `700 96px ${FONT_BOLD}`;
  const lines = wrap(ctx, head, WIDTH - 320, 3);
  lines.forEach((l, i) => ctx.fillText(l, WIDTH / 2, 440 + i * 112 + (1 - a) * 24));

  if (sub) {
    const b = revealAt(p, 1, 2);
    ctx.globalAlpha = b;
    ctx.fillStyle = BRAND.cyan;
    ctx.font = `400 42px ${FONT}`;
    wrap(ctx, sub, WIDTH - 400, 2).forEach((l, i) =>
      ctx.fillText(l, WIDTH / 2, 440 + lines.length * 112 + 60 + i * 56 + (1 - b) * 18),
    );
  }
  ctx.globalAlpha = 1;
}

function drawBullets(ctx: SKRSContext2D, spec: Record<string, unknown>, p: number) {
  const items = labels(spec, "items");
  const top = 380;
  ctx.textAlign = "left";
  items.forEach((it, i) => {
    const a = revealAt(p, i, items.length);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    const y = top + i * 108 + (1 - a) * 20;

    ctx.fillStyle = BRAND.cyan;
    ctx.beginPath();
    ctx.arc(250, y - 12, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = BRAND.ink;
    ctx.font = `400 46px ${FONT}`;
    ctx.fillText(wrap(ctx, it, WIDTH - 620, 1)[0] ?? "", 300, y);
  });
  ctx.globalAlpha = 1;
}

function drawFlow(ctx: SKRSContext2D, spec: Record<string, unknown>, p: number) {
  const steps = labels(spec, "steps");
  if (!steps.length) return;
  const n = steps.length;
  const boxW = Math.min(340, (WIDTH - 300 - (n - 1) * 60) / n);
  const boxH = 190;
  const totalW = n * boxW + (n - 1) * 60;
  const startX = (WIDTH - totalW) / 2;
  const y = 460;

  steps.forEach((s, i) => {
    const a = revealAt(p, i, n);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    const x = startX + i * (boxW + 60);

    ctx.fillStyle = BRAND.panel;
    ctx.strokeStyle = BRAND.line;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y + (1 - a) * 16, boxW, boxH, 18);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = BRAND.cyan;
    ctx.font = `700 26px ${FONT_BOLD}`;
    ctx.textAlign = "left";
    ctx.fillText(String(i + 1).padStart(2, "0"), x + 24, y + 48 + (1 - a) * 16);

    ctx.fillStyle = BRAND.ink;
    ctx.font = `400 30px ${FONT}`;
    wrap(ctx, s, boxW - 48, 3).forEach((l, li) =>
      ctx.fillText(l, x + 24, y + 96 + li * 38 + (1 - a) * 16),
    );

    // The arrow to the next box only appears once that box has begun to.
    if (i < n - 1) {
      const arrow = revealAt(p, i + 1, n);
      if (arrow > 0) {
        ctx.globalAlpha = arrow;
        ctx.strokeStyle = BRAND.violet;
        ctx.lineWidth = 4;
        const ax = x + boxW + 12;
        const ay = y + boxH / 2;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + 36, ay);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax + 36, ay);
        ctx.lineTo(ax + 24, ay - 10);
        ctx.lineTo(ax + 24, ay + 10);
        ctx.closePath();
        ctx.fillStyle = BRAND.violet;
        ctx.fill();
      }
    }
  });
  ctx.globalAlpha = 1;
}

function drawComparison(ctx: SKRSContext2D, spec: Record<string, unknown>, p: number) {
  const lt = text(spec, "leftTitle") || "This";
  const rt = text(spec, "rightTitle") || "That";
  const left = labels(spec, "left");
  const right = labels(spec, "right");

  const colW = 660;
  const gap = 80;
  const x0 = (WIDTH - (colW * 2 + gap)) / 2;
  const y = 340;
  // Height follows the content. A fixed 520 left half a panel empty whenever a
  // column had three short items, which is the common case.
  ctx.font = `400 32px ${FONT}`;
  const rowsFor = (items: string[]) =>
    items.reduce((n, it) => n + Math.max(1, wrap(ctx, it, colW - 100, 2).length), 0);
  const h = Math.min(540, 150 + Math.max(rowsFor(left), rowsFor(right)) * 66 + 30);

  ([
    [x0, lt, left, BRAND.cyan],
    [x0 + colW + gap, rt, right, BRAND.magenta],
  ] as [number, string, string[], string][]).forEach(([x, title, items, accent], col) => {
    const a = revealAt(p, col, 2 + Math.max(left.length, right.length));
    if (a <= 0) return;
    ctx.globalAlpha = a;

    ctx.fillStyle = BRAND.panel;
    ctx.strokeStyle = BRAND.line;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y + (1 - a) * 18, colW, h, 22);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = accent;
    ctx.font = `700 40px ${FONT_BOLD}`;
    ctx.fillText(wrap(ctx, title, colW - 80, 1)[0] ?? "", x + 40, y + 76 + (1 - a) * 18);

    ctx.fillStyle = BRAND.ink;
    ctx.font = `400 32px ${FONT}`;
    let yy = y + 150;
    items.forEach((it, i) => {
      const ia = revealAt(p, 2 + i, 2 + Math.max(left.length, right.length));
      if (ia <= 0) return;
      ctx.globalAlpha = ia;
      ctx.fillStyle = accent;
      ctx.fillRect(x + 40, yy - 14, 8, 8);
      ctx.fillStyle = BRAND.ink;
      wrap(ctx, it, colW - 100, 2).forEach((l, li) => ctx.fillText(l, x + 64, yy + li * 40));
      yy += 40 * Math.max(1, wrap(ctx, it, colW - 100, 2).length) + 26;
    });
  });
  ctx.globalAlpha = 1;
}

function drawDiagram(ctx: SKRSContext2D, spec: Record<string, unknown>, p: number) {
  const centre = text(spec, "center") || "";
  const around = labels(spec, "around");
  const cx = WIDTH / 2;
  // Measured from a real render: at cy 560 / r 300 the top node sat at y 260 and
  // covered the heading, which is drawn first and so lost its last word. The
  // drawable band is between the heading baseline (~270) and the caption band
  // (HEIGHT-180 = 900), and a node is ~76 tall, so the centre and radius are
  // pinned to keep both ends inside it.
  const cy = 585;
  const r = 265;

  // Spokes first so the nodes sit on top of them.
  around.forEach((_, i) => {
    const a = revealAt(p, i + 1, around.length + 1);
    if (a <= 0) return;
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, around.length);
    ctx.globalAlpha = a * 0.7;
    ctx.strokeStyle = BRAND.violet;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * 110, cy + Math.sin(ang) * 110);
    ctx.lineTo(cx + Math.cos(ang) * (r * a), cy + Math.sin(ang) * (r * a));
    ctx.stroke();
  });

  const ca = revealAt(p, 0, around.length + 1);
  ctx.globalAlpha = ca;
  ctx.fillStyle = BRAND.violet;
  ctx.beginPath();
  ctx.arc(cx, cy, 108, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 30px ${FONT_BOLD}`;
  ctx.textAlign = "center";
  wrap(ctx, centre, 190, 3).forEach((l, i, arr) =>
    ctx.fillText(l, cx, cy + 10 + (i - (arr.length - 1) / 2) * 34),
  );

  around.forEach((label, i) => {
    const a = revealAt(p, i + 1, around.length + 1);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, around.length);
    const nx = cx + Math.cos(ang) * r;
    const ny = cy + Math.sin(ang) * r;

    ctx.font = `400 28px ${FONT}`;
    const lines = wrap(ctx, label, 300, 2);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 56;
    const h = 34 * lines.length + 42;

    ctx.fillStyle = BRAND.bg;
    ctx.strokeStyle = BRAND.cyan;
    ctx.lineWidth = 2;
    roundRect(ctx, nx - w / 2, ny - h / 2, w, h, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = BRAND.ink;
    ctx.textAlign = "center";
    lines.forEach((l, li) => ctx.fillText(l, nx, ny + 10 + (li - (lines.length - 1) / 2) * 34));
  });
  ctx.globalAlpha = 1;
}

// ─── Chrome: heading + kinetic caption ───────────────────────────────────────

// ─── Variant templates ───────────────────────────────────────────────────────
//
// These exist so consecutive sections, and successive episodes, do not all look
// the same. Each one SHARES ITS SPEC SHAPE with an original, which is what makes
// the swap in `variety.ts` safe: nothing re-reads or re-validates the data, and a
// swap can never produce a spec a template cannot draw.
//
//   {items}  bullets  ·  checklist  ·  layers
//   {steps}  flow     ·  timeline
//   {text}   title    ·  stat
//
// The model is never told these exist. Its five-type contract took several
// attempts to make reliable — it hallucinated numbered keys and picture prompts —
// and widening the shape list it has to hold is the change most likely to break
// that. Variety is added afterwards, from data already validated.

/** `{items}` — a do-this list. Ticks and panels, where bullets are bare dots. */
function drawChecklist(ctx: SKRSContext2D, spec: Record<string, unknown>, p: number) {
  const items = labels(spec, "items");
  if (!items.length) return;
  const rowH = 104;
  const w = WIDTH - 560;
  const x = 280;
  const top = 380;

  ctx.textAlign = "left";
  items.forEach((it, i) => {
    const a = revealAt(p, i, items.length);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    const y = top + i * rowH + (1 - a) * 18;

    ctx.fillStyle = BRAND.panel;
    roundRect(ctx, x, y - 52, w, rowH - 16, 16);
    ctx.fill();

    // Tick, drawn as strokes rather than a glyph so it cannot fall back to tofu
    // on a host without the font.
    ctx.strokeStyle = BRAND.cyan;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x + 34, y - 14);
    ctx.lineTo(x + 50, y + 2);
    ctx.lineTo(x + 78, y - 30);
    ctx.stroke();

    ctx.fillStyle = BRAND.ink;
    ctx.font = `400 44px ${FONT}`;
    ctx.fillText(wrap(ctx, it, w - 160, 1)[0] ?? "", x + 110, y);
  });
  ctx.globalAlpha = 1;
}

/** `{items}` — stacked bands. Reads as a stack: policy over profile over device. */
function drawLayers(ctx: SKRSContext2D, spec: Record<string, unknown>, p: number) {
  const items = labels(spec, "items");
  if (!items.length) return;
  const n = items.length;
  const bandH = Math.min(120, Math.floor(560 / n));
  const gap = 14;
  const totalH = n * bandH + (n - 1) * gap;
  const top = 360 + Math.max(0, (560 - totalH) / 2);
  const hues = [BRAND.cyan, BRAND.violet, BRAND.magenta, BRAND.gold];

  ctx.textAlign = "center";
  items.forEach((it, i) => {
    const a = revealAt(p, i, n);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    // Each band inset a little more than the one above, so the stack reads as
    // depth rather than as a plain table.
    const inset = i * 26;
    const w = WIDTH - 640 - inset * 2;
    const x = (WIDTH - w) / 2;
    const y = top + i * (bandH + gap) + (1 - a) * 16;
    const hue = hues[i % hues.length];

    ctx.fillStyle = BRAND.panel;
    roundRect(ctx, x, y, w, bandH, 14);
    ctx.fill();
    ctx.strokeStyle = hue;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, bandH, 14);
    ctx.stroke();

    ctx.fillStyle = BRAND.ink;
    ctx.font = `600 ${Math.min(44, bandH - 56)}px ${FONT_BOLD}`;
    ctx.fillText(wrap(ctx, it, w - 80, 1)[0] ?? "", WIDTH / 2, y + bandH / 2 + 14);
  });
  ctx.globalAlpha = 1;
}

/** `{steps}` — a horizontal spine with labels alternating above and below. */
function drawTimeline(ctx: SKRSContext2D, spec: Record<string, unknown>, p: number) {
  const steps = labels(spec, "steps");
  if (!steps.length) return;
  const n = steps.length;
  const y = 620;
  const x0 = 320;
  const x1 = WIDTH - 320;
  const dx = n > 1 ? (x1 - x0) / (n - 1) : 0;

  // The spine grows with the reveal, so the section reads as time passing — but
  // it must never stop short of a node that is already showing. Growing it on its
  // own curve left the last dot floating in space past the end of the line
  // (measured at p=0.75: spine to x=1424, node at x=1600). So it is drawn to the
  // last revealed node, which by definition cannot lag behind them.
  let lastVisible = 0;
  for (let i = 0; i < n; i++) if (revealAt(p, i, n) > 0) lastVisible = i;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = BRAND.line;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x0 + dx * lastVisible, y);
  ctx.stroke();

  ctx.textAlign = "center";
  steps.forEach((st, i) => {
    const a = revealAt(p, i, n);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    const x = x0 + dx * i;
    const above = i % 2 === 0;

    ctx.fillStyle = BRAND.cyan;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = BRAND.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, above ? y - 22 : y + 22);
    ctx.lineTo(x, above ? y - 70 : y + 70);
    ctx.stroke();

    ctx.fillStyle = BRAND.ink;
    ctx.font = `400 36px ${FONT}`;
    const lines = wrap(ctx, st, Math.max(220, dx - 40), 2);
    lines.forEach((l, li) => {
      const base = above ? y - 96 - (lines.length - 1 - li) * 44 : y + 116 + li * 44;
      ctx.fillText(l, x, base + (1 - a) * 12);
    });
  });
  ctx.globalAlpha = 1;
}

/** `{text, subtext}` — the headline treatment, set as one large figure. */
function drawStat(ctx: SKRSContext2D, spec: Record<string, unknown>, p: number) {
  const head = text(spec, "text") || "";
  const sub = text(spec, "subtext") || "";

  // A leading number is the thing worth enlarging; when there isn't one the whole
  // phrase is set large instead, which still differs from `title` because of the
  // rule and the colour.
  const m = /^(\S+)\s*(.*)$/.exec(head.trim());
  const lead = m?.[1] ?? head;
  const rest = m?.[2] ?? "";
  const numeric = /\d/.test(lead);

  ctx.textAlign = "center";
  const a = revealAt(p, 0, 2);
  ctx.globalAlpha = a;

  ctx.fillStyle = BRAND.cyan;
  ctx.font = `700 ${numeric ? 200 : 120}px ${FONT_BOLD}`;
  ctx.fillText(numeric ? lead : wrap(ctx, head, WIDTH - 400, 1)[0] ?? head, WIDTH / 2, 520 + (1 - a) * 20);

  if (numeric && rest) {
    ctx.fillStyle = BRAND.ink;
    ctx.font = `600 56px ${FONT_BOLD}`;
    wrap(ctx, rest, WIDTH - 500, 2).forEach((l, i) => ctx.fillText(l, WIDTH / 2, 610 + i * 66));
  }

  // A rule under the figure, which no other template uses.
  const b = revealAt(p, 1, 2);
  ctx.globalAlpha = b;
  ctx.strokeStyle = BRAND.violet;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(WIDTH / 2 - 160 * b, 700);
  ctx.lineTo(WIDTH / 2 + 160 * b, 700);
  ctx.stroke();

  if (sub) {
    ctx.fillStyle = BRAND.muted;
    ctx.font = `400 42px ${FONT}`;
    wrap(ctx, sub, WIDTH - 500, 2).forEach((l, i) => ctx.fillText(l, WIDTH / 2, 780 + i * 56));
  }
  ctx.globalAlpha = 1;
}

function drawHeading(ctx: SKRSContext2D, heading: string, p: number) {
  const a = ease(p / 0.06);
  ctx.globalAlpha = a;
  ctx.textAlign = "left";
  ctx.fillStyle = BRAND.cyan;
  ctx.fillRect(160, 168, 72, 5);
  ctx.fillStyle = BRAND.ink;
  ctx.font = `700 52px ${FONT_BOLD}`;
  ctx.fillText(wrap(ctx, heading, WIDTH - 400, 1)[0] ?? "", 160, 246);
  ctx.globalAlpha = 1;
}

/**
 * The caption band: the words being spoken right now, with the current one lit.
 *
 * This is what the ElevenLabs timing map buys. A caption that merely sits there
 * is decoration; one that moves with the voice is why the video holds someone
 * who is half-watching.
 */
function drawCaption(ctx: SKRSContext2D, words: WordTiming[], t: number) {
  if (!words.length) return;
  let idx = words.findIndex((w) => t >= w.start && t <= w.end);
  if (idx === -1) {
    // Between words — stay on the one just spoken rather than blanking.
    for (let i = words.length - 1; i >= 0; i--) {
      if (t > words[i].end) {
        idx = i;
        break;
      }
    }
  }
  if (idx === -1) return;

  // A short window around the current word, so the band reads as a phrase.
  const from = Math.max(0, idx - 5);
  const slice = words.slice(from, from + 11);

  // Measure each word in the font it will actually be DRAWN in. The live word is
  // bold and therefore wider; measuring everything in the regular face ran the
  // highlighted word into the next one ("inspectorto prove") in a real render.
  const widths = slice.map((w, i) => {
    ctx.font = from + i === idx ? `700 40px ${FONT_BOLD}` : `400 40px ${FONT}`;
    return ctx.measureText(`${w.word} `).width;
  });
  const total = widths.reduce((a, b) => a + b, 0);

  const bandH = 108;
  const bandY = HEIGHT - 180;
  ctx.fillStyle = "#05060cd0";
  roundRect(ctx, (WIDTH - (total + 96)) / 2, bandY, total + 96, bandH, 26);
  ctx.fill();

  let x = (WIDTH - total) / 2;
  ctx.textAlign = "left";
  slice.forEach((w, i) => {
    const live = from + i === idx;
    ctx.fillStyle = live ? BRAND.gold : BRAND.muted;
    ctx.font = live ? `700 40px ${FONT_BOLD}` : `400 40px ${FONT}`;
    ctx.fillText(w.word, x, bandY + 68);
    x += widths[i];
  });
}

// ─── The frame ───────────────────────────────────────────────────────────────

const TEMPLATES: Record<VisualType, (c: SKRSContext2D, s: Record<string, unknown>, p: number) => void> = {
  title: drawTitle,
  bullets: drawBullets,
  flow: drawFlow,
  comparison: drawComparison,
  diagram: drawDiagram,
  // Variants. Same spec shapes as the five above — see the note by their
  // definitions — so `variety.ts` can substitute one for another safely.
  checklist: drawChecklist,
  layers: drawLayers,
  timeline: drawTimeline,
  stat: drawStat,
};

/**
 * One frame of the info layer, as a PNG with transparency where the ambient
 * background should show through.
 *
 * `t` is seconds into the WHOLE video, and the section window is passed in, so
 * the caller never has to rebase timings — `voice.ts` already produced them
 * against the final assembled audio.
 */
export function renderFrame(opts: RenderOpts): Buffer {
  return draw(opts).toBuffer("image/png");
}

/**
 * The same frame as raw RGBA pixels, for piping straight into ffmpeg.
 *
 * Measured on linuxg1, 1920×1080: drawing a frame takes **2 ms**; encoding it to
 * PNG takes **139 ms**. Over a five-minute episode at 30fps that is the
 * difference between **21 minutes** and **under one** — so the assembly path
 * never encodes PNGs. `renderFrame` above stays for stills, thumbnails and
 * eyeballing single frames, where one encode does not matter.
 */
export function renderFrameRaw(opts: RenderOpts): Buffer {
  const canvas = draw(opts);
  const px = canvas.getContext("2d").getImageData(0, 0, WIDTH, HEIGHT);
  return Buffer.from(px.data.buffer, px.data.byteOffset, px.data.byteLength);
}

interface RenderOpts {
  section: ScriptSection;
  /** Word timings for the whole narration; only the live window is drawn. */
  words: WordTiming[];
  t: number;
  sectionStart: number;
  sectionEnd: number;
  /** Draw the dark background too. Off when compositing over ambient video. */
  opaque?: boolean;
}

function draw(opts: RenderOpts) {
  const { section, words, t, sectionStart, sectionEnd } = opts;
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  if (opts.opaque !== false) {
    ctx.fillStyle = BRAND.bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  const span = Math.max(0.001, sectionEnd - sectionStart);
  const p = Math.min(1, Math.max(0, (t - sectionStart) / span));

  drawHeading(ctx, section.heading, p);
  TEMPLATES[section.visual.type](ctx, section.visual.spec, p);
  drawCaption(ctx, words, t);

  return canvas;
}
