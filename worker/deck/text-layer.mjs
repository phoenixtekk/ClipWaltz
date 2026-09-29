// WaltzDeck text layer: each scene's on-screen text drawn by headless Chromium from an HTML/CSS template,
// captured as PNG frames and composited by ffmpeg (06_ClipWaltz_WaltzDeck_Feature_Spec.md §5, spike
// 2026-09-29: ~0.4 s browser start, ~60 ms per frame at 1080p). Only the entrance animation is captured
// (ENTER_SEC); ffmpeg holds the last frame for the rest of the scene.
// Same layout names and proportions as src/components/deck/scene-frame.tsx (the in-browser preview).
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
export const FPS = 30;
export const ENTER_SEC = 0.7;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cssFont = (f, fallback) => `'${String(f || fallback).replace(/['"\\;{}]/g, "")}', ${fallback === "Montserrat" ? "sans-serif" : "sans-serif"}`;
const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c : d);

/**
 * HTML for one scene's text at W×H. `card` = the template paints its own brand background (text-only
 * scenes: title / CTA cards); otherwise the page is transparent and sits over the media.
 */
export function sceneHtml({ layout, text, W, H, brand = {}, card = false, safeBottom = 0 }) {
  const u = W / 100; // 1 "cqw"
  const primary = hex(brand.primary, "#8b5cf6");
  const dark = hex(brand.secondary, "#120a24");
  const hFont = cssFont(brand.headingFont, "Montserrat");
  const bFont = cssFont(brand.bodyFont, "Inter");
  const t = text ?? {};
  const headline = t.headline ? `<h1 class="h a1">${esc(t.headline)}</h1>` : "";
  const sub = t.sub ? `<p class="s a2">${esc(t.sub)}</p>` : "";
  const bullets = (t.bullets ?? []).filter(Boolean);
  const lay = card ? (layout === "cta-card" ? "cta-card" : "title-card") : layout;
  // Keep text clear of the watermark logo (bottom-left) when there is one.
  const sb = Math.max(7 * u, safeBottom);
  const cardOverMedia = !card && (layout === "title-card" || layout === "cta-card");
  let body;
  if (lay === "headline-center") body = `<div class="center">${headline}${sub}</div>`;
  else if (lay === "lower-third") body = `<div class="bar a1">${headline}${sub}</div>`;
  else if (lay === "bullets")
    body = `<div class="bottom grad">${headline}<ul>${bullets.map((b, i) => `<li class="a${Math.min(i + 2, 5)}"><i></i>${esc(b)}</li>`).join("")}</ul></div>`;
  else if (lay === "title-card" || lay === "cta-card")
    body = `<div class="card">${/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(brand.logoDataUrl ?? "") ? `<img class="logo a1" src="${brand.logoDataUrl}" alt="">` : ""}${headline}${t.sub ? `<p class="s a2 ${lay === "cta-card" ? "pill" : ""}">${esc(t.sub)}</p>` : ""}${bullets.length ? `<p class="s a3 meta">${bullets.map(esc).join(" · ")}</p>` : ""}</div>`;
  else body = `<div class="bottom grad">${headline}${sub}</div>`; // headline-bottom
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${card ? `radial-gradient(120% 90% at 20% 10%, ${primary} 0%, ${mix(primary, dark)} 45%, ${dark} 100%)` : "transparent"}}
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
.a1{animation:up .6s cubic-bezier(.2,.8,.2,1) both}.a2{animation:up .6s .12s cubic-bezier(.2,.8,.2,1) both}
.a3{animation:up .6s .2s cubic-bezier(.2,.8,.2,1) both}.a4{animation:up .6s .28s cubic-bezier(.2,.8,.2,1) both}.a5{animation:up .6s .34s cubic-bezier(.2,.8,.2,1) both}
.pill.a2{animation:pop .5s .15s cubic-bezier(.3,1.6,.5,1) both}
@keyframes up{from{opacity:0;transform:translateY(${4 * u}px)}to{opacity:1;transform:none}}
@keyframes pop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}
</style></head><body>${body}<script>
// Auto-fit: shrink each text block until the whole layout fits inside the frame (never overflows).
// Full-frame layouts (.center, .card) must not overflow their box; blocks that grow upward from the bottom
// (.bottom, .bar) only need to stay inside the frame — their scrollHeight includes glyph ink past the line
// box (Lato: 97 vs 80 px), which no amount of shrinking removes (verified 2026-09-29).
const fits = () => [...document.querySelectorAll('.center,.card')].every((b) => b.scrollHeight <= b.clientHeight + 6)
  && [...document.querySelectorAll('.center,.card')].every((b) => b.getBoundingClientRect().top >= 0)
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
</script></body></html>`;
}

// Blend two #rrggbb colours 50/50 (for the card gradient's middle stop).
function mix(a, b) {
  const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round((p(a, i) + p(b, i)) / 2).toString(16).padStart(2, "0")).join("")}`;
}

/** One headless browser for a whole render; renderScene() writes PNG frames into `outDir`. */
export async function createTextRenderer() {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"] });
  const page = await browser.newPage();
  return {
    /**
     * Render one scene's text. Returns { pattern, frames, fit } — `pattern` is an ffmpeg image2 pattern
     * (f%03d.png) of `frames` PNGs at FPS: the entrance animation, whose last frame is the settled layout.
     */
    async renderScene({ layout, text, W, H, brand, card, safeBottom }, outDir) {
      await page.setViewportSize({ width: W, height: H });
      await page.setContent(sceneHtml({ layout, text, W, H, brand, card, safeBottom }), { waitUntil: "load" });
      await page.evaluate(async () => { await document.fonts.ready; window.__doFit(); });
      const frames = Math.max(1, Math.round(ENTER_SEC * FPS));
      for (let f = 0; f < frames; f++) {
        const ms = f === frames - 1 ? 5000 : (f * 1000) / FPS; // the last frame is fully settled
        await page.evaluate((t) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t; }), ms);
        await page.screenshot({ path: join(outDir, `f${String(f).padStart(3, "0")}.png`), omitBackground: !card });
      }
      const fit = await page.evaluate(() => window.__fit);
      return { pattern: join(outDir, "f%03d.png"), frames, fit };
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
  for (const layout of ["headline-bottom", "headline-center", "lower-third", "bullets", "title-card", "cta-card"]) {
    const d = join(out, layout);
    mkdirSync(d, { recursive: true });
    const t0 = Date.now();
    const res = await r.renderScene({ layout, text: layout === "cta-card" ? { headline: "Ready for July?", sub: "Order at example.com" } : sample, W, H, card: layout.endsWith("card") }, d);
    writeFileSync(join(d, "info.json"), JSON.stringify({ ...res, ms: Date.now() - t0 }));
    console.log(layout, `${Date.now() - t0} ms`, `fit ${res.fit}`);
  }
  await r.close();
}
