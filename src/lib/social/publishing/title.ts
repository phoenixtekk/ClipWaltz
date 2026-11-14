// ─── Article titles that always fit ──────────────────────────────────────────
//
// dev.to, Medium, Discourse, Reddit and YouTube take the first line of a post as
// its title. Each enforces its own maximum **server-side and rejects the entire
// post** when it is exceeded — dev.to answers
//
//   Title is too long (maximum is 128 characters for full_post)
//
// and nothing is published at all. So the cut has to happen here, before the
// request, or the article never lands.
//
// Two rules matter, and both were being broken:
//
//  1. **Count code points, not UTF-16 units.** Forem validates with Rails'
//     `length:` and Discourse with Ruby's `String#length`; both count
//     characters. JavaScript's `.slice()` counts UTF-16 units, so an emoji costs
//     two against our budget and one against theirs — and a slice landing
//     between the halves of a surrogate pair emits a lone surrogate, which is
//     not valid text in the JSON we send.
//
//  2. **Nothing is silently deleted.** When the first line is too long to be a
//     title, `splitArticle` keeps the whole line as the article's opening
//     paragraph. Truncating in place would quietly drop the end of the author's
//     own sentence and leave a permanent post that is wrong — and unlike a
//     failed publish, nobody would ever be told.

/**
 * Shorten `text` to at most `limit` **code points**, breaking on a word where
 * one is reasonably close and marking the cut with an ellipsis.
 *
 * The ellipsis is spent out of the budget, not added to it, so the result is
 * never longer than `limit`. Trailing punctuation left dangling by the cut
 * ("Automation, …") is removed.
 */
export function clipTitle(text: string, limit: number): string {
  const s = text.trim();
  const chars = [...s];
  if (chars.length <= limit) return s;
  if (limit <= 1) return chars.slice(0, limit).join("");

  const clipped = chars.slice(0, limit - 1).join("");
  const lastSpace = clipped.lastIndexOf(" ");
  // Only break on a word if that keeps at least half the allowance; a title made
  // of one very long token would otherwise come back almost empty.
  const cut = lastSpace > limit * 0.5 ? clipped.slice(0, lastSpace) : clipped;
  return cut.trimEnd().replace(/[,;:\-–—([{]+$/, "").trimEnd() + "…";
}

export interface ArticleParts {
  /** Guaranteed to be within the network's limit, and never empty. */
  title: string;
  /** The body. Carries the full first line when the title had to be cut. */
  body: string;
  /** True when the title was shortened — the untouched line opens the body. */
  truncated: boolean;
}

/**
 * Split a post into the title + body shape every article network wants.
 *
 * The first line becomes the title and the rest becomes the body, which is the
 * convention the composer documents. A post with no second line keeps its whole
 * text as the body, so a single-paragraph post still publishes as an article
 * rather than a title with nothing under it.
 */
export function splitArticle(text: string, limit: number, fallback: string): ArticleParts {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const first = (lines[0] || normalized).trim();
  const rest = lines.slice(1).join("\n").trim();

  if ([...first].length <= limit) {
    return { title: first || fallback, body: rest || normalized.trim(), truncated: false };
  }

  return {
    title: clipTitle(first, limit) || fallback,
    // Rule 2: the full line survives as the opening paragraph.
    body: rest ? `${first}\n\n${rest}` : first,
    truncated: true,
  };
}
