// Waltz Image (plan G1 / G2 / G5): the shared, client-safe vocabulary — format presets at exact pixel sizes, render
// styles, ad layouts and meme layouts. Imported by the app (src/lib/image-ad/*, the editor UI) and by the worker
// (worker/image/*), so the two can never disagree about what "4:5" means.
//
// Pixel sizes are the platforms' published recommendations: 1080×1080 / 1080×1350 / 1080×1920 for Instagram feed,
// portrait feed and Stories/Reels, 1200×628 for link and ad cards (Facebook / LinkedIn / X), 1000×1500 for a Pin.
// The diffusion model cannot render most of these directly (Flux latents want multiples of 64), so each preset also
// names the model size it is drawn at — the same aspect, about one megapixel — and the compositor scales + centre-crops
// that to the exact output size (worker/image/compose.mjs fitCover).

/** @type {{ key: string; label: string; use: string; width: number; height: number; gen: { width: number; height: number } }[]} */
export const IMAGE_FORMATS = [
  { key: "1:1", label: "Square post", use: "Instagram / Facebook / LinkedIn feed", width: 1080, height: 1080, gen: { width: 1024, height: 1024 } },
  { key: "4:5", label: "Portrait feed", use: "Instagram / Facebook feed (tallest allowed)", width: 1080, height: 1350, gen: { width: 896, height: 1120 } },
  { key: "9:16", label: "Story / Reel", use: "Stories, Reels, Shorts, TikTok", width: 1080, height: 1920, gen: { width: 768, height: 1344 } },
  { key: "1.91:1", label: "Link / ad card", use: "Facebook / LinkedIn / X link and ad images", width: 1200, height: 628, gen: { width: 1344, height: 704 } },
  { key: "2:3", label: "Pin", use: "Pinterest", width: 1000, height: 1500, gen: { width: 832, height: 1248 } },
];

/** Carousel slides: platforms take square or 4:5 (Instagram uses the first slide's shape for every slide). */
export const CAROUSEL_FORMATS = ["1:1", "4:5"];
export const CAROUSEL_MIN = 2;
export const CAROUSEL_MAX = 10;

export function imageFormat(key) {
  return IMAGE_FORMATS.find((f) => f.key === key) ?? IMAGE_FORMATS[0];
}

// Render styles. Each one steers the prompt-writer (`medium`) and the render (`positive` / `negative` keyword tails).
// Ported from Social Publishing's STYLE_PRESETS (src/lib/image-gen.ts), unchanged in wording.
export const IMAGE_STYLES = [
  { key: "photographic", label: "Photo", medium: "a professional photograph", positive: "professional photograph, DSLR, 50mm lens, natural lighting, realistic, shallow depth of field", negative: "illustration, cartoon, 3d render, painting, cgi, anime" },
  { key: "editorial", label: "Editorial illustration", medium: "a clean modern editorial illustration", positive: "modern editorial illustration, clean shapes, tasteful color palette, soft gradients, professional", negative: "photorealistic, harsh, cluttered" },
  { key: "render3d", label: "3D render", medium: "a polished 3D render", positive: "polished 3D render, soft studio lighting, octane render, clean materials, high detail", negative: "flat, 2d, sketch, photograph, grain" },
  { key: "flat_vector", label: "Flat vector", medium: "a flat vector illustration", positive: "flat vector illustration, bold geometric shapes, minimal, corporate, clean lines, limited palette", negative: "photorealistic, texture, 3d, gradient noise" },
  { key: "cinematic", label: "Cinematic", medium: "a cinematic film still", positive: "cinematic film still, dramatic lighting, depth of field, moody atmosphere, color graded", negative: "flat, cartoon, low contrast, snapshot" },
  { key: "minimal", label: "Minimal / abstract", medium: "a minimal abstract composition", positive: "minimalist abstract composition, geometric, generous negative space, elegant, muted palette", negative: "busy, cluttered, realistic, detailed background" },
  { key: "watercolor", label: "Watercolor", medium: "a soft watercolor painting", positive: "soft watercolor painting, textured paper, gentle washes, hand-painted, artistic", negative: "photograph, 3d, hard edges, digital, sharp" },
];

export function imageStyle(key) {
  return IMAGE_STYLES.find((s) => s.key === key) ?? IMAGE_STYLES[0];
}

/** The text layouts an image can carry. "none" = the picture alone. Text is always drawn by canvas, never diffused. */
export const AD_LAYOUTS = [
  { key: "none", label: "No text", desc: "Just the image" },
  { key: "ad-left", label: "Ad — left", desc: "Headline, subhead and button over a brand-colour fade from the left" },
  { key: "ad-center", label: "Ad — centred", desc: "Stacked headline, subhead and button, centred over a dimmed image" },
  { key: "ad-bottom", label: "Ad — bottom band", desc: "A solid brand band along the bottom with the text and button" },
];

// Meme layouts: original arrangements only. No third-party meme template images ship with ClipWaltz (plan G5) — the
// picture is always the user's upload or an AI image.
export const MEME_LAYOUTS = [
  { key: "top-bottom", label: "Top & bottom", desc: "Bold outlined text at the top and bottom of the picture", fields: ["top", "bottom"] },
  { key: "caption", label: "Caption above", desc: "A white caption band above the picture", fields: ["caption"] },
  { key: "bar", label: "Brand bar", desc: "The picture with a brand-colour label bar along the bottom", fields: ["caption"] },
  { key: "quote", label: "Big quote", desc: "One large line centred over a dimmed picture", fields: ["caption"] },
];

export function memeLayout(key) {
  return MEME_LAYOUTS.find((m) => m.key === key) ?? MEME_LAYOUTS[0];
}

/** Text limits (characters). The compositor shrinks to fit; these stop a paste of a whole article. */
export const TEXT_LIMITS = { headline: 140, subhead: 220, cta: 32, body: 400, top: 120, bottom: 120, caption: 240, prompt: 1500 };

/** Most AI variations one request may make (each one costs IMAGE_COST credits). */
export const MAX_VARIATIONS = 4;
