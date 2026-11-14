import type { PublishProvider, PublishRequest, PublishResult } from "../types";
import { signedMediaUrl } from "@/lib/social/media";

// TikTok adapter — Content Posting API. Uploads a video to the user's TikTok
// DRAFTS (inbox) via PULL_FROM_URL; the user finalizes/publishes in the TikTok
// app. Direct-publish requires TikTok app audit, but the inbox/draft flow works
// for unaudited apps with the video.upload scope. VIDEO ONLY.
// The connection's accessToken holds JSON { clientKey, clientSecret, refreshToken }.
// NOTE: PULL_FROM_URL requires the media host to be a verified URL prefix in the
// TikTok app (publish.phoenixtekk.com).
//
// Docs: https://developers.tiktok.com/doc/content-posting-api-reference-upload-video/

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const INBOX_INIT = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";

export class TikTokProvider implements PublishProvider {
  readonly id = "tiktok" as const;

  isConfigured(): boolean {
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const raw = req.credentials?.tiktok?.accessToken;
    if (!raw) return this.fail("TikTok not connected — add it from the Networks page.");
    let c: { clientKey: string; clientSecret: string; refreshToken: string };
    try {
      c = JSON.parse(raw);
    } catch {
      return this.fail("TikTok credentials are malformed — reconnect.");
    }

    const video = (req.media ?? []).find((m) => m.kind === "video");
    if (!video) return this.fail("TikTok needs a video attached — add one in the composer (Share Videos).");

    try {
      const refreshed = await this.accessToken(c);
      if (!refreshed) return this.fail("TikTok token refresh failed — reconnect.");
      // TikTok rotates the refresh token; persist the new blob.
      const updatedAccessToken = JSON.stringify({ clientKey: c.clientKey, clientSecret: c.clientSecret, refreshToken: refreshed.rt });

      const res = await fetch(INBOX_INIT, {
        method: "POST",
        headers: { Authorization: `Bearer ${refreshed.accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ source_info: { source: "PULL_FROM_URL", video_url: signedMediaUrl(video.id, 3600) } }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        data?: { publish_id?: string };
        error?: { code?: string; message?: string };
      };
      if (d.error && d.error.code && d.error.code !== "ok") {
        return { ...this.fail(d.error.message || `TikTok error: ${d.error.code}`, res.status), updatedAccessToken };
      }
      if (!res.ok || !d.data?.publish_id) return { ...this.fail(`TikTok returned HTTP ${res.status}.`, res.status), updatedAccessToken };
      // Video lands in the user's TikTok drafts (no public URL until they publish).
      return { provider: this.id, ok: true, postId: d.data.publish_id, statusCode: res.status, updatedAccessToken };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling TikTok.");
    }
  }

  private async accessToken(c: { clientKey: string; clientSecret: string; refreshToken: string }): Promise<{ accessToken: string; rt: string } | null> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: c.clientKey,
        client_secret: c.clientSecret,
        grant_type: "refresh_token",
        refresh_token: c.refreshToken,
      }),
    });
    if (!res.ok) return null;
    const d = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string };
    if (!d.access_token) return null;
    return { accessToken: d.access_token, rt: d.refresh_token || c.refreshToken };
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
