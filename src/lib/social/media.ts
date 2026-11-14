import { createHmac, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getObjectBytes, putObject, deleteObject } from "@/lib/storage";
import { appUrl } from "./app-url";

// Social post media, ported from SP `src/lib/media.ts`.
//
// SP kept files on linuxg1's disk under MEDIA_STORAGE_DIR, named by media id. ClipWaltz keeps them in MinIO under
// `social/<workspaceId>/<mediaId>` (plan §4.6) and records the key on the `social_media` row, so a media id is all a
// caller needs — the same contract the adapters were written against.

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB (SP's limit)

export const ALLOWED_MIME: Record<string, "image" | "video"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
};

const ID_RE = /^[a-f0-9-]{36}$/i;

/** The MinIO key a workspace's social media object lives under. */
export function socialMediaKey(workspaceId: string, mediaId: string): string {
  if (!ID_RE.test(mediaId)) throw new Error("bad media id");
  return `social/${workspaceId}/${mediaId}`;
}

/** Store bytes for a media id. Returns the storage key to record on the row. */
export async function writeMedia(workspaceId: string, id: string, data: Uint8Array, mime?: string): Promise<string> {
  const key = socialMediaKey(workspaceId, id);
  await putObject(key, data, mime);
  return key;
}

/** Read a stored media file. `id` is a server-generated UUID; anything else is rejected. */
export async function readMedia(id: string): Promise<Buffer> {
  if (!ID_RE.test(id)) throw new Error("bad id");
  const [row] = await db
    .select({ storageKey: schema.socialMedia.storageKey })
    .from(schema.socialMedia)
    .where(eq(schema.socialMedia.id, id));
  if (!row) throw new Error("media not found");
  return Buffer.from(await getObjectBytes(row.storageKey));
}

/**
 * Remove a stored object. A missing object is not an error: the caller's intent is "this should not exist", and it
 * already doesn't.
 */
export async function deleteMedia(id: string): Promise<void> {
  if (!ID_RE.test(id)) throw new Error("bad id");
  const [row] = await db
    .select({ storageKey: schema.socialMedia.storageKey })
    .from(schema.socialMedia)
    .where(eq(schema.socialMedia.id, id));
  if (row) await deleteObject(row.storageKey).catch(() => {});
}

// ── Signed public media URLs ─────────────────────────────────────────────────
// Networks like Threads, Instagram and TikTok fetch images/video by URL (they can't take an upload). We mint an
// HMAC-signed app URL — `/api/social/media/public/<id>?exp&sig` — and that route answers with a presigned MinIO GET on
// the public media host (1 h, ADR-0003). The signature prevents enumeration/hotlinking.
//
// The default lifetime is 6 h, not SP's 1 h: TikTok and Instagram fetch ASYNCHRONOUSLY, and SP's notes record failures
// when a URL expired before the network got round to it (plan §4.6: "expiry ≥ 1 h").

const DEFAULT_TTL_SECONDS = 6 * 3600;

function mediaSecret(): string {
  const s = process.env.SOCIAL_MEDIA_URL_SECRET || process.env.BETTER_AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("BETTER_AUTH_SECRET is not set");
  return "dev-media-secret";
}

function sign(id: string, exp: number): string {
  return createHmac("sha256", mediaSecret()).update(`social-media.${id}.${exp}`).digest("hex");
}

/** A signed public URL for a media file. */
export function signedMediaUrl(id: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + Math.max(3600, ttlSeconds);
  return `${appUrl()}/api/social/media/public/${id}?exp=${exp}&sig=${sign(id, exp)}`;
}

export function verifyMediaSignature(id: string, exp: number, sig: string): boolean {
  if (!ID_RE.test(id)) return false;
  if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(id, exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
