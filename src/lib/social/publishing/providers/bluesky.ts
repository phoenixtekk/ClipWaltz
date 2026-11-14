import type {
  MediaInput,
  PublishProvider,
  PublishRequest,
  PublishResult,
} from "../types";
import { composeWithLink } from "../compose";
import { fitImage } from "../image-fit";

// Bluesky adapter (AT Protocol). No developer app / review needed — auth is the
// account handle + an app password (created in Bluesky settings). We store the
// app password as the connection credential and mint a fresh session per publish.
//
// Docs: https://docs.bsky.app/docs/api/com-atproto-repo-create-record

const PDS = process.env.BLUESKY_PDS || "https://bsky.social";
const POST_COLLECTION = "app.bsky.feed.post";
/** Bluesky's post limit, counted in graphemes. */
const TEXT_MAX = 300;
/**
 * Bluesky's hard blob ceiling. It rejects the whole record over this
 * (`blob too big (maximum 2000000, got 2109815)`), so one oversized picture
 * takes the entire post down with it — hence `fitImage` rather than a failure.
 */
const BLOB_MAX = 2_000_000;

export class BlueskyProvider implements PublishProvider {
  readonly id = "bluesky" as const;

  isConfigured(): boolean {
    // Bluesky is connection-based only (no env creds).
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const cred = req.credentials?.bluesky;
    const identifier = cred?.externalId; // stored: the account DID
    const appPassword = cred?.accessToken; // stored: the app password
    if (!identifier || !appPassword) {
      return this.fail("Bluesky not connected — add it from the Networks page.");
    }

    try {
      // 1. Session
      const session = await this.createSession(identifier, appPassword);
      if (!session) return this.fail("Bluesky sign-in failed — check the app password.");

      // 2. Media. A Bluesky post is either a video OR up to 4 images.
      const videos = (req.media ?? []).filter((m) => m.kind === "video");
      const images = (req.media ?? []).filter((m) => m.kind === "image").slice(0, 4);
      let embed: Record<string, unknown> | null = null;

      if (videos.length > 0) {
        const videoBlob = await this.uploadVideo(session, videos[0]);
        if (!videoBlob) return this.fail("Bluesky video upload/processing failed.");
        embed = { $type: "app.bsky.embed.video", video: videoBlob };
      } else if (images.length > 0) {
        const blobs = [];
        for (const img of images) {
          const blob = await this.uploadBlob(session.accessJwt, img);
          if (blob) blobs.push({ alt: "", image: blob });
        }
        if (blobs.length > 0) embed = { $type: "app.bsky.embed.images", images: blobs };
      }

      // 3. Record. Bluesky posts cap at 300 graphemes; long text is auto-shortened
      // (the full text still goes to Facebook/LinkedIn). Link appended when present.
      // The link is reserved for and appended WHOLE — the old code appended it
      // and then cut the result, which at 300 characters routinely sliced the
      // URL in half and cost the post the click it exists for.
      const text = composeWithLink(req.text, req.link, { limit: TEXT_MAX });
      const record: Record<string, unknown> = {
        $type: POST_COLLECTION,
        text,
        createdAt: new Date().toISOString(),
        langs: ["en"],
      };
      if (embed) record.embed = embed;

      const res = await fetch(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessJwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repo: session.did, collection: POST_COLLECTION, record }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        uri?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.uri) {
        return this.fail(data.message || data.error || `Bluesky returned HTTP ${res.status}.`, res.status);
      }

      const rkey = data.uri.split("/").pop();
      return {
        provider: this.id,
        ok: true,
        postId: data.uri,
        url: rkey ? `https://bsky.app/profile/${session.did}/post/${rkey}` : undefined,
        statusCode: res.status,
      };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling Bluesky.");
    }
  }

  private async createSession(identifier: string, password: string) {
    const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { accessJwt: string; did: string; handle: string };
  }

  // Video path: service-auth (aud = the account's PDS DID) → upload to
  // video.bsky.app → poll the processing job → return the resulting blob.
  private async uploadVideo(
    session: { accessJwt: string; did: string },
    video: MediaInput
  ): Promise<unknown | null> {
    const pdsHost = await this.resolvePdsHost(session.did);
    if (!pdsHost) return null;
    const pdsDid = `did:web:${pdsHost}`;

    const saRes = await fetch(
      `${PDS}/xrpc/com.atproto.server.getServiceAuth?aud=${encodeURIComponent(pdsDid)}&lxm=com.atproto.repo.uploadBlob`,
      { headers: { Authorization: `Bearer ${session.accessJwt}` } }
    );
    if (!saRes.ok) return null;
    const serviceToken = ((await saRes.json()) as { token?: string }).token;
    if (!serviceToken) return null;

    const upRes = await fetch(
      `https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(session.did)}&name=${Date.now()}.mp4`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceToken}`, "Content-Type": video.mime || "video/mp4" },
        body: new Uint8Array(video.data),
      }
    );
    const up = (await upRes.json().catch(() => ({}))) as { jobId?: string };
    if (!up.jobId) return null;

    // Poll until the video is processed (~a few seconds for short clips).
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const jsRes = await fetch(
        `https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?jobId=${up.jobId}`,
        { headers: { Authorization: `Bearer ${session.accessJwt}` } }
      );
      const js = ((await jsRes.json().catch(() => ({}))) as {
        jobStatus?: { state?: string; blob?: unknown };
      }).jobStatus;
      if (js?.state === "JOB_STATE_COMPLETED" && js.blob) return js.blob;
      if (js?.state === "JOB_STATE_FAILED") return null;
    }
    return null;
  }

  // Resolve the account's PDS host from its DID document (did:plc via plc.directory).
  private async resolvePdsHost(did: string): Promise<string | null> {
    try {
      const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
      if (!res.ok) return null;
      const doc = (await res.json()) as {
        service?: { id?: string; type?: string; serviceEndpoint?: string }[];
      };
      const svc = (doc.service || []).find(
        (s) => s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer"
      );
      if (svc?.serviceEndpoint) return new URL(svc.serviceEndpoint).host;
    } catch {
      /* fall through */
    }
    return null;
  }

  private async uploadBlob(accessJwt: string, media: MediaInput) {
    // Shrunk to Bluesky's ceiling before it is offered, not after it is refused.
    const fitted = await fitImage(media.data, media.mime, BLOB_MAX);
    const res = await fetch(`${PDS}/xrpc/com.atproto.repo.uploadBlob`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessJwt}`, "Content-Type": fitted.mime },
      body: new Uint8Array(fitted.data),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { blob?: unknown };
    return d.blob ?? null;
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
