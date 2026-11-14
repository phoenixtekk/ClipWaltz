// RSS 2.0 + iTunes podcast feed generation.
//
// Every rule below was read from Apple's own documentation on 2026-09-15 —
// help.apple.com "A Podcaster's Guide to RSS" and podcasters.apple.com "Podcast
// RSS feed requirements" — not recalled. Apple is the strictest directory, so a
// feed it accepts is accepted everywhere else.
//
// The requirements that actually bite, and where each is handled:
//
//   • The XML declaration and both namespaces are mandatory, exactly as spelled.
//   • Tag names are case-sensitive, and so are category values: `Kids &amp;
//     Family` validates, `Kids &amp; family` does not.
//   • Dates must be RFC 2822.
//   • Every episode needs a unique `<enclosure>` with url, length AND type;
//     duplicate URLs are silently ignored by Apple.
//   • Every episode needs a GUID that never changes.
//   • Apple names `&apos;` and `&quot;` and explicitly rejects the HTML-style
//     `&rsquo;`, `&lsquo;`, `&ldquo;`, `&rdquo;` — while telling authors to type
//     every other character directly as UTF-8. So `escape()` handles exactly the
//     five characters XML reserves and leaves real apostrophes and curly quotes
//     as themselves.

export interface FeedShow {
  slug: string;
  title: string;
  description: string;
  author: string | null;
  language: string;
  category: string;
  subcategory: string | null;
  explicit: boolean;
  link: string | null;
  copyright: string | null;
  coverUrl: string | null;
  /**
   * `<itunes:new-feed-url>`. Apple's move procedure (podcasters.apple.com/support/837, read 2026-11-14): 301 the old
   * feed AND put this tag, pointing at the new URL, in the NEW feed; keep both for at least four weeks. ClipWaltz emits
   * it on every show (it is this feed's own canonical URL), which is harmless for shows that never moved.
   */
  newFeedUrl?: string | null;
}

export interface FeedEpisode {
  guid: string;
  title: string;
  description: string;
  audioUrl: string;
  audioBytes: number;
  audioMime: string;
  durationSec: number;
  imageUrl: string | null;
  link: string | null;
  publishedAt: Date;
}

/** Apple's cap on `<description>`, counted in BYTES. */
const DESCRIPTION_MAX_BYTES = 4000;

/**
 * Escape the five characters XML reserves — and only those.
 *
 * Deliberately NOT a general HTML escaper. Apple rejects named HTML entities
 * such as `&rsquo;` and instructs authors to write other characters directly in
 * UTF-8, so a curly apostrophe must travel as itself. `&` is replaced first:
 * doing it later would double-escape the ampersands the other rules introduce.
 */
function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Trim to a byte budget without splitting a UTF-8 sequence in half. */
function clampBytes(s: string, max: number): string {
  if (Buffer.byteLength(s, "utf8") <= max) return s;
  const buf = Buffer.from(s, "utf8").subarray(0, max);
  // Walk back off a partial sequence: a lone continuation byte (10xxxxxx) at the
  // end means the character it belongs to was cut through.
  let end = buf.length;
  while (end > 0 && (buf[end - 1] & 0b1100_0000) === 0b1000_0000) end--;
  if (end > 0 && (buf[end - 1] & 0b1000_0000) !== 0) end--;
  return buf.subarray(0, end).toString("utf8").trimEnd();
}

/**
 * RFC 2822, which Apple requires: "day of week, day month year" and a 24-hour
 * time with a zone offset. `toUTCString()` produces exactly that shape with
 * `GMT` as the zone, which is the form Apple's own example uses.
 */
function rfc2822(d: Date): string {
  return d.toUTCString();
}

/** `<itunes:duration>` — Apple recommends whole seconds. */
function duration(sec: number): string {
  return String(Math.max(1, Math.round(sec)));
}

/**
 * Categories nest, and only the first category and subcategory are read by
 * Apple — so only one of each is emitted, matching what the show stores.
 */
function categoryTag(category: string, subcategory: string | null): string {
  const cat = escape(category);
  if (!subcategory) return `    <itunes:category text="${cat}"/>`;
  return [
    `    <itunes:category text="${cat}">`,
    `      <itunes:category text="${escape(subcategory)}"/>`,
    `    </itunes:category>`,
  ].join("\n");
}

export function buildFeed(show: FeedShow, episodes: FeedEpisode[]): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" ' +
      'xmlns:content="http://purl.org/rss/1.0/modules/content/">',
  );
  lines.push("  <channel>");

  // ── Required channel tags ──────────────────────────────────────────────────
  lines.push(`    <title>${escape(show.title)}</title>`);
  lines.push(`    <description>${escape(clampBytes(show.description, DESCRIPTION_MAX_BYTES))}</description>`);
  lines.push(`    <language>${escape(show.language)}</language>`);
  lines.push(`    <itunes:explicit>${show.explicit ? "true" : "false"}</itunes:explicit>`);
  lines.push(categoryTag(show.category, show.subcategory));
  if (show.coverUrl) lines.push(`    <itunes:image href="${escape(show.coverUrl)}"/>`);

  // ── Recommended ────────────────────────────────────────────────────────────
  if (show.author) {
    lines.push(`    <itunes:author>${escape(show.author)}</itunes:author>`);
    lines.push(`    <itunes:owner><itunes:name>${escape(show.author)}</itunes:name></itunes:owner>`);
  }
  if (show.link) lines.push(`    <link>${escape(show.link)}</link>`);
  if (show.copyright) lines.push(`    <copyright>${escape(show.copyright)}</copyright>`);
  lines.push(`    <lastBuildDate>${rfc2822(new Date())}</lastBuildDate>`);
  if (show.newFeedUrl) lines.push(`    <itunes:new-feed-url>${escape(show.newFeedUrl)}</itunes:new-feed-url>`);

  for (const e of episodes) {
    lines.push("    <item>");
    lines.push(`      <title>${escape(e.title)}</title>`);
    // isPermaLink="false" because the GUID is an opaque identifier, not a URL —
    // the default is true, which would make readers try to fetch it.
    lines.push(`      <guid isPermaLink="false">${escape(e.guid)}</guid>`);
    lines.push(
      `      <enclosure url="${escape(e.audioUrl)}" length="${e.audioBytes}" type="${escape(e.audioMime)}"/>`,
    );
    lines.push(`      <pubDate>${rfc2822(e.publishedAt)}</pubDate>`);
    lines.push(
      `      <description>${escape(clampBytes(e.description, DESCRIPTION_MAX_BYTES))}</description>`,
    );
    lines.push(`      <itunes:duration>${duration(e.durationSec)}</itunes:duration>`);
    if (e.link) lines.push(`      <link>${escape(e.link)}</link>`);
    if (e.imageUrl) lines.push(`      <itunes:image href="${escape(e.imageUrl)}"/>`);
    lines.push("    </item>");
  }

  lines.push("  </channel>");
  lines.push("</rss>");
  return lines.join("\n");
}

/**
 * A feed-safe slug.
 *
 * Apple: "Use only ASCII filenames and URLs that include a-z, A-Z, or 0-9."
 * Hyphens are ubiquitous in podcast URLs and Apple's own examples, so they are
 * kept as the word separator; everything else is dropped rather than
 * transliterated, because a slug that silently changes shape is worse than one
 * the user is asked to rewrite.
 */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
