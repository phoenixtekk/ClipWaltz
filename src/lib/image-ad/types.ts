// Waltz Image (plan G1 / G2 / G5) — shared, client-safe shapes. The stored row is `image_designs` (src/db/app-schema.ts);
// the words live in `data`, the pictures in `image_design_images`, and the compositor (worker/image/compose.mjs) puts
// them together on demand.
import type { AdLayoutKey, ImageFormatKey, MemeLayoutKey } from "../../../worker/image/presets.mjs";
import type { CreditBalance } from "@/lib/credits";

export type DesignKind = "image" | "carousel" | "meme";
export const DESIGN_KINDS: { key: DesignKind; label: string; desc: string }[] = [
  { key: "image", label: "Image or ad", desc: "AI picture with an optional headline, subhead and button" },
  { key: "carousel", label: "Carousel", desc: "2–10 slides from your brand kit, with optional AI backgrounds" },
  { key: "meme", label: "Meme", desc: "Your photo or an AI picture with meme-style text" },
];

export type ImageAdData = {
  brief: string;
  style: string;
  layout: AdLayoutKey;
  headline: string;
  subhead: string;
  cta: string;
  /** Brand kit colours + fonts + logo (false = ClipWaltz defaults, no logo). */
  useBrand: boolean;
  imageId: string | null;
};

export type CarouselSlide = { id: string; imageId: string | null; headline: string; body: string };
export type CarouselData = {
  brief: string;
  style: string;
  /** Button text on the last slide ("" = no CTA slide). */
  cta: string;
  useBrand: boolean;
  slides: CarouselSlide[];
};

export type MemeData = {
  layout: MemeLayoutKey;
  top: string;
  bottom: string;
  caption: string;
  imageId: string | null;
  brief: string;
  style: string;
};

export type DesignData = ImageAdData | CarouselData | MemeData;

export type DesignImageView = {
  id: string;
  source: "ai" | "upload";
  status: "ready" | "pending" | "failed";
  error: string | null;
  /** Clean picture (no text), served by /api/images/[id]/picture/[imageId]; null until ready. */
  url: string | null;
  width: number | null;
  height: number | null;
};

export type DesignBrand = {
  primary: string;
  secondary: string;
  headingFont: string;
  bodyFont: string;
  hasLogo: boolean;
  /** true when the workspace has a brand kit (otherwise these are the ClipWaltz defaults). */
  fromKit: boolean;
  /** Brand fonts this server doesn't have installed (drawn in a fallback sans instead). */
  missingFonts: string[];
};

export type DesignView = {
  id: string;
  kind: DesignKind;
  title: string;
  format: ImageFormatKey;
  data: DesignData;
  images: DesignImageView[];
  brand: DesignBrand;
  credits: CreditBalance;
  canEdit: boolean;
  updatedAt: string;
  /** How many output images the design renders (1, or the slide count). */
  outputs: number;
};

export type DesignListItem = { id: string; kind: DesignKind; title: string; format: string; updatedAt: string; outputs: number };
