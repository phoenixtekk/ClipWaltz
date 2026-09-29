// Output aspect ratios. Keep the pixel sizes in sync with dims() in worker/render-worker.mjs.
export type Aspect = "9:16" | "16:9" | "1:1" | "4:5";

export const ASPECT_OPTIONS: { key: Aspect; label: string; css: string; w: number; h: number }[] = [
  { key: "9:16", label: "9:16 vertical", css: "aspect-[9/16]", w: 1080, h: 1920 },
  { key: "16:9", label: "16:9 wide", css: "aspect-[16/9]", w: 1920, h: 1080 },
  { key: "1:1", label: "1:1 square", css: "aspect-square", w: 1080, h: 1080 },
  { key: "4:5", label: "4:5 portrait", css: "aspect-[4/5]", w: 1080, h: 1350 },
];

export const ASPECT_KEYS = new Set<string>(ASPECT_OPTIONS.map((a) => a.key));

const find = (a: string | null | undefined) => ASPECT_OPTIONS.find((o) => o.key === a) ?? ASPECT_OPTIONS[0];

/** Tailwind aspect class for a stored aspect (unknown → 9:16). */
export const aspectClass = (a: string | null | undefined) => find(a).css;

/** Wider than tall (only 16:9 today). */
export const isWide = (a: string | null | undefined) => find(a).w > find(a).h;

/** A valid aspect key, else the fallback. */
export const toAspect = (a: string | null | undefined, fallback: Aspect = "9:16"): Aspect =>
  a && ASPECT_KEYS.has(a) ? (a as Aspect) : fallback;

/** Output pixel size of a stored aspect. */
export const aspectDims = (a: string | null | undefined) => ({ w: find(a).w, h: find(a).h });

/** Human label ("1:1 square"). */
export const aspectLabel = (a: string | null | undefined) => find(a).label;
