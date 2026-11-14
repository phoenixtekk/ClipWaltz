import type {
  MediaInput,
  PublishProvider,
  PublishRequest,
  PublishResult,
} from "../types";
import { signedMediaUrl } from "@/lib/social/media";

// Instagram adapter — posts to the Instagram Business/Creator account linked to
// the Facebook Page, via the SAME Page access token. Two-step container flow.
// Instagram REQUIRES media (image/video) referenced by a public URL.
//
// Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
const GRAPH = "https://graph.facebook.com";

function version() {
  return process.env.FACEBOOK_API_VERSION || "v21.0";
}

/** The IG Business account id linked to the Page (or null). Shared with UI status. */
export async function getInstagramUserId(): Promise<string | null> {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) return null;
  try {
    const res = await fetch(
      `${GRAPH}/${version()}/${pageId}?fields=instagram_business_account&access_token=${encodeURIComponent(token)}`
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { instagram_business_account?: { id?: string } };
    return d.instagram_business_account?.id ?? null;
  } catch {
    return null;
  }
}

export class InstagramProvider implements PublishProvider {
  readonly id = "instagram" as const;

  isConfigured(): boolean {
    return false; // resolved via the linked-account check in getProviderStatuses
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    // A stored connection provides its own token + IG user id; otherwise fall
    // back to the env Page token and the IG account linked to it.
    const cred = req.credentials?.instagram;
    const token = cred?.accessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    if (!token) return this.fail("Instagram rides on a Page token — connect Facebook/Instagram first.");

    const igUserId = cred?.externalId || (await getInstagramUserId());
    if (!igUserId) {
      return this.fail("No Instagram Business account is linked to the Facebook Page.");
    }

    const images = (req.media ?? []).filter((m) => m.kind === "image");
    const videos = (req.media ?? []).filter((m) => m.kind === "video");
    if (images.length === 0 && videos.length === 0) {
      return this.fail("Instagram requires an image or video.");
    }
    const caption = req.link ? `${req.text}\n\n${req.link}`.trim() : req.text;

    try {
      let creationId: string | null;
      if (videos.length > 0) {
        creationId = await this.createContainer(igUserId, token, {
          media_type: "REELS",
          video_url: signedMediaUrl(videos[0].id),
          caption,
        });
      } else if (images.length === 1) {
        creationId = await this.createContainer(igUserId, token, {
          image_url: signedMediaUrl(images[0].id),
          caption,
        });
      } else {
        creationId = await this.createCarousel(igUserId, token, images, caption);
      }
      if (!creationId) return this.fail("Instagram: could not create the media container.");

      const pubRes = await fetch(`${GRAPH}/${version()}/${igUserId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ creation_id: creationId, access_token: token }),
      });
      const data = (await pubRes.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (!pubRes.ok || !data.id) {
        return this.fail(data.error?.message || `Instagram publish HTTP ${pubRes.status}.`, pubRes.status);
      }
      return { provider: this.id, ok: true, postId: data.id, statusCode: pubRes.status };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling Instagram.");
    }
  }

  private async createContainer(
    igUserId: string,
    token: string,
    fields: Record<string, string>
  ): Promise<string | null> {
    const res = await fetch(`${GRAPH}/${version()}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, access_token: token }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || !data.id) throw new Error(data.error?.message || `Instagram container HTTP ${res.status}.`);
    return data.id;
  }

  private async createCarousel(
    igUserId: string,
    token: string,
    images: MediaInput[],
    caption: string
  ): Promise<string | null> {
    const children: string[] = [];
    for (const img of images.slice(0, 10)) {
      const id = await this.createContainer(igUserId, token, {
        image_url: signedMediaUrl(img.id),
        is_carousel_item: "true",
      });
      if (id) children.push(id);
    }
    return this.createContainer(igUserId, token, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption,
    });
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
