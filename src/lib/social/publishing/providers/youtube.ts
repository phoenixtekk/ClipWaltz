import type { PublishProvider, PublishRequest, PublishResult } from "../types";
import { clipTitle } from "../title";

// YouTube adapter — uploads a video via the Data API v3 (videos.insert) using an
// OAuth2 refresh token (never expires) to mint short-lived access tokens.
// VIDEO ONLY: a post without a video is skipped with a clear error. The
// connection's accessToken holds JSON { clientId, clientSecret, refreshToken }.
//
// Docs: https://developers.google.com/youtube/v3/docs/videos/insert

const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart";

export class YouTubeProvider implements PublishProvider {
  readonly id = "youtube" as const;

  isConfigured(): boolean {
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const raw = req.credentials?.youtube?.accessToken;
    if (!raw) return this.fail("YouTube not connected — add it from the Networks page.");
    let c: { clientId: string; clientSecret: string; refreshToken: string };
    try {
      c = JSON.parse(raw);
    } catch {
      return this.fail("YouTube credentials are malformed — reconnect.");
    }

    const video = (req.media ?? []).find((m) => m.kind === "video");
    if (!video) return this.fail("YouTube needs a video attached — add one in the composer (Share Videos).");

    try {
      const token = await this.accessToken(c);
      if (!token) return this.fail("YouTube token refresh failed — reconnect.");

      const extra = (req.providerMeta?.youtube ?? {}) as YouTubeExtras;

      // The first line is the title and the rest is the description — the
      // convention every long-form provider here follows.
      const lines = req.text.split("\n");
      // 100 CHARACTERS (the description below is 5000 bytes — different unit,
      // different helper). Clipped in code points so an emoji in a title is not
      // cut in half into a lone surrogate, which YouTube rejects outright.
      const title = clipTitle(scrub(extra.title ?? lines[0] ?? "Video"), 100) || "Video";
      const rest = extra.description ?? [lines.slice(1).join("\n").trim(), req.link].filter(Boolean).join("\n\n");

      const meta = {
        snippet: {
          title,
          // 5000 BYTES, not characters — a naive character slice passes a
          // 5000-char description that is far over the real limit and the whole
          // upload is rejected.
          description: clampBytes(scrub(rest), 5000),
          ...(extra.tags?.length ? { tags: extra.tags } : {}),
          ...(extra.categoryId ? { categoryId: extra.categoryId } : {}),
        },
        status: {
          // Default PRIVATE, not public. Google restricts uploads from
          // unaudited API projects to private regardless of what is asked for,
          // so claiming "public" here only produced a video whose real state
          // disagreed with the request. Review-then-promote is also the agreed
          // rollout.
          privacyStatus: extra.privacyStatus ?? "private",
          selfDeclaredMadeForKids: false,
        },
      };

      // multipart/related: JSON metadata part + raw video part.
      const b = `sp${Date.now().toString(36)}`;
      const head = Buffer.from(
        `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${video.mime || "video/*"}\r\n\r\n`
      );
      const tail = Buffer.from(`\r\n--${b}--`);
      const body = Buffer.concat([head, video.data, tail]);

      const res = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${b}` },
        body,
      });
      const d = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (!res.ok || !d.id) return this.fail(d.error?.message || `YouTube returned HTTP ${res.status}.`, res.status);

      // The thumbnail is a separate call, and a failure here must NOT fail the
      // post: the video is already up and re-publishing to fix a picture would
      // duplicate it. Recorded on the result instead.
      let thumbNote = "";
      if (extra.thumbnail?.length) {
        const ok = await this.setThumbnail(token, d.id, extra.thumbnail);
        if (!ok) thumbNote = " (the custom thumbnail was rejected — set it by hand)";
      }

      return {
        provider: this.id,
        ok: true,
        postId: d.id,
        url: `https://youtu.be/${d.id}`,
        statusCode: res.status,
        ...(thumbNote ? { error: `Uploaded${thumbNote}` } : {}),
      };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling YouTube.");
    }
  }

  private async accessToken(c: { clientId: string; clientSecret: string; refreshToken: string }): Promise<string | null> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        refresh_token: c.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const d = (await res.json().catch(() => ({}))) as { access_token?: string };
    return d.access_token ?? null;
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }

  /** `thumbnails.set` — accepted by the same `youtube.upload` scope the app already holds. */
  private async setThumbnail(token: string, videoId: string, png: Buffer): Promise<boolean> {
    try {
      const res = await fetch(
        `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
          body: new Uint8Array(png),
          signal: AbortSignal.timeout(60_000),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}

/** What the explainer pipeline hands this adapter through `providerMeta.youtube`. */
export interface YouTubeExtras {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus?: "private" | "unlisted" | "public";
  /** PNG bytes for `thumbnails.set`. */
  thumbnail?: Buffer;
}

/** YouTube rejects `<` and `>` in both title and description. */
function scrub(s: string): string {
  return s.replace(/[<>]/g, "").trim();
}

/**
 * Trim to a BYTE budget, then repair a character the cut split in half.
 * An invalid trailing UTF-8 sequence makes the API reject the request outright.
 */
function clampBytes(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
  const buf = Buffer.from(s, "utf8").subarray(0, maxBytes);
  return new TextDecoder("utf-8", { fatal: false }).decode(buf).replace(/�+$/, "").trimEnd();
}
