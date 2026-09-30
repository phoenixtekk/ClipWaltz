// WaltzDeck "brand kit from my website" (phase 5, 06_ClipWaltz_WaltzDeck_Feature_Spec.md §3.8): read a public page and
// suggest the kit — main + background colour, heading + body font (mapped to the fonts the render box has) and the
// logo. The owner reviews the suggestion before it's applied. Fetches go through importer.mjs fetchPublic (SSRF guard).
// SVG logos are never rasterised: an untrusted SVG can reference local files; PNG / JPEG / WebP only.
import { fetchPublic } from "./importer.mjs";

// Keep in sync with src/lib/brand.ts BRAND_FONTS.
const FONTS = ["Montserrat", "Inter", "Lato", "Open Sans", "Roboto", "Noto Serif"];
// Families we don't have → the closest one we do.
const LOOKALIKE = [
  [/poppins|raleway|nunito|work sans|dm sans|manrope|outfit|urbanist|quicksand|josefin|gotham|avenir|futura|proxima|sofia/i, "Montserrat"],
  [/helvetica|arial|system-ui|segoe|sf pro|-apple-system|source sans|ibm plex sans|noto sans|pt sans|inter var|geist/i, "Inter"],
  [/merriweather|playfair|lora|georgia|garamond|times|libre baskerville|crimson|source serif|pt serif|serif/i, "Noto Serif"],
];

const HEX6 = /^#[0-9a-f]{6}$/i;
const toHex6 = (c) => {
  const s = String(c ?? "").trim().toLowerCase();
  if (HEX6.test(s)) return s;
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`;
  const rgb = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(s);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((v) => Math.min(255, +v).toString(16).padStart(2, "0")).join("")}`;
  return null;
};
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hexOf = (r, g, b) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
/** Saturation-ish and lightness: brand colours are neither grey nor near-white/black. */
function vivid(h) {
  const [r, g, b] = rgbOf(h);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510;
  return mx - mn > 40 && l > 0.12 && l < 0.9;
}
/** A deep background that goes with the main colour (for cards / slide panels). */
export const deepOf = (h) => { const [r, g, b] = rgbOf(h); return hexOf(r * 0.16 + 10, g * 0.16 + 6, b * 0.16 + 22); };

export function mapFont(family) {
  const f = String(family ?? "").replace(/["']/g, "").split(",")[0].trim();
  if (!f) return null;
  const exact = FONTS.find((x) => x.toLowerCase() === f.toLowerCase());
  if (exact) return exact;
  // Self-hosted fonts get renamed ("__Inter_d65c78", "Roboto Flex", "Lato-Bold").
  const inside = FONTS.find((x) => f.toLowerCase().replace(/[_-]+/g, " ").includes(x.toLowerCase()));
  if (inside) return inside;
  for (const [re, to] of LOOKALIKE) if (re.test(f)) return to;
  return null;
}

const attr = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(2).find((x) => x != null) ?? "";

/** Page HTML → candidate colours, fonts and logo URLs (best first). Pure. */
export function readBrand(html, baseUrl, extraCss = "") {
  const h = String(html);
  const abs = (u) => { try { return new URL(u, baseUrl).toString(); } catch { return null; } };
  const colors = [];
  for (const m of h.match(/<meta\b[^>]*>/gi) ?? []) {
    if (/name\s*=\s*["']?(theme-color|msapplication-TileColor)/i.test(m)) { const c = toHex6(attr(m, "content")); if (c) colors.push(c); }
  }
  const styles = [...h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n") + "\n" + extraCss;
  for (const m of styles.matchAll(/--[\w-]*(primary|brand|accent|main)[\w-]*\s*:\s*(#[0-9a-f]{3,6}\b|rgba?\([^)]*\))/gi)) { const c = toHex6(m[2]); if (c) colors.push(c); }
  const fonts = [];
  for (const m of h.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/gi)) {
    for (const fam of m[1].replace(/&amp;/g, "&").split("&").filter((p) => p.startsWith("family=")).map((p) => decodeURIComponent(p.slice(7).split(":")[0]).replace(/\+/g, " "))) fonts.push(fam);
  }
  for (const m of styles.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) fonts.push(m[1].split(",")[0]);
  const logos = [];
  for (const m of h.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(m, "rel").toLowerCase();
    if (rel.includes("apple-touch-icon")) { const u = abs(attr(m, "href")); if (u) logos.push({ url: u, score: 3 }); }
    else if (rel.includes("icon") && /(\d{3,})x/.test(attr(m, "sizes"))) { const u = abs(attr(m, "href")); if (u) logos.push({ url: u, score: 1 }); }
  }
  for (const m of h.match(/<img\b[^>]*>/gi) ?? []) {
    const hint = `${attr(m, "src")} ${attr(m, "alt")} ${attr(m, "class")} ${attr(m, "id")}`.toLowerCase();
    if (/logo|brand/.test(hint)) { const u = abs(attr(m, "src")); if (u) logos.push({ url: u, score: 4 }); }
  }
  const seen = new Set();
  return {
    colors: colors.filter((c) => !seen.has(c) && seen.add(c)),
    fonts: fonts.map(mapFont).filter(Boolean),
    logos: logos.filter((l) => !/\.svg(\?|$)/i.test(l.url) && !/^data:/i.test(l.url)).sort((a, b) => b.score - a.score).map((l) => l.url).slice(0, 5),
  };
}

/** The most common vivid colour of an image (32×32 sample, quantised) — null when it's all greys. */
async function dominantVivid(buf) {
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(buf, { limitInputPixels: 40_000_000 }).resize(32, 32, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const count = new Map();
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 200) continue;
    const q = (v) => Math.round(v / 24) * 24;
    const hex = hexOf(q(data[i]), q(data[i + 1]), q(data[i + 2]));
    if (vivid(hex)) count.set(hex, (count.get(hex) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Suggest a brand kit for a public web page. Returns { primary, secondary, headingFont, bodyFont, logo: {bytes,type}|null,
 * found: {...what came from where} }. Throws a user-facing Error when the page can't be read.
 */
export async function brandFromSite(url) {
  const page = await fetchPublic(url);
  if (!/html|xml/i.test(page.type)) throw new Error("That address isn't a web page.");
  const html = page.bytes.toString("utf8");
  // The site's own first two stylesheets (where most sites keep colours and fonts), each ≤ 600 KB.
  let css = "";
  const sheets = (html.match(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi) ?? []).map((t) => attr(t, "href")).filter(Boolean).slice(0, 2);
  for (const href of sheets) {
    try {
      const u = new URL(href, page.url);
      if (u.hostname.includes("googleapis.com")) continue;
      const r = await fetchPublic(u.toString(), { maxBytes: 600 << 10, accept: "text/css,*/*" });
      if (/css|text/i.test(r.type)) css += "\n" + r.bytes.toString("utf8");
    } catch { /* skip */ }
  }
  const b = readBrand(html, page.url, css);
  let logo = null, logoColor = null;
  for (const u of b.logos) {
    try {
      const img = await fetchPublic(u, { maxBytes: 4 << 20, accept: "image/png,image/jpeg,image/webp,image/*" });
      const type = img.type.split(";")[0].trim().toLowerCase();
      if (!["image/png", "image/jpeg", "image/webp"].includes(type) || img.bytes.length < 500) continue;
      const { default: sharp } = await import("sharp");
      const meta = await sharp(img.bytes, { limitInputPixels: 40_000_000 }).metadata();
      // The real format, from the bytes (a site can label an SVG "image/png"; sharp would rasterise it with librsvg).
      if (!["png", "jpeg", "webp"].includes(meta.format)) continue;
      if ((meta.width ?? 0) < 64 || (meta.height ?? 0) < 32) continue;
      // Normalise to a PNG ≤ 512 px (what uploadBrandLogo accepts), keeping transparency.
      logo = { bytes: await sharp(img.bytes, { limitInputPixels: 40_000_000 }).resize(512, 512, { fit: "inside", withoutEnlargement: true }).png().toBuffer(), type: "image/png" };
      logoColor = await dominantVivid(img.bytes).catch(() => null);
      break;
    } catch { /* try the next candidate */ }
  }
  const primary = b.colors.find(vivid) ?? logoColor ?? null;
  const headingFont = b.fonts[0] ?? null;
  const bodyFont = b.fonts.find((f) => f !== headingFont) ?? headingFont;
  if (!primary && !logo && !headingFont) throw new Error("Couldn't find brand colours, fonts or a logo on that page.");
  return {
    primary: primary ?? "#8b5cf6", secondary: deepOf(primary ?? "#8b5cf6"),
    headingFont: headingFont ?? "Montserrat", bodyFont: bodyFont ?? "Inter", logo,
    found: { color: primary ? (b.colors.find(vivid) ? "site colour" : "logo") : null, fonts: !!headingFont, logo: !!logo },
  };
}

if (process.argv[1]?.endsWith("brand-site.mjs") && process.argv[2]) {
  const r = await brandFromSite(process.argv[2]);
  console.log(JSON.stringify({ ...r, logo: r.logo ? `${r.logo.type} ${r.logo.bytes.length} bytes` : null }, null, 2));
}
