import { getSetting } from "@/lib/social/settings";

// ─── House cap on post length ────────────────────────────────────────────────
//
// Networks have their own limits, but those are ceilings (Facebook allows 63k
// characters), not editorial choices. This is the operator's own maximum, and it
// applies on top: the effective limit is always the smaller of the two.
//
// A model asked for "about 500 characters" will regularly overshoot, so the cap
// is enforced twice — stated in the prompt so the model aims for it, then
// applied to the returned text so the result is guaranteed regardless.

export const MAX_CHARS_KEY = "post:max_chars";
export const MAX_CHARS_CEILING = 100_000;

/** The configured cap, or null when there isn't one. */
export async function getMaxChars(): Promise<number | null> {
  const raw = await getSetting(MAX_CHARS_KEY);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), MAX_CHARS_CEILING);
}

/** The smaller of the house cap and whatever the network allows. */
export async function effectiveLimit(networkLimit?: number): Promise<number | undefined> {
  const cap = await getMaxChars();
  if (cap === null) return networkLimit;
  return networkLimit ? Math.min(cap, networkLimit) : cap;
}

/**
 * Trim to `limit`, preferring a clean break.
 *
 * Cutting mid-sentence reads as a bug, so this drops back to the last sentence
 * end within the limit when one is reasonably close, and otherwise to a word
 * boundary with an ellipsis. Counted in code points, not UTF-16 units, so an
 * emoji costs one character rather than two and never gets split in half.
 */
export function trimToLimit(text: string, limit?: number): string {
  if (!limit || limit <= 0) return text;
  const chars = [...text];
  if (chars.length <= limit) return text;

  const clipped = chars.slice(0, limit).join("");

  // A sentence ending in the last quarter of the allowance is a natural stop.
  const lastStop = Math.max(
    clipped.lastIndexOf(". "), clipped.lastIndexOf(".\n"),
    clipped.lastIndexOf("! "), clipped.lastIndexOf("!\n"),
    clipped.lastIndexOf("? "), clipped.lastIndexOf("?\n"),
  );
  if (lastStop > limit * 0.6) return clipped.slice(0, lastStop + 1).trimEnd();
  if (/[.!?]$/.test(clipped.trimEnd())) return clipped.trimEnd();

  const lastSpace = clipped.lastIndexOf(" ");
  const body = lastSpace > limit * 0.5 ? clipped.slice(0, lastSpace) : clipped.slice(0, limit - 1);
  return body.trimEnd().replace(/[,;:\-–—]$/, "") + "…";
}
