import type { MediaInput, PublishProvider, PublishRequest, PublishResult } from "../types";
import { composeWithLink } from "../compose";
import { safeFetch, sanitizeUpstreamMessage } from "@/lib/social/safe-fetch";

// Mastodon adapter. Posts a status via the instance's REST API. The connection's
// accessToken holds JSON { instance, token } because Mastodon is federated — the
// same token means nothing without knowing which server issued it. Media is
// uploaded to /api/v2/media first, then attached to the status by id.
//
// Docs: https://docs.joinmastodon.org/methods/statuses/ + /methods/media/

const LIMIT = 500; // Mastodon's default max_toot_chars (safe across instances).
const MAX_MEDIA = 4; // Mastodon attaches up to 4 images per status.
/**
 * What Mastodon charges for a URL, however long it really is — the instance
 * advertises it as `characters_reserved_per_url` (23 on mastodon.social).
 *
 * It is a discount for a long link and a SURCHARGE for a short one, and that
 * surcharge is what used to break this adapter: the link was appended and the
 * whole string then truncated to 500, which left an 18-character URL FRAGMENT.
 * Mastodon charged 23 for it, counted 505, and rejected the post
 * (`Validation failed: Text character limit of 500 exceeded`) — while a post
 * that did squeak through carried a half-cut, unclickable link.
 */
const URL_COST = 23;
/** Deliberately loose, and only ever used for COUNTING — never for rewriting. */
const URL_RE = /https?:\/\/\S+/g;

/** Mastodon's character count, which is not JavaScript's. */
export function mastodonLength(s: string): number {
  return [...s.replace(URL_RE, "x".repeat(URL_COST))].length;
}

/**
 * Text + link, guaranteed to fit Mastodon's own count, with the link WHOLE.
 *
 * `linkCost` is the flat reservation rather than the link's real length: that
 * is the whole point of the 23-character floor, and ignoring it is what made a
 * 500-character status count 505.
 */
export function compose(text: string, link?: string): string {
  return composeWithLink(text, link, {
    limit: LIMIT,
    count: mastodonLength,
    linkCost: () => URL_COST,
  });
}

export class MastodonProvider implements PublishProvider {
  readonly id = "mastodon" as const;

  isConfigured(): boolean {
    // Connection-based only (instance + token stored via the Networks page).
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const raw = req.credentials?.mastodon?.accessToken;
    if (!raw) return this.fail("Mastodon not connected — add it from the Networks page.");
    let c: { instance: string; token: string };
    try {
      c = JSON.parse(raw);
    } catch {
      return this.fail("Mastodon credentials are malformed — reconnect on the Networks page.");
    }
    if (!c.instance || !c.token) return this.fail("Mastodon credentials are incomplete — reconnect on the Networks page.");

    const instance = c.instance.replace(/\/$/, "");
    const auth = { Authorization: `Bearer ${c.token}` };

    try {
      // Link appended whole after the trim; Mastodon auto-links URLs.
      const status = compose(req.text, req.link);

      // Upload up to 4 images first (video: a single attachment).
      const media = req.media ?? [];
      const mediaIds: string[] = [];
      const uploadable = media[0]?.kind === "video" ? media.slice(0, 1) : media.slice(0, MAX_MEDIA);
      for (const m of uploadable) {
        const id = await this.uploadMedia(instance, auth, m);
        if (id) mediaIds.push(id);
      }

      const form = new URLSearchParams();
      form.set("status", status);
      for (const id of mediaIds) form.append("media_ids[]", id);

      const res = await safeFetch(`${instance}/api/v1/statuses`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      const d = (await res.json().catch(() => ({}))) as { id?: string; url?: string; error?: string };
      if (!res.ok || !d.id) {
        return this.fail(sanitizeUpstreamMessage(d.error) || `Mastodon returned HTTP ${res.status}.`, res.status);
      }
      return {
        provider: this.id,
        ok: true,
        postId: d.id,
        url: d.url || `${instance}/@me/${d.id}`,
        statusCode: res.status,
      };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling Mastodon.");
    }
  }

  /** Upload one attachment → returns its media id (or null on failure). */
  private async uploadMedia(instance: string, auth: Record<string, string>, m: MediaInput): Promise<string | null> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(m.data)], { type: m.mime || "application/octet-stream" }), m.filename || "upload.bin");
    const res = await safeFetch(`${instance}/api/v2/media`, {
      method: "POST",
      headers: auth,
      body: form,
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (!res) return null;
    // 200 = ready, 202 = processing (id is still usable for the status).
    if (res.status !== 200 && res.status !== 202) return null;
    const d = (await res.json().catch(() => ({}))) as { id?: string };
    return d.id ?? null;
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
