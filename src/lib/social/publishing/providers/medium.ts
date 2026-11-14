import type { PublishProvider, PublishRequest, PublishResult } from "../types";
import { markdownLink } from "../link-format";

// Medium adapter. Publishes a post via the (legacy but still-functional) Medium
// API using a self-issued integration token. Medium requires a title, so the
// post's FIRST line becomes the title and the remainder the body; a link is
// appended. Markdown content. Medium's API has no inline media upload, so
// images/video are not attached (text/markdown only).
//
// Auth: the connection's accessToken is the integration token; externalId is the
// Medium author id (from GET /v1/me at connect time).
//
// Docs: https://github.com/Medium/medium-api-docs
//   POST https://api.medium.com/v1/users/{authorId}/posts

const API = "https://api.medium.com/v1";
const TITLE_MAX = 100; // Medium's hard cap on the title field.

export class MediumProvider implements PublishProvider {
  readonly id = "medium" as const;

  isConfigured(): boolean {
    // Connection-based only (integration token stored via the Networks page).
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const cred = req.credentials?.medium;
    const token = cred?.accessToken; // integration token
    const authorId = cred?.externalId; // Medium user id
    if (!token || !authorId) {
      return this.fail("Medium not connected — add it from the Networks page.");
    }

    // First line → title (Medium requires one); the rest → body.
    const lines = req.text.replace(/\r\n/g, "\n").split("\n");
    const firstLine = (lines.shift() ?? "").trim();
    const rest = lines.join("\n").trim();
    const title = ([...firstLine].length > TITLE_MAX ? [...firstLine].slice(0, TITLE_MAX).join("") : firstLine) || "Untitled";

    // Markdown body: a visible H1 title, then the remaining text, then the link.
    let content = `# ${firstLine || title}`;
    if (rest) content += `\n\n${rest}`;
    if (req.link) content += `\n\n${markdownLink(req.link)}`;

    try {
      const res = await fetch(`${API}/users/${encodeURIComponent(authorId)}/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          title,
          contentFormat: "markdown",
          content,
          publishStatus: "public",
        }),
        signal: AbortSignal.timeout(25_000),
      });
      const d = (await res.json().catch(() => ({}))) as {
        data?: { id?: string; url?: string };
        errors?: { message?: string; code?: number }[];
      };
      if (!res.ok || !d.data?.id) {
        let msg = d.errors?.[0]?.message || `Medium returned HTTP ${res.status}.`;
        if (res.status === 401) {
          msg = "Medium rejected the integration token — it may have been revoked. Reconnect on the Networks page (Medium no longer issues new tokens to accounts that never had one).";
        }
        return this.fail(msg, res.status);
      }
      return {
        provider: this.id,
        ok: true,
        postId: d.data.id,
        url: d.data.url,
        statusCode: res.status,
      };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling Medium.");
    }
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
