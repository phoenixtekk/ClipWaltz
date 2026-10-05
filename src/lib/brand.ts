// Brand kit shared types. Fonts are limited to families installed on the render box (Debian fonts-* packages
// on the AI box, 2026-09-29) and loaded from Google Fonts for the in-browser preview — keep both in sync.
export const BRAND_FONTS = ["Montserrat", "Inter", "Lato", "Open Sans", "Roboto", "Noto Serif"] as const;
export type BrandFont = (typeof BRAND_FONTS)[number];

export type Pronunciation = { word: string; say: string };
export const MAX_PRONUNCIATIONS = 20;

export type BrandKit = {
  id: string;
  primary: string;
  secondary: string;
  headingFont: string;
  bodyFont: string;
  hasLogo: boolean;
  /** How the voiceover says words it would get wrong (written → spoken); captions keep the written form. */
  pronunciations: Pronunciation[];
  applied: boolean; // used by this project
};

/** Google Fonts stylesheet for the preview (same families/weights the templates use). */
export const BRAND_FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=Lato:wght@400;700;900&family=Montserrat:wght@500;700;800&family=Noto+Serif:wght@500;700;800&family=Open+Sans:wght@500;700;800&family=Roboto:wght@500;700;900&display=swap";
