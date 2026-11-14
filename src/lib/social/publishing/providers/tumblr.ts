import type { PublishProvider, PublishRequest, PublishResult } from "../types";
import { tumblrRefresh } from "@/lib/social/oauth/tumblr";

// Tumblr adapter. Posts via the v2 API in Neue Post Format (NPF). The connection's
// accessToken holds JSON { clientId, clientSecret, refreshToken }; externalId is
// the blog identifier (e.g. "myblog.tumblr.com"). Access tokens are short-lived,
// so we refresh on each publish and persist the (possibly rotated) refresh token
// via `updatedAccessToken`. Text/link only (image NPF blocks need public URLs).
//
// Docs: https://www.tumblr.com/docs/en/api/v2#post--create-a-new-blog-post-neue-post-format

const API = "https://api.tumblr.com/v2";

export class TumblrProvider implements PublishProvider {
  readonly id = "tumblr" as const;

  isConfigured(): boolean {
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const raw = req.credentials?.tumblr?.accessToken;
    const blog = req.credentials?.tumblr?.externalId;
    if (!raw || !blog) return this.fail("Tumblr not connected — connect it on the Networks page.");
    let c: { clientId: string; clientSecret: string; refreshToken: string };
    try {
      c = JSON.parse(raw);
    } catch {
      return this.fail("Tumblr credentials are malformed — reconnect on the Networks page.");
    }

    try {
      const refreshed = await tumblrRefresh(c.refreshToken);
      if (!refreshed) return this.fail("Tumblr token refresh failed — reconnect on the Networks page.");
      const updatedAccessToken = JSON.stringify({
        clientId: c.clientId,
        clientSecret: c.clientSecret,
        refreshToken: refreshed.refreshToken || c.refreshToken,
      });

      // NPF content blocks: the body text, then the link as its own block.
      const content: { type: string; text?: string; url?: string }[] = [{ type: "text", text: req.text }];
      if (req.link) content.push({ type: "link", url: req.link });

      const res = await fetch(`${API}/blog/${encodeURIComponent(blog)}/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${refreshed.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ content, state: "published" }),
        signal: AbortSignal.timeout(20_000),
      });
      const d = (await res.json().catch(() => ({}))) as {
        response?: { id_string?: string; id?: number };
        meta?: { status?: number; msg?: string };
        errors?: { title?: string; detail?: string }[];
      };
      const postId = d.response?.id_string || (d.response?.id != null ? String(d.response.id) : undefined);
      if (!res.ok || !postId) {
        const msg = d.errors?.[0]?.detail || d.errors?.[0]?.title || d.meta?.msg || `Tumblr returned HTTP ${res.status}.`;
        return { ...this.fail(msg, res.status), updatedAccessToken };
      }
      return {
        provider: this.id,
        ok: true,
        postId,
        url: `https://${blog}/post/${postId}`,
        statusCode: res.status,
        updatedAccessToken,
      };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling Tumblr.");
    }
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
