// Generate-tab settings shape, shared by recent settings (CW-MVP-172), favourite presets (173),
// templates (150/151) and "Edit & regenerate" (121). Plain module (no server-only code) so the
// client panel and the server actions agree on one validated shape.

export const STYLE_KEYS = ["cinematic", "commercial", "documentary", "social", "action", "dreamlike"] as const;
export const CAMERA_KEYS = ["static", "push", "pull", "orbit", "pan", "tracking", "handheld", "drone"] as const;
export const MOTION_KEYS = ["subtle", "balanced", "dynamic"] as const;
export const ASPECT_KEYS = ["16:9", "9:16", "1:1"] as const;
export const DURATION_OPTIONS = [3, 5, 8] as const;
export const QUALITY_KEYS = ["preview", "standard", "high"] as const;

export type GenerationSettings = {
  mode: "image" | "text";
  prompt: string;
  negativePrompt: string;
  style: string | null;
  camera: string | null;
  motion: (typeof MOTION_KEYS)[number];
  aspect: (typeof ASPECT_KEYS)[number];
  duration: number;
  quality: (typeof QUALITY_KEYS)[number];
  seed: string; // "" = random
};

const oneOf = <T extends string>(v: unknown, keys: readonly T[], fallback: T): T =>
  typeof v === "string" && (keys as readonly string[]).includes(v) ? (v as T) : fallback;
const nullableOneOf = (v: unknown, keys: readonly string[]): string | null =>
  typeof v === "string" && keys.includes(v) ? v : null;

/** Coerce anything (DB JSON, client input) into a valid settings object. */
export function normalizeSettings(raw: unknown): GenerationSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const duration = Number(r.duration);
  const seed = typeof r.seed === "string" || typeof r.seed === "number" ? String(r.seed).replace(/[^0-9]/g, "").slice(0, 16) : "";
  return {
    mode: r.mode === "text" ? "text" : "image",
    prompt: typeof r.prompt === "string" ? r.prompt.slice(0, 2000) : "",
    negativePrompt: typeof r.negativePrompt === "string" ? r.negativePrompt.slice(0, 2000) : "",
    style: nullableOneOf(r.style, STYLE_KEYS),
    camera: nullableOneOf(r.camera, CAMERA_KEYS),
    motion: oneOf(r.motion, MOTION_KEYS, "balanced"),
    aspect: oneOf(r.aspect, ASPECT_KEYS, "16:9"),
    duration: (DURATION_OPTIONS as readonly number[]).includes(duration) ? duration : 5,
    quality: oneOf(r.quality, QUALITY_KEYS, "standard"),
    seed,
  };
}

/**
 * CW-MVP-171 smart recommendations: aspect from the source photo's shape, style / motion / camera
 * from the prompt's wording. Deterministic and instant; null fields = no suggestion.
 */
export function recommendSettings(input: { prompt: string; photo?: { width: number | null; height: number | null } | null }) {
  const p = input.prompt.toLowerCase();
  const has = (...words: string[]) => words.some((w) => new RegExp(`\\b${w}`).test(p));
  let aspect: GenerationSettings["aspect"] | null = null;
  const w = input.photo?.width ?? 0, h = input.photo?.height ?? 0;
  if (w > 0 && h > 0) aspect = h / w > 1.15 ? "9:16" : w / h > 1.15 ? "16:9" : "1:1";

  let style: string | null = null, motion: GenerationSettings["motion"] | null = null, camera: string | null = null;
  if (has("race", "racing", "jump", "surf", "jet ?ski", "skate", "ski", "bike", "motocross", "wave", "speed", "sport", "dunk")) {
    style = "action"; motion = "dynamic"; camera = "tracking";
  } else if (has("party", "birthday", "wedding", "concert", "celebrat", "dance", "friends")) {
    style = "social"; motion = "dynamic"; camera = "handheld";
  } else if (has("product", "bottle", "shoe", "watch", "phone", "package", "brand")) {
    style = "commercial"; motion = "subtle"; camera = "orbit";
  } else if (has("sunset", "sunrise", "mountain", "lake", "ocean", "beach", "forest", "landscape", "city", "skyline", "travel")) {
    style = "cinematic"; motion = "balanced"; camera = "drone";
  } else if (has("dream", "fantasy", "magic", "surreal", "space", "galaxy")) {
    style = "dreamlike"; motion = "subtle"; camera = "push";
  } else if (has("portrait", "face", "baby", "grandma", "family", "interview")) {
    style = "documentary"; motion = "subtle"; camera = "push";
  }
  return { aspect, style, motion, camera };
}
