import type {
  MediaInput,
  PublishProvider,
  PublishRequest,
  PublishResult,
} from "../types";
import { signedMediaUrl } from "@/lib/social/media";
import { composeWithLink } from "../compose";

// Threads adapter (Meta Threads API). Publish is a two-step flow: create a media
// container, then publish it. Images/video are referenced by URL — we hand
// Threads a short-lived signed public URL to our media.
//
// - text            → media_type=TEXT
// - single image    → media_type=IMAGE + image_url
// - multiple images → per-image carousel items → media_type=CAROUSEL
// - video           → media_type=VIDEO + video_url (processes async)
// Docs: https://developers.facebook.com/docs/threads/posts
const API = "https://graph.threads.net/v1.0";
/** Threads' hard cap on post text, enforced server-side by rejecting the post. */
const TEXT_MAX = 500;

export class ThreadsProvider implements PublishProvider {
  readonly id = "threads" as const;

  isConfigured(): boolean {
    return false; // connection-based (token + threads user id in social_connection)
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const cred = req.credentials?.threads;
    const token = cred?.accessToken;
    const userId = cred?.externalId;
    if (!token || !userId) {
      return this.fail("Threads not connected — connect it on the Networks page.");
    }

    // Threads rejects the whole post when it is over the limit — `Param text
    // must be at most 500 characters long` — and nothing here enforced it, so a
    // long post simply never published. Counted in code points; unlike Mastodon,
    // Threads charges a URL its real length, so the link is reserved at full
    // size rather than a flat rate.
    const text = composeWithLink(req.text, req.link, { limit: TEXT_MAX });
    const images = (req.media ?? []).filter((m) => m.kind === "image");
    const videos = (req.media ?? []).filter((m) => m.kind === "video");

    try {
      let containerId: string | null = null;

      if (videos.length > 0) {
        containerId = await this.createContainer(userId, token, {
          media_type: "VIDEO",
          video_url: signedMediaUrl(videos[0].id),
          text,
        });
      } else if (images.length === 1) {
        containerId = await this.createContainer(userId, token, {
          media_type: "IMAGE",
          image_url: signedMediaUrl(images[0].id),
          text,
        });
      } else if (images.length > 1) {
        containerId = await this.createCarousel(userId, token, images, text);
      } else {
        containerId = await this.createContainer(userId, token, { media_type: "TEXT", text });
      }

      if (!containerId) return this.fail("Threads: could not create the post container.");

      // Publish the container.
      const pubRes = await fetch(`${API}/${userId}/threads_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ creation_id: containerId, access_token: token }),
      });
      const published = (await pubRes.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!pubRes.ok || !published.id) {
        return this.fail(published.error?.message || `Threads publish HTTP ${pubRes.status}.`, pubRes.status);
      }

      return {
        provider: this.id,
        ok: true,
        postId: published.id,
        url: await this.permalink(published.id, token),
        statusCode: pubRes.status,
      };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling Threads.");
    }
  }

  private async createContainer(
    userId: string,
    token: string,
    fields: Record<string, string>
  ): Promise<string | null> {
    const body = new URLSearchParams({ ...fields, access_token: token });
    const res = await fetch(`${API}/${userId}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || !data.id) throw new Error(data.error?.message || `Threads container HTTP ${res.status}.`);
    return data.id;
  }

  private async createCarousel(
    userId: string,
    token: string,
    images: MediaInput[],
    text: string
  ): Promise<string | null> {
    const childIds: string[] = [];
    for (const img of images.slice(0, 10)) {
      const id = await this.createContainer(userId, token, {
        media_type: "IMAGE",
        image_url: signedMediaUrl(img.id),
        is_carousel_item: "true",
      });
      if (id) childIds.push(id);
    }
    return this.createContainer(userId, token, {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      text,
    });
  }

  private async permalink(mediaId: string, token: string): Promise<string | undefined> {
    try {
      const res = await fetch(`${API}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`);
      if (res.ok) {
        const p = (await res.json()) as { permalink?: string };
        return p.permalink;
      }
    } catch {
      /* optional */
    }
    return undefined;
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
