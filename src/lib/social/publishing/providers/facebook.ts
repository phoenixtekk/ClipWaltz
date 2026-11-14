import type {
  MediaInput,
  PublishProvider,
  PublishRequest,
  PublishResult,
} from "../types";

// Facebook Page adapter — posts to a Page feed via the Meta Graph API.
//
// Verified behaviour on a New Page Experience Page (2026-08-14):
//   • text/link         → POST /{page}/feed (message + link)
//   • single image      → POST /{page}/photos (multipart source + message)
//   • multiple images   → upload each unpublished (/photos published=false),
//                          then POST /{page}/feed with attached_media[]
//   • video             → POST /{page}/videos on graph-video.facebook.com
//   • unpublished/scheduled *feed* posts are rejected (#200) — we never use them.
// Note: Meta does not permit posting to personal profiles via API — Pages only.

const GRAPH = "https://graph.facebook.com";
const GRAPH_VIDEO = "https://graph-video.facebook.com";

export class FacebookPageProvider implements PublishProvider {
  readonly id = "facebook" as const;

  private readonly version = process.env.FACEBOOK_API_VERSION || "v21.0";
  // Default to the env Page; a specific connection instance overrides these.
  private pageId = process.env.FACEBOOK_PAGE_ID || "";
  private token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || "";

  isConfigured(): boolean {
    return Boolean(this.pageId && this.token);
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    // A stored connection (a specific Page) overrides the env default.
    const cred = req.credentials?.facebook;
    if (cred?.accessToken) this.token = cred.accessToken;
    if (cred?.externalId) this.pageId = cred.externalId;

    if (!this.pageId || !this.token) {
      return this.fail("Facebook not configured — connect a Page (or set FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN).");
    }

    const media = req.media ?? [];
    const images = media.filter((m) => m.kind === "image");
    const videos = media.filter((m) => m.kind === "video");
    // Photo/video posts carry the link inside the caption (no separate card).
    const caption = req.link ? `${req.text}\n\n${req.link}`.trim() : req.text;

    try {
      if (videos.length > 0) return await this.postVideo(videos[0], caption);
      if (images.length === 1) return await this.postSinglePhoto(images[0], caption);
      if (images.length > 1) return await this.postMultiPhoto(images, caption);
      return await this.postFeed(req.text, req.link);
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling Facebook.");
    }
  }

  // ── text / link ────────────────────────────────────────────────────────────
  private async postFeed(text: string, link?: string): Promise<PublishResult> {
    const body = new URLSearchParams();
    body.set("message", text);
    if (link) body.set("link", link);
    body.set("access_token", this.token);
    const res = await fetch(`${GRAPH}/${this.version}/${this.pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await this.json(res);
    if (!res.ok || !data.id) return this.fromError(res.status, data);
    return this.ok(data.id);
  }

  // ── single image ─────────────────────────────────────────────────────────��─
  private async postSinglePhoto(img: MediaInput, caption: string): Promise<PublishResult> {
    const form = new FormData();
    form.append("access_token", this.token);
    if (caption) form.append("message", caption);
    form.append("source", this.blob(img), img.filename);
    const res = await fetch(`${GRAPH}/${this.version}/${this.pageId}/photos`, {
      method: "POST",
      body: form,
    });
    const data = await this.json(res);
    const rawId = data.post_id || data.id;
    if (!res.ok || !rawId) return this.fromError(res.status, data);
    return this.ok(rawId);
  }

  // ── multiple images ──────────────────────────────────────────────────────────
  private async postMultiPhoto(images: MediaInput[], caption: string): Promise<PublishResult> {
    const fbids: string[] = [];
    for (const img of images) {
      const form = new FormData();
      form.append("access_token", this.token);
      form.append("published", "false");
      form.append("source", this.blob(img), img.filename);
      const res = await fetch(`${GRAPH}/${this.version}/${this.pageId}/photos`, {
        method: "POST",
        body: form,
      });
      const data = await this.json(res);
      if (!res.ok || !data.id) return this.fromError(res.status, data);
      fbids.push(data.id);
    }

    const body = new URLSearchParams();
    if (caption) body.set("message", caption);
    fbids.forEach((id, i) => body.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
    body.set("access_token", this.token);
    const res = await fetch(`${GRAPH}/${this.version}/${this.pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await this.json(res);
    if (!res.ok || !data.id) return this.fromError(res.status, data);
    return this.ok(data.id);
  }

  // ── video ────────────────────────────────────────────────────────────────────
  private async postVideo(video: MediaInput, description: string): Promise<PublishResult> {
    const form = new FormData();
    form.append("access_token", this.token);
    if (description) form.append("description", description);
    form.append("source", this.blob(video), video.filename);
    // Videos MUST use the dedicated graph-video host.
    const res = await fetch(`${GRAPH_VIDEO}/${this.version}/${this.pageId}/videos`, {
      method: "POST",
      body: form,
    });
    const data = await this.json(res);
    if (!res.ok || !data.id) return this.fromError(res.status, data);
    // Video processes async; the post appears once processing completes.
    return {
      provider: this.id,
      ok: true,
      postId: data.id,
      url: `https://www.facebook.com/watch/?v=${data.id}`,
      statusCode: res.status,
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private blob(m: MediaInput): Blob {
    // Copy into a fresh Uint8Array so Blob gets a clean ArrayBuffer.
    return new Blob([new Uint8Array(m.data)], { type: m.mime });
  }

  private async json(res: Response): Promise<{ id?: string; post_id?: string; error?: { message?: string } }> {
    return (await res.json().catch(() => ({}))) as {
      id?: string;
      post_id?: string;
      error?: { message?: string };
    };
  }

  private ok(rawId: string): PublishResult {
    return {
      provider: this.id,
      ok: true,
      postId: rawId,
      url: `https://www.facebook.com/${rawId.split("_").pop()}`,
      statusCode: 200,
    };
  }

  private fromError(status: number, data: { error?: { message?: string } }): PublishResult {
    return this.fail(data.error?.message || `Facebook Graph API returned HTTP ${status}.`, status);
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
