// Types for worker/deck/motion.mjs (imported by the app for the editor preview).
export const MOTION_LAYOUTS: string[];
export const OVER_MEDIA_LAYOUTS: string[];
export function isMotionLayout(layout: string): boolean;
export function parseChat(bullets: string[] | undefined): { from: string; text: string; via: string; me: boolean }[];
export type MotionBrand = { primary?: string; secondary?: string; headingFont?: string; bodyFont?: string; logoDataUrl?: string | null };
export function motionHtml(o: {
  layout: string; text?: { headline?: string; sub?: string; bullets?: string[] }; W: number; H: number;
  brand?: MotionBrand; dur?: number; over?: boolean; stars?: number; fontsCss?: string;
}): string;
export function motionOpaque(layout: string, hasMedia: boolean): boolean;
export function settledAt(dur: number): number;
