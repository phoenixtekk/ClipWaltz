// AI credits (owner decision 2026-09-29, WaltzDeck phase 5 / spec §7.4): a monthly allowance per plan, no purchases.
// 1 credit = 1 second of AI video at standard quality. Every AI job stores its cost (generation_jobs.credits); the
// balance is the allowance minus this month's jobs that did not fail, get cancelled or get retried — so a failed or
// cancelled generation is refunded automatically. Client-safe: the same numbers price the buttons and the server.
import type { Tier } from "./billing";

export const CREDIT_ALLOWANCE: Record<Tier, number> = { free: 30, plus: 300, pro: 1000 };
/** Most credits one admin grant can add (guards against a typo like 30000). */
export const MAX_CREDIT_GRANT = 10000;
const QUALITY_RATE: Record<string, number> = { preview: 0.5, standard: 1, high: 2 };
/** Fast (ffmpeg) enhancement runs no AI model — free. Real-ESRGAN = half, SeedVR2 restore = double (per clip second). */
const ENHANCE_RATE: Record<string, number> = { ffmpeg: 0, ai: 0.5, restore: 2 };

const up = (n: number) => Math.max(1, Math.ceil(n - 1e-9));

/** A text/image-to-video clip. */
export const generationCost = (seconds: number, quality = "standard") => up((Number(seconds) || 5) * (QUALITY_RATE[quality] ?? 1));
/** A WaltzDeck AI backdrop: one still image (a single Wan frame, ~20 s of GPU). */
export const BACKDROP_COST = 2;
/** A Remix: only the AI seconds it adds (lead-in + moments + extend), at its quality. */
export const remixCost = (aiSeconds: number, quality = "standard") => up(aiSeconds * (QUALITY_RATE[quality] ?? 1));
/** An enhancement of a clip of `clipSeconds`. 0 for the Fast engine. */
export const enhanceCost = (engine: string, clipSeconds: number) => {
  const r = ENHANCE_RATE[engine] ?? 0;
  return r ? up((Number(clipSeconds) || 5) * r) : 0;
};

/**
 * `allowance` = this month's total (the plan's `planAllowance` + admin-granted `bonus` for this month), so every
 * "N of M left" shows grants without knowing about them.
 */
export type CreditBalance = { tier: Tier; allowance: number; planAllowance: number; bonus: number; used: number; left: number; resetsAt: string };

/** First instant of next month (UTC) — when the allowance resets. */
export function nextReset(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
