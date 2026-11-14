// Types for worker/image/presets.mjs (imported by the app).
export type ImageFormatKey = "1:1" | "4:5" | "9:16" | "1.91:1" | "2:3";
export type ImageFormat = { key: ImageFormatKey; label: string; use: string; width: number; height: number; gen: { width: number; height: number } };
export const IMAGE_FORMATS: ImageFormat[];
export const CAROUSEL_FORMATS: ImageFormatKey[];
export const CAROUSEL_MIN: number;
export const CAROUSEL_MAX: number;
export function imageFormat(key: string | null | undefined): ImageFormat;

export type ImageStyle = { key: string; label: string; medium: string; positive: string; negative: string };
export const IMAGE_STYLES: ImageStyle[];
export function imageStyle(key: string | null | undefined): ImageStyle;

export type AdLayoutKey = "none" | "ad-left" | "ad-center" | "ad-bottom";
export const AD_LAYOUTS: { key: AdLayoutKey; label: string; desc: string }[];

export type MemeLayoutKey = "top-bottom" | "caption" | "bar" | "quote";
export const MEME_LAYOUTS: { key: MemeLayoutKey; label: string; desc: string; fields: ("top" | "bottom" | "caption")[] }[];
export function memeLayout(key: string | null | undefined): (typeof MEME_LAYOUTS)[number];

export const TEXT_LIMITS: { headline: number; subhead: number; cta: number; body: number; top: number; bottom: number; caption: number; prompt: number };
export const MAX_VARIATIONS: number;
