// Types for worker/image/compose.mjs (server-only; imported by src/lib/image-ad/*).
export type ComposeLayout =
  | "none" | "ad-left" | "ad-center" | "ad-bottom" | "slide"
  | "meme-top-bottom" | "meme-caption" | "meme-bar" | "meme-quote";

export type ComposeSpec = {
  width: number;
  height: number;
  layout: ComposeLayout;
  background?: Uint8Array | null;
  logo?: Uint8Array | null;
  brand: { primary: string; secondary: string; headingFont: string; bodyFont: string };
  text?: { headline?: string; subhead?: string; cta?: string; body?: string; top?: string; bottom?: string; caption?: string };
  slide?: { index: number; count: number; role: "hook" | "value" | "cta" };
};

export type ComposeResult = { png: Buffer; width: number; height: number; fonts: { heading: string; body: string }; substituted: string[] };

export function composeImage(spec: ComposeSpec): Promise<ComposeResult>;
export function fitCover(bytes: Uint8Array, width: number, height: number): Promise<Buffer>;
export function imageSize(bytes: Uint8Array): Promise<{ width: number; height: number }>;
export function toJpeg(png: Uint8Array, quality?: number): Promise<Buffer>;
export function resolveFont(name: string): { family: string; substituted: boolean };
export function textOn(hex: string): string;
