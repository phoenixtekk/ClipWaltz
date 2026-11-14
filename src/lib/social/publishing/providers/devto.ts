import { signedMediaUrl } from "@/lib/social/media";
import type {
  PublishProvider,
  PublishRequest,
  PublishResult,
} from "../types";
import { markdownLink } from "../link-format";
import { splitArticle } from "../title";

// DEV Community (dev.to) adapter — Forem's public write API.
//
// Auth is a personal API key from the account's Extensions settings, sent as an
// `api-key` header. No OAuth app, no review.
//
// Like Medium, a post here is an *article*, not a status update: the first line
// becomes the title and the rest becomes the markdown body.
//
// Docs: https://developers.forem.com/api/v1#tag/articles

const API = "https://dev.to/api";
/**
 * Forem's own limit, quoted from the rejection it sends:
 * `Title is too long (maximum is 128 characters for full_post)`.
 *
 * This was 250 — a number nothing enforces — so the local truncation never fired
 * and the API rejected the whole article instead. Counted in code points, which
 * is what Rails' `length:` validator counts.
 */
const TITLE_MAX = 128;
/** Forem accepts at most four tags, lower-case and alphanumeric. */
const TAG_MAX = 4;

export class DevToProvider implements PublishProvider {
  readonly id = "devto" as const;

  isConfigured(): boolean {
    // Connection-based only (API key stored via the Networks page).
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const cred = req.credentials?.devto;
    const key = cred?.accessToken;
    if (!key) {
      return this.fail("dev.to not connected — add an API key from the Networks page.");
    }

    // A first line longer than Forem's limit is shortened for the title and kept
    // in full at the top of the article, so the post publishes and no text is
    // lost. See `splitArticle`.
    const { title, body: opening } = splitArticle(req.text, TITLE_MAX, "New post");
    let body = opening;

    // dev.to has no separate link field, so a link is appended to the markdown
    // rather than dropped. `canonical_url` is deliberately not used for this:
    // that field means "this was published elsewhere first", which would tell
    // search engines to credit the other page instead of the article.
    if (req.link) body = `${body}\n\n${markdownLink(req.link)}`;

    // Images: Forem renders markdown, and the article body is the only place a
    // picture can go, so attachments are linked rather than uploaded.
    for (const m of req.media ?? []) {
      if (m.kind === "image") body += `\n\n![](${signedMediaUrl(m.id)})`;
    }

    const tags = (cred?.externalId ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9]/g, ""))
      .filter(Boolean)
      .slice(0, TAG_MAX);

    // A connection can be set to file drafts instead of publishing outright —
    // useful when a human should read an article before it goes live.
    const published = cred?.scope !== "draft";

    try {
      const res = await fetch(`${API}/articles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": key },
        body: JSON.stringify({
          article: { title, body_markdown: body, published, ...(tags.length ? { tags } : {}) },
        }),
        signal: AbortSignal.timeout(45_000),
      });

      const raw = await res.text();
      if (!res.ok) return this.fail(this.reason(raw, res.status), res.status);

      const d = JSON.parse(raw) as { id?: number; url?: string };
      return {
        provider: this.id,
        ok: true,
        postId: d.id ? String(d.id) : undefined,
        url: d.url,
        statusCode: res.status,
      };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling dev.to.");
    }
  }

  /**
   * Turn Forem's reply into something actionable.
   *
   * Note the 429: dev.to answers an *invalid* key with "Retry later" rather than
   * 401, so a rate-limit response usually means the key is wrong — saying only
   * "rate limited" would send someone looking in entirely the wrong place.
   */
  private reason(body: string, status: number): string {
    if (status === 401) return "dev.to rejected the API key. Generate a new one in Settings → Extensions.";
    if (status === 429) {
      return "dev.to answered “Retry later”. That usually means the API key is invalid — it throttles failed keys rather than rejecting them outright. If the key is definitely right, you have hit the posting rate limit; wait a few minutes.";
    }
    try {
      const d = JSON.parse(body) as { error?: string };
      if (d.error) return `dev.to: ${d.error}`;
    } catch {
      /* fall through to the raw text */
    }
    return body ? body.slice(0, 160) : `dev.to returned HTTP ${status}.`;
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
