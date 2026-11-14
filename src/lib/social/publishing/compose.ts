// ─── Fitting a post + its link into a network's limit ────────────────────────
//
// Networks that reject an over-long post reject the WHOLE post — nothing is
// published — so the trim has to happen before the request.
//
// The rule that matters, and the one that was being broken: **the link is never
// part of what gets cut.** Appending the link and then truncating the result
// leaves a half-URL, which is unclickable, loses the click the post exists for,
// and on some networks is charged MORE than the fragment it replaced. Mastodon
// bills every URL a flat 23 characters (`characters_reserved_per_url`), so a
// 500-character status ending in an 18-character URL fragment counted 505 and
// was rejected outright.
//
// So: reserve what the link will cost, trim only the prose, then append the
// link whole.

export interface ComposeOptions {
  /** The network's hard maximum. */
  limit: number;
  /**
   * How the NETWORK counts, which is not always how JavaScript counts. Defaults
   * to code points, so an emoji costs one rather than the two a `.length` or a
   * `.slice()` would charge — and is never cut in half into a lone surrogate.
   */
  count?: (s: string) => number;
  /**
   * What the network charges for the link. Defaults to its counted length;
   * Mastodon-style networks pass a flat reservation instead.
   */
  linkCost?: (link: string) => number;
}

const codePoints = (s: string) => [...s].length;

/**
 * `text` and `link` inside `limit`, with the link intact.
 *
 * Returns the text unchanged when it already fits — a post under the limit is
 * never reworded, and never picks up an ellipsis it did not earn.
 */
export function composeWithLink(text: string, link: string | undefined, o: ComposeOptions): string {
  const count = o.count ?? codePoints;
  const body = text.trim();
  if (!link) return fit(body, o.limit, count);

  // The separator is two newlines, which cost two.
  const reserved = (o.linkCost ?? count)(link) + 2;
  const budget = o.limit - reserved;
  // A link so expensive that nothing is left for prose: send the link alone
  // rather than an ellipsis with nothing before it.
  if (budget <= 1) return link;

  return `${fit(body, budget, count)}\n\n${link}`;
}

/** Trim to `limit` as the network counts it, on a word boundary where possible. */
function fit(body: string, limit: number, count: (s: string) => number): string {
  if (count(body) <= limit) return body;

  // Walked back against the network's own count rather than sliced, because the
  // two disagree: a body carrying its own links shrinks or grows under the
  // network's rules, so a position that looks right by code point can still be
  // over. One code point is held back for the ellipsis.
  const chars = [...body];
  let cut = Math.min(chars.length, limit);
  while (cut > 0 && count(chars.slice(0, cut).join("")) > limit - 1) cut--;

  let clipped = chars.slice(0, cut).join("");
  const lastSpace = clipped.lastIndexOf(" ");
  if (lastSpace > limit * 0.5) clipped = clipped.slice(0, lastSpace);
  return clipped.trimEnd().replace(/[,;:\-–—]$/, "") + "…";
}
