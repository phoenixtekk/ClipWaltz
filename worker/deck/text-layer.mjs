// WaltzDeck text layer: each scene's on-screen text drawn by headless Chromium from an HTML/CSS template,
// captured as PNG frames and composited by ffmpeg (06_ClipWaltz_WaltzDeck_Feature_Spec.md §5, spike
// 2026-09-29: ~0.4 s browser start, ~60 ms per frame at 1080p). Only the entrance animation is captured
// (ENTER_SEC); ffmpeg holds the last frame for the rest of the scene.
// Same layout names and proportions as src/components/deck/scene-frame.tsx (the in-browser preview).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BACKDROP_CSS, backdropMarkup, backdropTone, textZone } from "./backdrop.mjs";

const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
export const FPS = 30;
export const ENTER_SEC = 0.7;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cssFont = (f, fallback) => `'${String(f || fallback).replace(/[^A-Za-z0-9 -]/g, "").slice(0, 40) || fallback}', sans-serif`;
const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c : d);

/**
 * HTML for one scene's text at W×H. `card` = a text-only scene: the template paints the scene's backdrop
 * (worker/deck/backdrop.mjs; `backdrop` = the resolved one, an AI image as a data URL) unless `bare` (the video render
 * draws the backdrop separately so it can drift); otherwise the page is transparent and sits over the media.
 * Slide exports (worker/deck/export.mjs) add `still` (no entrance animation), `bgDataUrl` (the scene's
 * media still under the text), `mediaCard` ({ dataUrl, rect } — media zoomed out below fill: the whole still as a card
 * on the backdrop) and `wmDataUrl` (the free-tier logo, bottom-left).
 */
export function sceneHtml({ layout, text, W, H, brand = {}, card = false, safeBottom = 0, still = false, bgDataUrl = null, wmDataUrl = null, backdrop = null, bare = false, mediaCard = null }) {
  const u = W / 100; // 1 "cqw"
  const primary = hex(brand.primary, "#8b5cf6");
  const dark = hex(brand.secondary, "#120a24");
  const hFont = cssFont(brand.headingFont, "Montserrat");
  const bFont = cssFont(brand.bodyFont, "Inter");
  const t = text ?? {};
  const headline = t.headline ? `<h1 class="h a1">${esc(t.headline)}</h1>` : "";
  const sub = t.sub ? `<p class="s a2">${esc(t.sub)}</p>` : "";
  const bullets = (t.bullets ?? []).filter(Boolean);
  const lay = card ? (layout === "cta-card" ? "cta-card" : layout === "slide" ? "slide" : "title-card") : layout;
  const bulletList = bullets.map((b, i) => `<li class="a${Math.min(i + 2, 5)}"><i></i><span>${esc(b)}</span></li>`).join("");
  // Keep text clear of the watermark logo (bottom-left) when there is one.
  const sb = Math.max(7 * u, safeBottom);
  const cardOverMedia = !card && (layout === "title-card" || layout === "cta-card");
  // Light backdrops (Paper, a light AI image) get dark words on text-only scenes.
  const inkDark = card && backdropTone(backdrop, textZone(lay, { card: true, wide: W >= H })) === "light";
  const bd = (card || mediaCard) && !bare
    ? backdropMarkup(backdrop, { primary, secondary: dark, aspect: W / H, zone: card ? textZone(lay, { card: true, wide: W >= H }) : "none" }) : "";
  const mc = mediaCard && /^data:image\/(png|jpeg);base64,/.test(mediaCard.dataUrl ?? "")
    ? `<img class="cwmc" src="${mediaCard.dataUrl}" alt="" style="left:${(mediaCard.rect.x * 100).toFixed(3)}%;top:${(mediaCard.rect.y * 100).toFixed(3)}%;width:${(mediaCard.rect.w * 100).toFixed(3)}%;height:${(mediaCard.rect.h * 100).toFixed(3)}%;object-fit:cover">` : "";
  let body;
  if (lay === "headline-center") body = `<div class="center">${headline}${sub}</div>`;
  else if (lay === "lower-third") body = `<div class="bar a1">${headline}${sub}</div>`;
  else if (lay === "bullets")
    body = `<div class="bottom grad">${headline}<ul>${bulletList}</ul></div>`;
  else if (lay === "slide") {
    // Presentation slide: title + accent bar + sub + points. Over media: a brand panel on the left (wide) or the
    // bottom (tall) and the media beside it; as a card: full-frame, top-left, logo top-right.
    const logo = card && /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(brand.logoDataUrl ?? "") ? `<img class="slogo" src="${brand.logoDataUrl}" alt="">` : "";
    body = `<div class="slide ${card ? "full" : W >= H ? "side" : "foot"}">${headline}${t.headline ? '<b class="acc a1"></b>' : ""}${sub}${bullets.length ? `<ul>${bulletList}</ul>` : ""}</div>${logo}`;
  }
  else if (lay === "title-card" || lay === "cta-card")
    body = `<div class="card">${/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(brand.logoDataUrl ?? "") ? `<img class="logo a1" src="${brand.logoDataUrl}" alt="">` : ""}${headline}${t.sub ? `<p class="s a2 ${lay === "cta-card" ? "pill" : ""}">${esc(t.sub)}</p>` : ""}${bullets.length ? `<p class="s a3 meta">${bullets.map(esc).join(" · ")}</p>` : ""}</div>`;
  else body = `<div class="bottom grad">${headline}${sub}</div>`; // headline-bottom
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:transparent;position:relative}
${bd ? BACKDROP_CSS : ""}
${inkDark ? `.h,li{color:#17121f !important}.s{color:#2a2238 !important}.meta{color:#3a3050 !important}.pill{color:#fff !important}` : ""}
*{box-sizing:border-box}
.h{margin:0;font-family:${hFont};font-weight:800;line-height:1.05;color:#fff;letter-spacing:-.01em;overflow-wrap:normal;max-width:100%}
.s{margin:0;font-family:${bFont};font-weight:500;line-height:1.3;color:#f3eeff;overflow-wrap:normal;max-width:100%}
.bottom{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;gap:${1.4 * u}px;padding:${7 * u}px;padding-bottom:${sb}px;padding-top:${22 * u}px}
.grad{background:linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,0))}
.bottom .h{font-size:${7.5 * u}px}.bottom .s{font-size:${4.2 * u}px}
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${2 * u}px;padding:${7 * u}px;text-align:center;background:rgba(0,0,0,.25)}
.center .h{font-size:${9 * u}px;text-shadow:0 ${0.3 * u}px ${1.6 * u}px rgba(0,0,0,.6)}.center .s{font-size:${4.2 * u}px;text-shadow:0 1px ${0.8 * u}px rgba(0,0,0,.6)}
.bar{position:absolute;left:${5 * u}px;right:${5 * u}px;bottom:${Math.max(6 * u * (H / W), sb)}px;border-radius:${1.5 * u}px;background:rgba(0,0,0,.6);padding:${2.5 * u}px ${4 * u}px}
.bar .h{font-size:${5 * u}px}.bar .s{font-size:${3.4 * u}px}
ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:${1 * u}px}
li{display:flex;align-items:flex-start;gap:${2 * u}px;font-family:${bFont};font-weight:600;font-size:${4 * u}px;color:#fff}
li i{flex:none;width:${1.8 * u}px;height:${1.8 * u}px;margin-top:${1.3 * u}px;border-radius:50%;background:${primary}}
.bottom:has(ul) .h{font-size:${6.5 * u}px}
.card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${2.5 * u}px;padding:${8 * u}px;padding-bottom:${Math.max(8 * u, sb)}px;text-align:center${cardOverMedia ? ";background:rgba(10,6,24,.55)" : ""}}
.card .h{font-size:${8.5 * u}px}.card .s{font-size:${4.4 * u}px}
.logo{max-height:${Math.round(H * 0.14)}px;max-width:${Math.round(W * 0.4)}px;object-fit:contain}
.pill{background:${primary};color:#fff !important;font-weight:700 !important;border-radius:999px;padding:${2 * u}px ${5 * u}px}
.meta{font-size:${3.6 * u}px !important;color:#e9dcff}
.slide{position:absolute;display:flex;flex-direction:column;justify-content:center;gap:${1.6 * u}px;overflow:hidden}
.slide.side{left:0;top:0;bottom:0;width:56%;padding:${5 * u}px ${4.5 * u}px;padding-bottom:${Math.max(5 * u, sb)}px;background:${rgba(dark, 0.9)}}
.slide.foot{left:0;right:0;bottom:0;height:56%;padding:${7 * u}px;padding-bottom:${sb}px;background:${rgba(dark, 0.9)}}
.slide.full{inset:0;justify-content:flex-start;padding:${W >= H ? 6 * u : 9 * u}px;padding-top:${W >= H ? 7 * u : 16 * u}px;padding-bottom:${Math.max(W >= H ? 6 * u : 9 * u, sb)}px}
.slide .h{font-size:${W >= H ? 5 * u : 8.5 * u}px}.slide.full .h{font-size:${W >= H ? 5.6 * u : 9 * u}px;padding-right:${W >= H ? 14 * u : 0}px}
.slide .s{font-size:${W >= H ? 2.4 * u : 4.4 * u}px}
.slide li{font-size:${W >= H ? 2.5 * u : 4.6 * u}px;font-weight:500;gap:.55em;line-height:1.3}
.slide li i{width:.42em;height:.42em;margin-top:.45em}
.slide ul{gap:.6em;margin-top:${0.6 * u}px}
.acc{display:block;flex:none;width:${W >= H ? 6 * u : 12 * u}px;height:${Math.max(4, 0.45 * u)}px;border-radius:99px;background:${primary}}
.slogo{position:absolute;top:${4 * u}px;right:${4 * u}px;max-height:${Math.round(H * 0.09)}px;max-width:${Math.round(W * 0.16)}px;object-fit:contain}
.bgimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.wm{position:absolute;left:${Math.round(Math.min(W, H) * 0.03)}px;bottom:${Math.round(Math.min(W, H) * 0.03)}px;width:${Math.round(Math.min(W, H) * 0.154)}px}
${still ? "*{animation:none !important}" : ""}
.a1{animation:up .6s cubic-bezier(.2,.8,.2,1) both}.a2{animation:up .6s .12s cubic-bezier(.2,.8,.2,1) both}
.a3{animation:up .6s .2s cubic-bezier(.2,.8,.2,1) both}.a4{animation:up .6s .28s cubic-bezier(.2,.8,.2,1) both}.a5{animation:up .6s .34s cubic-bezier(.2,.8,.2,1) both}
.pill.a2{animation:pop .5s .15s cubic-bezier(.3,1.6,.5,1) both}
@keyframes up{from{opacity:0;transform:translateY(${4 * u}px)}to{opacity:1;transform:none}}
@keyframes pop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}
</style></head><body>${bd}${mc}${bgDataUrl && !card && !mediaCard ? `<img class="bgimg" src="${bgDataUrl}" alt="">` : ""}${body}${wmDataUrl ? `<img class="wm" src="${wmDataUrl}" alt="">` : ""}<script>
// Auto-fit: shrink each text block until the whole layout fits inside the frame (never overflows).
// Full-frame layouts (.center, .card) must not overflow their box; blocks that grow upward from the bottom
// (.bottom, .bar) only need to stay inside the frame — their scrollHeight includes glyph ink past the line
// box (Lato: 97 vs 80 px), which no amount of shrinking removes (verified 2026-09-29).
const fits = () => [...document.querySelectorAll('.center,.card,.slide')].every((b) => b.scrollHeight <= b.clientHeight + 6)
  && [...document.querySelectorAll('.center,.card,.slide')].every((b) => b.getBoundingClientRect().top >= 0)
  && [...document.querySelectorAll('.bottom,.bar')].every((b) => b.getBoundingClientRect().top >= innerHeight * 0.2)
  && [...document.querySelectorAll('.h,.s,li')].every((el) => {
    // Inside the frame with the layout's side padding (a flex item can grow past its parent, so compare to the frame).
    const r = el.getBoundingClientRect(), pad = innerWidth * 0.04;
    return el.scrollWidth <= el.clientWidth + 1 && r.left >= pad - 1 && r.right <= innerWidth - pad + 1;
  });
// Run again by renderScene after document.fonts.ready: measured with a fallback font the text looks
// narrower than it renders (verified 2026-09-29 — a CTA URL ran off the frame).
window.__doFit = () => {
for (const el of document.querySelectorAll('.h,.s,li')) { if (el.dataset.fs) el.style.fontSize = el.dataset.fs + 'px'; el.style.overflowWrap = ''; }
let k = 1;
while (!fits() && k > 0.45) {
  k -= 0.05;
  for (const el of document.querySelectorAll('.h,.s,li')) {
    if (!el.dataset.fs) el.dataset.fs = parseFloat(getComputedStyle(el).fontSize);
    el.style.fontSize = (el.dataset.fs * k) + 'px';
  }
}
// Last resort (a single word wider than the frame even at the smallest size): allow breaking inside it.
if (!fits()) for (const el of document.querySelectorAll('.h,.s,li')) el.style.overflowWrap = 'anywhere';
window.__fit = k;
return k;
};
window.__doFit();
// Slide exports: every text run with its box (content box, px), font and colour — the PPTX places editable
// text boxes exactly where Chromium drew the text (worker/deck/export.mjs).
window.__measure = () => [...document.querySelectorAll('.h,.s,li>span')].filter((el) => el.textContent.trim()).map((el) => {
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el), n = (v) => parseFloat(v) || 0;
  const pl = n(cs.paddingLeft), pr = n(cs.paddingRight), pt = n(cs.paddingTop), pb = n(cs.paddingBottom);
  const size = n(cs.fontSize);
  // The lines exactly as Chromium wrapped them (words grouped by their line box), so the PPTX keeps the same
  // breaks even where the viewer's PowerPoint substitutes a font.
  const lines = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let lastTop = null;
  for (let tn = walker.nextNode(); tn; tn = walker.nextNode()) {
    const re = /[^\\s]+/g; // escaped: this script lives in a template literal
    for (let m = re.exec(tn.data); m; m = re.exec(tn.data)) {
      const rg = document.createRange();
      rg.setStart(tn, m.index); rg.setEnd(tn, m.index + m[0].length);
      const top = rg.getClientRects()[0]?.top ?? lastTop ?? 0;
      if (lastTop === null || top > lastTop + size * 0.5) lines.push(m[0]);
      else lines[lines.length - 1] += ' ' + m[0];
      lastTop = top;
    }
  }
  return {
    lines,
    kind: el.matches('.h') ? 'h' : el.matches('li>span') ? 'li' : 's', text: el.textContent,
    x: r.left + pl, y: r.top + pt, w: r.width - pl - pr, h: r.height - pt - pb,
    size, lineHeight: n(cs.lineHeight) || size * 1.2, font: cs.fontFamily, weight: n(cs.fontWeight) || 400,
    color: cs.color, align: ['center', 'right', 'end'].includes(cs.textAlign) ? (cs.textAlign === 'end' ? 'right' : cs.textAlign) : 'left',
  };
});
</script></body></html>`;
}

const rgba = (h, a) => `rgba(${[0, 1, 2].map((i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)).join(",")},${a})`;

/** One headless browser for a whole render; renderScene() writes PNG frames into `outDir`. */
export async function createTextRenderer() {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"] });
  let page, bgPage = null, mgPage = null;
  try {
    page = await browser.newPage();
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
  return {
    /**
     * Render one scene's text. Returns { pattern, frames, fit } — `pattern` is an ffmpeg image2 pattern
     * (f%03d.png) of `frames` PNGs at FPS: the entrance animation, whose last frame is the settled layout.
     */
    async renderScene({ layout, text, W, H, brand, card, safeBottom, backdrop = null, bare = false }, outDir) {
      await page.setViewportSize({ width: W, height: H });
      await page.setContent(sceneHtml({ layout, text, W, H, brand, card, safeBottom, backdrop, bare }), { waitUntil: "load" });
      await page.evaluate(async () => { await document.fonts.ready; window.__doFit(); });
      const frames = Math.max(1, Math.round(ENTER_SEC * FPS));
      for (let f = 0; f < frames; f++) {
        const ms = f === frames - 1 ? 5000 : (f * 1000) / FPS; // the last frame is fully settled
        await page.evaluate((t) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t; }), ms);
        await page.screenshot({ path: join(outDir, `f${String(f).padStart(3, "0")}.png`), omitBackground: !card || bare });
      }
      const fit = await page.evaluate(() => window.__fit);
      return { pattern: join(outDir, "f%03d.png"), frames, fit };
    },
    /**
     * A scene's backdrop alone as a PNG at 1.5× (headroom for the slow drift), with the drop shadow of a zoomed-out
     * media card baked in when `cardRect` ({ x, y, w, h } fractions) is given. `zone` = textZone().
     */
    async renderBackdrop({ backdrop, brand = {}, W, H, zone, cardRect = null }, file) {
      if (!bgPage) bgPage = await (await browser.newContext({ deviceScaleFactor: 1.5 })).newPage();
      await bgPage.setViewportSize({ width: W, height: H });
      const shadow = cardRect
        ? `<div class="cwmc" style="left:${cardRect.x * 100}%;top:${cardRect.y * 100}%;width:${cardRect.w * 100}%;height:${cardRect.h * 100}%;background:#000"></div>` : "";
      await bgPage.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative}${BACKDROP_CSS}</style></head><body>${
        backdropMarkup(backdrop, { primary: brand.primary, secondary: brand.secondary, aspect: W / H, zone })}<div style="position:absolute;inset:0;container-type:size">${shadow}</div></body></html>`, { waitUntil: "load" });
      await bgPage.screenshot({ path: file });
    },
    /**
     * An animated scene (worker/deck/motion.mjs) for its whole length: one PNG per frame at FPS, transparent when it's
     * an overlay over the scene's media. Returns { pattern, frames, opaque }.
     */
    async renderMotion({ layout, text, W, H, brand, dur, over, look, seed, variant, captions = null }, outDir) {
      const { motionHtml, motionOpaque } = await import("./motion.mjs");
      const opaque = motionOpaque(layout, over);
      if (!mgPage) mgPage = await browser.newPage();
      await mgPage.setViewportSize({ width: W, height: H });
      await mgPage.setContent(motionHtml({ layout, text, W, H, brand, dur, over, look, seed, variant, captions }), { waitUntil: "load" });
      await mgPage.evaluate(async () => { await document.fonts.ready; });
      const frames = Math.max(1, Math.round(dur * FPS));
      for (let f = 0; f < frames; f++) {
        await mgPage.evaluate((t) => window.render(t), f / FPS);
        await mgPage.screenshot({ path: join(outDir, `m${String(f).padStart(4, "0")}.png`), omitBackground: !opaque });
      }
      return { pattern: join(outDir, "m%04d.png"), frames, opaque };
    },
    /** White rounded rectangle on black, w×h px — the alpha mask that rounds a media card's corners. */
    async renderMask(w, h, radius, file) {
      await page.setViewportSize({ width: w, height: h });
      await page.setContent(`<!doctype html><html><body style="margin:0;background:#000;width:${w}px;height:${h}px;overflow:hidden"><div style="position:absolute;inset:0;background:#fff;border-radius:${radius}px"></div></body></html>`);
      await page.screenshot({ path: file });
    },
    async close() {
      await browser.close().catch(() => {});
    },
  };
}

// Diagnostic: node worker/deck/text-layer.mjs <outDir> [W H] — renders every layout once as a check.
if (process.argv[1] && process.argv[1].endsWith("text-layer.mjs") && process.argv[2]) {
  const { mkdirSync } = await import("node:fs");
  const out = process.argv[2];
  const W = +process.argv[3] || 1080, H = +process.argv[4] || 1920;
  const r = await createTextRenderer();
  const sample = { headline: "Summer in a can — cold brew that tastes like July", sub: "100% organic · slow-steeped 20 hours", bullets: ["Organic beans", "Steeped 20 hours", "Ships free"] };
  for (const layout of ["headline-bottom", "headline-center", "lower-third", "bullets", "title-card", "cta-card", "slide"]) {
    const d = join(out, layout);
    mkdirSync(d, { recursive: true });
    const t0 = Date.now();
    const res = await r.renderScene({ layout, text: layout === "cta-card" ? { headline: "Ready for July?", sub: "Order at example.com" } : sample, W, H, card: layout.endsWith("card") }, d);
    writeFileSync(join(d, "info.json"), JSON.stringify({ ...res, ms: Date.now() - t0 }));
    console.log(layout, `${Date.now() - t0} ms`, `fit ${res.fit}`);
  }
  await r.close();
}
