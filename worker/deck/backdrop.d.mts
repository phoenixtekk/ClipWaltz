// Types for worker/deck/backdrop.mjs (imported by the app).
export type BackdropStyle = "brand" | "aurora" | "orbit" | "stage" | "mesh" | "grid" | "glass" | "paper" | "bokeh" | "ai";
export type BackdropIntensity = "calm" | "balanced" | "vivid";
export type TextZone = "center" | "left" | "top" | "bottom" | "none";
/** Stored on deck_scenes.background (null = deck default) and DeckBrief.backdrop (the deck default). */
export type SceneBackdrop = { style: BackdropStyle; intensity: BackdropIntensity; seed: number; imageId?: string };
/** A backdrop ready to draw: the AI image resolved to a URL and its tone. */
export type ResolvedBackdrop = SceneBackdrop & { imageUrl?: string | null; tone?: "light" | "dark"; grid?: number[] };

export const BACKDROP_STYLES: { key: Exclude<BackdropStyle, "ai">; label: string; desc: string }[];
export const INTENSITIES: BackdropIntensity[];
export const MIN_FRAME_ZOOM: number;
export const BACKDROP_CSS: string;
export function normBackdrop(v: unknown): SceneBackdrop | null;
export function backdropTone(b: { style?: string; tone?: string; grid?: number[] } | null | undefined, zone?: TextZone): "light" | "dark";
export function textZone(layout: string, o: { card: boolean; wide: boolean }): TextZone;
export type FrameArea = { x: number; y: number; w: number; h: number };
export function cardRect(frameAspect: number, mediaAspect: number, zoom: number, area?: FrameArea): FrameArea;
export function mediaArea(layout: string, wide: boolean): FrameArea;
export function backdropMarkup(
  b: Partial<ResolvedBackdrop> | null | undefined,
  o?: { primary?: string | null; secondary?: string | null; aspect?: number; zone?: TextZone },
): string;
