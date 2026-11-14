import { existsSync } from "node:fs";
import { GlobalFonts } from "@napi-rs/canvas";

// Font registration for the explainer / Shorts / podcast-cover canvases.
//
// SP ran on linuxg1 with Liberation Sans. ClipWaltz renders these on the AI box, which has DejaVu Sans but no
// Liberation (checked 2026-11-14), and builds podcast covers on linuxg1. So each weight tries a short list and the first
// file that exists wins; EXPLAINER_FONT_REGULAR / EXPLAINER_FONT_BOLD override. Layout is measured with measureText,
// so a different family changes the look slightly but never overflows.
const REGULAR = [
  process.env.EXPLAINER_FONT_REGULAR,
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "C:/Windows/Fonts/arial.ttf",
];
const BOLD = [
  process.env.EXPLAINER_FONT_BOLD,
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "C:/Windows/Fonts/arialbd.ttf",
];

/** Register `alias` from the first existing file for the weight; returns the alias, or "sans-serif" if none. */
export function registerFont(alias: string, weight: "regular" | "bold"): string {
  for (const f of weight === "bold" ? BOLD : REGULAR) {
    if (!f || !existsSync(f)) continue;
    try {
      if (GlobalFonts.registerFromPath(f, alias)) return alias;
    } catch {
      /* try the next one */
    }
  }
  return "sans-serif";
}
