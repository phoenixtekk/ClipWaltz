import type { PublishProvider, PublishRequest, PublishResult } from "../types";

// X (Twitter) adapter — posts via the v2 API using OAuth 2.0 user context, which
// the FREE tier permits for POST /2/tweets. The connection's accessToken holds
// JSON { cid, csec, rt } (client id/secret + refresh token). X rotates the
// refresh token on every use, so after refreshing we return the new blob via
// `updatedAccessToken` for the caller to persist. Text/link only (media upload
// on X free + OAuth2 is not reliably available); long text trims to 280.
//
// Docs: https://developer.x.com/en/docs/authentication/oauth-2-0

const TWEET_URL = "https://api.twitter.com/2/tweets";
const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const LIMIT = 280;

export class XProvider implements PublishProvider {
  readonly id = "x" as const;

  isConfigured(): boolean {
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const raw = req.credentials?.x?.accessToken;
    if (!raw) return this.fail("X not connected — add it from the Networks page.");
    let c: { cid: string; csec: string; rt: string };
    try {
      c = JSON.parse(raw);
    } catch {
      return this.fail("X credentials are malformed — reconnect on the Networks page.");
    }

    try {
      // Refresh → short-lived access token (+ a rotated refresh token to persist).
      const refreshed = await this.refresh(c);
      if (!refreshed) return this.fail("X token refresh failed — reconnect (the refresh token may have expired or been rotated elsewhere).");
      const updatedAccessToken = JSON.stringify({ cid: c.cid, csec: c.csec, rt: refreshed.rt });

      // Build text within 280, preserving the link.
      let text = req.text;
      if (req.link) {
        const budget = LIMIT - (req.link.length + 1);
        if ([...text].length > budget) text = [...text].slice(0, Math.max(0, budget - 1)).join("") + "…";
        text = `${text}\n${req.link}`;
      } else if ([...text].length > LIMIT) {
        text = [...text].slice(0, LIMIT - 1).join("") + "…";
      }

      const res = await fetch(TWEET_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${refreshed.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(20_000),
      });
      const d = (await res.json().catch(() => ({}))) as {
        data?: { id?: string };
        detail?: string;
        title?: string;
        errors?: { message?: string }[];
      };
      if (!res.ok || !d.data?.id) {
        let msg = d.detail || d.errors?.[0]?.message || d.title || `X returned HTTP ${res.status}.`;
        if (res.status === 402 || /credits.?depleted/i.test(msg)) {
          msg = "X free-tier posting credits are depleted — top up credits or upgrade your X API plan (developer.x.com → your project → Usage). The connection is fine; this is an X billing limit.";
        }
        // Still persist the rotated token so the next attempt can refresh.
        return { ...this.fail(msg, res.status), updatedAccessToken };
      }
      return {
        provider: this.id,
        ok: true,
        postId: d.data.id,
        url: `https://x.com/i/status/${d.data.id}`,
        statusCode: res.status,
        updatedAccessToken,
      };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling X.");
    }
  }

  private async refresh(c: { cid: string; csec: string; rt: string }): Promise<{ accessToken: string; rt: string } | null> {
    const basic = Buffer.from(`${c.cid}:${c.csec}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: c.rt, client_id: c.cid }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const d = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string };
    if (!d.access_token) return null;
    return { accessToken: d.access_token, rt: d.refresh_token || c.rt };
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
