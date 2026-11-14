import type { PublishProvider, PublishRequest, PublishResult } from "../types";
import { splitArticle } from "../title";

// Reddit adapter — submits a post to a subreddit via the API using a "script"
// app (OAuth password grant). Text-first: the first line becomes the title and
// the rest the body (self post); with a link it's a link post. Free, no review.
// The connection's accessToken holds JSON creds; externalId is the subreddit.
//
// Docs: https://www.reddit.com/dev/api/#POST_api_submit

const UA = "web:phoenixtekk-social-publishing:1.0 (by /u/phoenixtekk)";
/** Reddit's hard cap on a submission title. */
const TITLE_MAX = 300;

export class RedditProvider implements PublishProvider {
  readonly id = "reddit" as const;

  isConfigured(): boolean {
    return false; // connection-based (script creds pasted on Networks)
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const raw = req.credentials?.reddit?.accessToken;
    const subreddit = (req.credentials?.reddit?.externalId || "").replace(/^r\//, "");
    if (!raw || !subreddit) return this.fail("Reddit not connected — add it from the Networks page.");
    let c: { clientId: string; clientSecret: string; username: string; password: string };
    try {
      c = JSON.parse(raw);
    } catch {
      return this.fail("Reddit credentials are malformed — reconnect.");
    }

    try {
      const token = await this.token(c);
      if (!token) return this.fail("Reddit sign-in failed — check the app credentials / password.");

      // Reddit rejects a submission whose title exceeds 300 characters rather
      // than trimming it, so the cut happens here. An over-long first line is
      // kept in full at the top of the self-post body.
      const { title, body } = splitArticle(req.text, TITLE_MAX, "New post");
      const form = new URLSearchParams({ sr: subreddit, api_type: "json", title, resubmit: "true", sendreplies: "true" });
      if (req.link) {
        form.set("kind", "link");
        form.set("url", req.link);
      } else {
        form.set("kind", "self");
        form.set("text", body);
      }

      const res = await fetch("https://oauth.reddit.com/api/submit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      const d = (await res.json().catch(() => ({}))) as {
        json?: { errors?: [string, string][]; data?: { url?: string; name?: string } };
      };
      const err = d.json?.errors?.[0];
      if (err) return this.fail(`${err[0]}: ${err[1]}`, res.status);
      const data = d.json?.data;
      if (!res.ok || !data?.name) return this.fail(`Reddit returned HTTP ${res.status}.`, res.status);
      return { provider: this.id, ok: true, postId: data.name, url: data.url, statusCode: res.status };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling Reddit.");
    }
  }

  // OAuth2 "password" grant for a script app.
  private async token(c: { clientId: string; clientSecret: string; username: string; password: string }): Promise<string | null> {
    const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "password", username: c.username, password: c.password }),
    });
    if (!res.ok) return null;
    const d = (await res.json().catch(() => ({}))) as { access_token?: string };
    return d.access_token ?? null;
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
