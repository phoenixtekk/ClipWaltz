// ─── Showing a link as its domain instead of a wall of URL ───────────────────
//
// A tracked link is unreadable in a post:
//
//   https://www.phoenixtekk.com/?utm_source=slack&utm_medium=social&utm_campaign=
//   phoenixtekk&utm_content=powershell-automation
//
// Where a network supports link markup, that becomes "phoenixtekk.com" pointing at
// the full tracked URL — the UTM parameters still travel, they are just not shown.
//
// Not every network can do this. Facebook, LinkedIn, Bluesky, Mastodon, Threads and
// X render posts as plain text: a URL is only clickable there because it is written
// out in full, so aliasing it would produce an unclickable string and lose the click
// entirely. Those keep the raw URL deliberately.
//
// Telegram CAN, and now does — see `escapeTelegramHtml` below. It was left out at
// first because aliasing there needs `parse_mode`, which means every post body has
// to be escaped or a stray character silently breaks the message. Telegram’s HTML
// mode narrows that to three characters, which is a small enough surface to take on.

/**
 * The label a link is shown as: its host, without `www.`.
 *
 * Falls back to the original string if it will not parse, so a malformed link is
 * still shown rather than silently swallowed.
 */
export function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "");
    // A path carries meaning worth keeping when it is short — "example.com/pricing"
    // reads better than a bare domain — but query strings never do.
    const path = u.pathname.replace(/\/+$/, "");
    return path && path.length <= 24 ? `${host}${path}` : host;
  } catch {
    return url;
  }
}

/** Slack's own link syntax: `<url|label>`. */
export function slackLink(url: string): string {
  // A literal ">" inside the URL would close the markup early.
  const safe = url.replace(/[<>]/g, encodeURIComponent);
  return `<${safe}|${linkLabel(url)}>`;
}

/** Markdown link, for anything that renders markdown (Discord, Teams, Medium, dev.to). */
export function markdownLink(url: string): string {
  const label = linkLabel(url).replace(/[[\]]/g, "");
  return `[${label}](${url})`;
}

/** HTML anchor, for the email body. */
export function htmlLink(url: string, escape: (s: string) => string): string {
  return `<a href="${escape(url)}">${escape(linkLabel(url))}</a>`;
}

/**
 * Escape a post body for Telegram’s HTML `parse_mode`.
 *
 * Telegram’s HTML style is deliberately tiny: per the Bot API, “all `<`, `>` and
 * `&` symbols that are not a part of a tag or an HTML entity must be replaced with
 * the corresponding HTML entities”. Nothing else needs touching.
 *
 * That is the whole reason this uses HTML rather than MarkdownV2, which would
 * require escaping eighteen characters — including `.`, `-` and `!` — in every
 * post, and mangles a body the moment one is missed.
 */
export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
