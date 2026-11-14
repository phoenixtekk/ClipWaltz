// G4 hashtag rules (pure, client-safe): per-network counts, parsing and appending. Used by copy.ts (AI copy for each
// network) and score-checks.ts (the G8 checklist, which runs in the composer).
//
// Counts per network come from the plan (G4: Instagram up to 30 — Instagram's own maximum — LinkedIn 3–5, X 1–2);
// networks the plan does not name get 3–5. Networks where a hashtag block is not useful get none.

export const HASHTAG_MAX: Record<string, number> = {
  instagram: 30, linkedin: 5, x: 2, tiktok: 5, threads: 3, bluesky: 3, mastodon: 5, facebook: 3, facebook_group: 3,
  youtube: 5, pinterest: 5, tumblr: 5,
};
/** Networks where a hashtag block is not useful (email, chat, forums, long-form): no tags are added. */
const NO_TAGS = new Set(["email", "discord", "slack", "teams", "telegram", "txtya", "discourse", "devto", "medium", "reddit", "podcast"]);

export function hashtagMax(provider: string): number {
  return NO_TAGS.has(provider) ? 0 : (HASHTAG_MAX[provider] ?? 3);
}

/**
 * Parse whatever the model returned into clean hashtags: `#word` tokens (or bare words), letters / digits / underscore
 * only (Unicode letters kept), no spaces, no all-digit tags, deduplicated case-insensitively, at most `max`.
 */
export function normalizeHashtags(raw: string, max: number): string[] {
  if (max <= 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of raw.split(/[\s,;]+/)) {
    const body = tok.replace(/^#+/, "").normalize("NFC").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!body || body.length > 60 || /^\d+$/.test(body)) continue;
    const key = body.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`#${body}`);
    if (out.length >= max) break;
  }
  return out;
}

/** Hashtags already in a text (lower-cased bodies), so a tag the caption already uses is not repeated. */
export function hashtagsIn(text: string): Set<string> {
  return new Set([...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1].toLowerCase()));
}

/** Append tags to a caption within the network's text limit (drops tags from the end rather than cutting words). */
export function withHashtags(caption: string, tags: string[], limit: number | undefined): string {
  const have = hashtagsIn(caption);
  const fresh = tags.filter((t) => !have.has(t.slice(1).toLowerCase()));
  let keep = fresh;
  const join = (k: string[]) => (k.length ? `${caption.trim()}\n\n${k.join(" ")}` : caption.trim());
  while (limit && keep.length && [...join(keep)].length > limit) keep = keep.slice(0, -1);
  return join(keep);
}

