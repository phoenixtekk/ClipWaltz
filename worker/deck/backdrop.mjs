// WaltzDeck backdrops (owner request 2026-10-03): what sits behind a text-only scene (and behind media zoomed out
// below "fill"). One plain-JS module shared by the editor preview (src/components/deck/scene-frame.tsx), the video
// render (worker/deck/text-layer.mjs → render-worker.mjs) and the PDF / PPTX export (worker/deck/export.mjs), so all
// three draw the exact same thing. Pure CSS/SVG in container-query units (cqw/cqh/cqmin): it scales to any frame.
//
// Rules every style follows: tinted from the brand kit (primary = --p, dark = --s), decoration kept OUT of the
// scene's text zone, and a soft "veil" pooled behind the words so they always read. Mockup the owner picked:
// https://claude.ai/artifact/AN5HL8c7RjHjxG914oVq6V

/** Style keys in picker order. "brand" = the original two-colour gradient (the default); "ai" = a generated image. */
export const BACKDROP_STYLES = [
  { key: "brand", label: "Brand gradient", desc: "The classic two-colour brand card." },
  { key: "aurora", label: "Aurora", desc: "Soft glows in the corners." },
  { key: "orbit", label: "Orbits", desc: "Thin glowing arcs and nodes." },
  { key: "stage", label: "Stage", desc: "A dark room with a lit horizon." },
  { key: "mesh", label: "Mesh", desc: "Smooth multi-colour gradient." },
  { key: "grid", label: "Horizon grid", desc: "A faint perspective floor." },
  { key: "glass", label: "Glass panels", desc: "Frosted cards at the edges." },
  { key: "paper", label: "Paper", desc: "Light and editorial, dark text." },
  { key: "bokeh", label: "Bokeh", desc: "Out-of-focus lights." },
];
const KEYS = new Set([...BACKDROP_STYLES.map((s) => s.key), "ai"]);
export const INTENSITIES = ["calm", "balanced", "vivid"];
const DECOR = { calm: 0.5, balanced: 0.8, vivid: 1 };

/** Lowest media zoom: below 1 the media shrinks to a card on the scene's backdrop (Edit media). */
export const MIN_FRAME_ZOOM = 0.6;

const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c.toLowerCase() : d);
const mixHex = (a, b, t = 0.5) => {
  const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t).toString(16).padStart(2, "0")).join("")}`;
};

/** A valid stored backdrop from anything a client sent; null = "use the deck default". */
export function normBackdrop(v) {
  if (!v || typeof v !== "object") return null;
  const style = KEYS.has(v.style) ? v.style : null;
  if (!style) return null;
  const out = { style, intensity: INTENSITIES.includes(v.intensity) ? v.intensity : "balanced", seed: Math.abs(Math.trunc(Number(v.seed) || 0)) % 100000 };
  if (style === "ai") {
    const id = typeof v.imageId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v.imageId) ? v.imageId : null;
    if (!id) return null;
    out.imageId = id;
  }
  return out;
}

// Which cells of an AI image's 3×3 brightness grid (row-major, 0–255) lie under the words of each text zone.
const ZONE_CELLS = { center: [4], left: [0, 3, 1], top: [0, 1, 2], bottom: [6, 7, 8], none: [4] };

/**
 * "light" when the backdrop is light where the words are (→ dark words, white veil). Paper always; an AI image by the
 * brightness of the cells under `zone` (its `grid`), else by its overall tone.
 */
export function backdropTone(b, zone = "center") {
  if (b?.style === "paper") return "light";
  if (b?.style !== "ai") return "dark";
  if (Array.isArray(b.grid) && b.grid.length === 9) {
    const cells = ZONE_CELLS[zone] ?? ZONE_CELLS.center;
    return cells.reduce((n, i) => n + (Number(b.grid[i]) || 0), 0) / cells.length > 150 ? "light" : "dark";
  }
  return b.tone === "light" ? "light" : "dark";
}

/**
 * Where a scene's words sit, so decoration stays clear of them: "center" | "left" | "top" | "bottom" | "none".
 * `card` = text-only scene; `wide` = W ≥ H.
 */
export function textZone(layout, { card, wide }) {
  if (card) return layout === "slide" ? (wide ? "left" : "top") : "center";
  if (layout === "headline-center" || layout === "title-card" || layout === "cta-card") return "center";
  if (layout === "slide") return "none"; // the slide panel carries its own background
  return "bottom";
}

/**
 * The media card for a zoom below 1: the whole upright media, contained in zoom × `area` (default the whole frame,
 * see mediaArea), centred in it. Fractions of the frame ({ x, y, w, h }). `frameAspect` / `mediaAspect` = width / height.
 */
export function cardRect(frameAspect, mediaAspect, zoom, area = FULL) {
  const z = Math.max(MIN_FRAME_ZOOM, Math.min(1, Number(zoom) || 1));
  const m = mediaAspect > 0 ? mediaAspect : frameAspect;
  const A = (frameAspect * area.w) / area.h; // the area's own shape
  const w = (m >= A ? z : (z * m) / A) * area.w;
  const h = (m >= A ? (z * A) / m : z) * area.h;
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}
const FULL = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Where a zoomed-out media card sits for a layout: the whole frame, or — under a slide's text panel (left 56 % when
 * wide, bottom 56 % when tall) — the free part beside it.
 */
export const mediaArea = (layout, wide) =>
  layout === "slide" ? (wide ? { x: 0.56, y: 0, w: 0.44, h: 1 } : { x: 0, y: 0, w: 1, h: 0.44 }) : FULL;

// Small deterministic RNG so "Shuffle" (a new seed) re-arranges a style the same way in the preview and the render.
function rng(seed) {
  let a = (Number(seed) || 0) + 0x9e3779b9;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VEIL_AT = { center: [50, 50, 58, 46], left: [30, 40, 50, 70], top: [45, 28, 72, 42], bottom: [50, 80, 70, 36] };

/** Shared CSS (inject once per page; every instance is configured by CSS variables on its root). */
export const BACKDROP_CSS = `
.cwbd{position:absolute;inset:0;overflow:hidden;container-type:size;background:var(--s);isolation:isolate}
.cwbd>.bd,.cwbd>.dc,.cwbd>.vl{position:absolute;inset:0;pointer-events:none}
.cwbd>.dc{opacity:var(--i)}
.cwbd.vivid>.dc{filter:saturate(1.25)}
.cwbd .f{position:absolute;inset:-3%}
.cwbd .f.fx{transform:scaleX(-1)}.cwbd .f.fy{transform:scaleY(-1)}.cwbd .f.fx.fy{transform:scale(-1,-1)}
.cwbd>.vl{background:radial-gradient(var(--vw) var(--vh) at var(--tx) var(--ty),var(--vc),transparent 75%)}
.cwbd i{position:absolute;display:block;font-style:normal}
.cwbd svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.cwbd-brand>.bd{background:radial-gradient(120% 90% at 20% 10%,var(--p) 0%,var(--m) 45%,var(--s) 100%)}
.cwbd-aurora .f{filter:blur(6cqmin)}
.cwbd-aurora .f i{border-radius:50%}
.cwbd-orbit>.bd{background:radial-gradient(90% 70% at 50% 120%,color-mix(in srgb,var(--p) 22%,var(--s)),var(--s))}
.cwbd-stage>.bd{background:linear-gradient(180deg,color-mix(in srgb,var(--s) 80%,#000) 0%,var(--s) var(--hz),color-mix(in srgb,var(--s) 70%,#000) 100%)}
.cwbd-stage .hz{left:0;right:0;top:var(--hz);height:max(2px,.3cqmin);background:linear-gradient(90deg,transparent,var(--p) 28%,#ffd08a 50%,var(--p) 72%,transparent);filter:blur(.15cqmin)}
.cwbd-stage .fl{left:8%;right:8%;top:var(--hz);bottom:0;background:radial-gradient(50% 60% at 50% 0%,color-mix(in srgb,var(--p) 45%,transparent),transparent 70%)}
.cwbd-stage .sp{left:28%;right:28%;top:-8%;height:75%;background:radial-gradient(40% 100% at 50% 0%,rgba(255,255,255,.14),transparent 70%)}
.cwbd-mesh>.bd{opacity:calc(.45 + var(--i) * .5)}
.cwbd-mesh>.dc{opacity:1;background:radial-gradient(120% 120% at 50% 50%,transparent 45%,var(--s) 100%)}
.cwbd-grid>.bd{background:linear-gradient(180deg,var(--s) 0%,color-mix(in srgb,var(--p) 18%,var(--s)) var(--hz),var(--s) 100%)}
.cwbd-grid .f{perspective:45cqmin}
.cwbd-grid .pl{left:-60%;right:-60%;top:var(--hz);height:110%;transform:rotateX(72deg);transform-origin:top;
  background-image:linear-gradient(color-mix(in srgb,var(--p) 70%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--p) 70%,transparent) 1px,transparent 1px);
  background-size:6cqmin 6cqmin;-webkit-mask-image:linear-gradient(180deg,#000 0%,transparent 55%);mask-image:linear-gradient(180deg,#000 0%,transparent 55%)}
.cwbd-grid .hl{left:0;right:0;top:var(--hz);height:max(2px,.25cqmin);background:linear-gradient(90deg,transparent,var(--p),transparent);box-shadow:0 0 2cqmin var(--p)}
.cwbd-glass>.bd{background:radial-gradient(80% 80% at 50% 50%,color-mix(in srgb,var(--p) 14%,var(--s)),var(--s))}
.cwbd-glass .gp{border-radius:1.6cqmin;border:1px solid rgba(255,255,255,.14);background:linear-gradient(160deg,rgba(255,255,255,.12),rgba(255,255,255,.03));box-shadow:0 2cqmin 5cqmin rgba(0,0,0,.35)}
.cwbd-glass .gp::before{content:"";position:absolute;left:12%;top:16%;width:40%;height:7%;border-radius:2cqmin;background:var(--p);opacity:.8}
.cwbd-glass .gp::after{content:"";position:absolute;left:12%;right:15%;top:34%;height:30%;background:repeating-linear-gradient(180deg,rgba(255,255,255,.22) 0 9%,transparent 9% 22%)}
.cwbd-paper{background:var(--pp)}
.cwbd-paper>.bd{background:var(--pp)}
.cwbd-paper>.bd::after{content:"";position:absolute;inset:0;opacity:.35;background-image:radial-gradient(rgba(0,0,0,.18) .6px,transparent .7px);background-size:1cqmin 1cqmin}
.cwbd-paper .c1{border-radius:50%;background:color-mix(in srgb,var(--p) 30%,#fff)}
.cwbd-paper .c2{border-radius:50%;border:.6cqmin solid color-mix(in srgb,var(--p) 55%,#fff)}
.cwbd-paper .c3{border-radius:50%;background:var(--p)}
.cwbd-bokeh>.bd{background:linear-gradient(160deg,color-mix(in srgb,var(--p) 25%,var(--s)),var(--s) 65%)}
.cwbd-bokeh .f i{border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--c) 85%,#fff),transparent 70%)}
.cwbd-ai>.bd{background-size:cover;background-position:center;filter:brightness(var(--ab))}
.cwmc{position:absolute;overflow:hidden;border-radius:1.6cqmin;box-shadow:0 2.5cqmin 6cqmin rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.12)}
`;

/**
 * Markup for one backdrop (needs BACKDROP_CSS on the page). `b` = { style, intensity, seed, imageUrl?, tone? } (the
 * scene's effective backdrop); brand colours; `aspect` = frame width / height; `zone` from textZone().
 */
export function backdropMarkup(b, { primary, secondary, aspect = 16 / 9, zone = "center" } = {}) {
  const style = KEYS.has(b?.style) ? b.style : "brand";
  const intensity = INTENSITIES.includes(b?.intensity) ? b.intensity : "balanced";
  const p = hex(primary, "#8b5cf6"), s = hex(secondary, "#120a24");
  const tall = aspect < 1;
  const r = rng(b?.seed ?? 0);
  const light = backdropTone({ ...b, style }, zone) === "light";
  // Veil: a pool of the dark (or, on light styles, white) colour under the words.
  const [tx, ty, vw, vh] = VEIL_AT[zone] ?? VEIL_AT.center;
  const veilA = style === "ai" ? { calm: 0.72, balanced: 0.58, vivid: 0.42 }[intensity] : light ? 0.6 : 0.62;
  const vc = light ? `rgba(255,255,255,${veilA})` : `color-mix(in srgb,${s} ${Math.round(veilA * 100)}%,transparent)`;
  const vars = [
    `--p:${p}`, `--s:${s}`, `--m:${mixHex(p, s)}`, `--i:${DECOR[intensity]}`, `--pp:${mixHex("#fbfaf7", p, 0.07)}`,
    `--tx:${tx}%`, `--ty:${ty}%`, `--vw:${vw}%`, `--vh:${vh}%`, `--vc:${vc}`,
  ];
  // Mirror the decoration away from the text: text on the left → decoration on the right, text on top → bottom.
  // Otherwise the seed picks a side, so Shuffle visibly changes the slide.
  let fx = zone === "left" ? true : zone === "center" || zone === "bottom" || zone === "none" ? r() < 0.5 : r() < 0.5;
  let fy = zone === "top" ? true : false;
  let decor = "";
  let bd = "";
  switch (style) {
    case "brand":
      return `<div class="cwbd cwbd-brand" style="${vars.join(";")}"><div class="bd"></div></div>`;
    case "aurora": {
      const j = () => Math.round((r() - 0.5) * 10);
      const blobs = tall
        ? [[-25 + j(), -12 + j(), 95, 42, "var(--p)"], [30 + j(), 72 + j(), 85, 40, `color-mix(in srgb,var(--p) 55%,#ff8a3d)`], [55, -10, 50, 26, `color-mix(in srgb,var(--p) 50%,#38bdf8)`]]
        : [[-14 + j(), -22 + j(), 58, 72, "var(--p)"], [62 + j(), 64 + j(), 48, 62, `color-mix(in srgb,var(--p) 55%,#ff8a3d)`], [60, -14, 30, 40, `color-mix(in srgb,var(--p) 50%,#38bdf8)`]];
      decor = blobs.map(([x, y, w, h, c], k) => `<i style="left:${x}%;top:${y}%;width:${w}%;height:${h}%;background:${c};${k === 2 ? "opacity:.7" : ""}"></i>`).join("");
      break;
    }
    case "orbit": {
      // Drawn in a viewBox with the frame's own shape (height 100), so circles stay round at any aspect.
      const W = Math.round(100 * aspect * 100) / 100, m = Math.min(W, 100);
      // Orb in a corner, clear of the words (a centred title spans most of the width).
      const ox = tall ? W * 0.22 : W * 0.09, oy = tall ? 14 : zone === "left" ? 46 : 20;
      const n = (x, y, rr, c) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr}" style="fill:${c}"/>`;
      decor = `<svg viewBox="0 0 ${W} 100" preserveAspectRatio="none" aria-hidden="true">
<defs><linearGradient id="cwog${b?.seed ?? 0}" x1="0" x2="1"><stop offset="0" style="stop-color:var(--p)"/><stop offset="1" style="stop-color:#ffb347"/></linearGradient></defs>
<g fill="none" stroke="url(#cwog${b?.seed ?? 0})" stroke-width="${(m * 0.004).toFixed(3)}" opacity=".9">
<ellipse cx="${ox.toFixed(1)}" cy="${oy}" rx="${(m * 0.27).toFixed(1)}" ry="${(m * 0.12).toFixed(1)}" transform="rotate(-18 ${ox.toFixed(1)} ${oy})"/>
<ellipse cx="${ox.toFixed(1)}" cy="${oy}" rx="${(m * 0.2).toFixed(1)}" ry="${(m * 0.17).toFixed(1)}" transform="rotate(30 ${ox.toFixed(1)} ${oy})" stroke-dasharray="${(m * 0.012).toFixed(2)} ${(m * 0.018).toFixed(2)}"/>
${zone === "top" || zone === "bottom" ? "" : `<path d="M0 ${tall ? 88 : 90} C ${(W * 0.25).toFixed(1)} ${tall ? 82 : 84}, ${(W * 0.4).toFixed(1)} ${tall ? 94 : 95}, ${W} ${tall ? 76 : 80}"/>`}
${zone === "center" || zone === "none" ? `<path d="M${(W * 0.72).toFixed(1)} ${tall ? 6 : 12} C ${(W * 0.84).toFixed(1)} ${tall ? 3 : 7}, ${(W * 0.93).toFixed(1)} ${tall ? 9 : 16}, ${W} ${tall ? 5 : 9}"/>` : ""}</g>
<circle cx="${ox.toFixed(1)}" cy="${oy}" r="${(m * 0.1).toFixed(1)}" style="fill:var(--p);opacity:.5;filter:blur(${(m * 0.025).toFixed(2)}px)"/>
<circle cx="${ox.toFixed(1)}" cy="${oy}" r="${(m * 0.065).toFixed(1)}" style="fill:#fff;opacity:.85"/>
${n(ox + m * 0.25, oy - m * 0.1, (m * 0.011).toFixed(2), "var(--p)")}${n(ox - m * 0.18, oy + m * 0.17, (m * 0.011).toFixed(2), "var(--p)")}
${zone === "top" || zone === "bottom" ? "" : n(W * 0.22, tall ? 86 : 87, (m * 0.01).toFixed(2), "var(--p)") + n(W * 0.6, tall ? 87 : 89, (m * 0.01).toFixed(2), "#ffb347")}
${zone === "center" || zone === "none" ? n(W * 0.84, tall ? 4 : 8, (m * 0.01).toFixed(2), "#ffb347") : ""}${zone === "top" || zone === "bottom" ? "" : n(W * 0.94, tall ? 78 : 82, (m * 0.01).toFixed(2), "#ffb347")}</svg>`;
      break;
    }
    case "stage":
      // Symmetric room: only the horizon height depends on where the text is.
      fx = false; fy = false;
      vars.push(`--hz:${zone === "bottom" ? 46 : tall ? 70 : 66}%`);
      decor = `<i class="sp"></i><i class="fl"></i><i class="hz"></i>`;
      break;
    case "mesh": {
      const q = () => Math.round(r() * 20 - 10);
      bd = `background:radial-gradient(60% 70% at ${10 + q()}% ${20 + q()}%,var(--p),transparent 60%),radial-gradient(55% 65% at ${90 + q()}% ${85 + q()}%,color-mix(in srgb,var(--p) 40%,#22d3ee),transparent 60%),radial-gradient(50% 60% at ${85 + q()}% ${10 + q()}%,color-mix(in srgb,var(--p) 50%,#f472b6),transparent 60%),var(--s)`;
      fy = false;
      decor = "<i></i>"; // .dc carries the vignette
      break;
    }
    case "grid":
      fx = false; fy = false;
      vars.push(`--hz:${zone === "bottom" ? 42 : tall ? 66 : 60}%`);
      decor = `<i class="pl"></i><i class="hl"></i>`;
      break;
    case "glass": {
      const panels = tall
        ? [[6, 5, 34, 14, -6, "t"], [60, 4, 30, 17, 5, "t"], [62, 80, 32, 13, -3, "b"], [8, 82, 26, 11, 4, "b"]]
        : [[2, 4, 15, 21, -6, "l"], [82, 3, 13, 23, 5, "r"], [81, 76, 15, 18, -3, "r"], [4, 78, 11, 15, 4, "l"]];
      fy = false;
      decor = panels
        .filter(([, , , , , side]) => !(zone === "left" && side === "l") && !(zone === "top" && side === "t") && !(zone === "bottom" && side === "b"))
        .map(([x, y, w, h, rot], k) => `<i class="gp" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%;transform:rotate(${rot}deg);${k > 1 ? "opacity:.7" : ""}"></i>`).join("");
      if (zone === "left") fx = false; // panels already kept to the right
      break;
    }
    case "paper":
      decor = tall
        ? `<i class="c1" style="width:70%;aspect-ratio:1;right:-25%;top:-12%"></i><i class="c2" style="width:36%;aspect-ratio:1;left:-12%;bottom:-6%"></i><i class="c3" style="width:2.6%;aspect-ratio:1;right:20%;bottom:16%"></i>`
        : `<i class="c1" style="width:46%;aspect-ratio:1;right:-12%;top:-30%"></i><i class="c2" style="width:22%;aspect-ratio:1;left:-6%;bottom:-14%"></i><i class="c3" style="width:1.6%;aspect-ratio:1;right:22%;bottom:22%"></i>`;
      break;
    case "bokeh": {
      // Dots scattered by the seed, never inside the text zone.
      const zr = { center: [22, 28, 78, 72], left: [4, 20, 58, 80], top: [6, 10, 94, 56], bottom: [8, 58, 92, 96], none: [0, 0, 0, 0] }[zone] ?? [22, 28, 78, 72];
      const dots = [];
      for (let k = 0; k < 60 && dots.length < 10; k++) {
        const x = r() * 100, y = r() * 100;
        if (x > zr[0] && x < zr[2] && y > zr[1] && y < zr[3]) continue;
        const size = 3 + r() * 9;
        dots.push(`<i style="left:${(x - size / 2).toFixed(1)}%;top:${(y - size / 2).toFixed(1)}%;width:${size.toFixed(1)}cqmin;height:${size.toFixed(1)}cqmin;filter:blur(${(r() * 0.8).toFixed(2)}cqmin);--c:${r() < 0.35 ? "#ffcf8a" : "var(--p)"}"></i>`);
      }
      decor = dots.join("");
      fx = false; fy = false;
      break;
    }
    case "ai": {
      const url = String(b?.imageUrl ?? "");
      const safe = /^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+|\/api\/projects\/[A-Za-z0-9-]+\/backdrops\/[A-Za-z0-9-]+(\?[A-Za-z0-9=&]*)?)$/.test(url) ? url : "";
      vars.push(`--ab:${{ calm: 0.75, balanced: 0.9, vivid: 1 }[intensity]}`);
      bd = safe ? `background-image:url('${safe}')` : "";
      break;
    }
  }
  const flip = `${fx ? " fx" : ""}${fy ? " fy" : ""}`;
  const veil = zone === "none" ? "" : `<div class="vl"></div>`;
  return `<div class="cwbd cwbd-${style} ${intensity}" style="${vars.join(";")}"><div class="bd"${bd ? ` style="${bd}"` : ""}></div>${decor ? `<div class="dc"><div class="f${flip}">${decor}</div></div>` : ""}${veil}</div>`;
}
