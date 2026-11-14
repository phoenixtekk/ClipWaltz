// ─── Links attached to generated posts ───────────────────────────────────────
//
// An Auto Post rule can carry links the same way it carries topics: a list that
// rotates, so a rule cycles a landing page, a blog post and an offer instead of
// hammering one URL for weeks. With UTM tagging on, each destination gets the
// same link stamped with its own source, so analytics can tell Telegram traffic
// from Facebook traffic without any manual link building.

/** One link per line (blank lines and stray whitespace ignored). */
export function parseLinks(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

/** Lower-case, hyphenated, safe for a UTM value. */
export function slugify(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "auto-post";
}

export interface UtmOpts {
  /** Where the click came from — the destination, e.g. "telegram". */
  source: string;
  /** Which campaign — the rule's name. */
  campaign: string;
  medium?: string;
  content?: string;
}

/**
 * Add UTM parameters to a URL.
 *
 * Existing parameters are never overwritten: if the operator already put
 * `utm_campaign` on the link by hand, theirs wins — silently replacing it would
 * break attribution they had deliberately set up. An unparseable URL is returned
 * untouched rather than mangled.
 */
export function withUtm(url: string, o: UtmOpts): string {
  try {
    const u = new URL(url);
    const add = (k: string, v: string | undefined) => {
      if (v && !u.searchParams.has(k)) u.searchParams.set(k, v);
    };
    add("utm_source", slugify(o.source));
    add("utm_medium", o.medium ?? "social");
    add("utm_campaign", slugify(o.campaign));
    add("utm_content", o.content ? slugify(o.content) : undefined);
    return u.toString();
  } catch {
    return url;
  }
}

/** The next link in the rotation, or null when the rule has none. */
export function nextLink(links: string[], cursor: number): string | null {
  if (links.length === 0) return null;
  return links[cursor % links.length];
}
