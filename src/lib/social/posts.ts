import { randomUUID } from "crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { listDestinations } from "@/lib/social/destinations";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, writeMedia } from "@/lib/social/media";
import { parseTargetKeys } from "@/lib/social/publish-post";
import { approvalOnSave, decide, logReview, notifyApprovers } from "@/lib/social/approval";

// Creating posts and media for a workspace. The P1 API surface (src/app/api/social/posts, …/media) uses these; the
// composer in P2 calls the same functions from server actions. Every function takes the workspace explicitly and
// checks ownership of whatever it is handed — media ids and destination keys arrive from a request.

export interface CreatePostInput {
  text: string;
  link?: string | null;
  /** Destination keys (`provider#connectionId`) — must be connections of this workspace. */
  providers: string[];
  perNetwork?: Record<string, { text?: string; mediaIds?: string[]; link?: string }>;
  mediaIds?: string[];
  scheduledAt?: Date | null;
  /** draft | queued | scheduled. `scheduled` needs scheduledAt. */
  status?: "draft" | "queued" | "scheduled";
  /** D9: hold for an approver. */
  requireApproval?: boolean;
  /** G9: the author is sending it out (publish / schedule / queue) — in an approval workspace that submits it. Defaults
   *  to `status !== "draft"`. */
  submitForApproval?: boolean;
  renderId?: string | null;
  exportId?: string | null;
}

export class PostInputError extends Error {}

/**
 * Per-network overrides arrive from a request. The only media they may name is a thumbnail (`meta.thumbnailMediaId`),
 * which publishing loads and uploads to the network — so it must be THIS workspace's media. Called on create and update.
 */
export async function assertPerNetworkMediaOwned(workspaceId: string, perNetwork: unknown): Promise<void> {
  if (perNetwork == null) return;
  if (typeof perNetwork !== "object" || Array.isArray(perNetwork)) throw new PostInputError("Invalid per-network settings.");
  const ids = new Set<string>();
  for (const v of Object.values(perNetwork as Record<string, unknown>)) {
    const meta = v && typeof v === "object" ? (v as { meta?: unknown }).meta : undefined;
    if (!meta || typeof meta !== "object") continue;
    const t = (meta as { thumbnailMediaId?: unknown }).thumbnailMediaId;
    if (t === undefined) continue;
    if (typeof t !== "string" || !/^[a-f0-9-]{36}$/i.test(t)) throw new PostInputError("Invalid thumbnail.");
    ids.add(t);
  }
  if (ids.size === 0) return;
  const owned = await db
    .select({ id: schema.socialMedia.id })
    .from(schema.socialMedia)
    .where(and(eq(schema.socialMedia.workspaceId, workspaceId), inArray(schema.socialMedia.id, [...ids])));
  if (owned.length !== ids.size) throw new PostInputError("The thumbnail is not media of this workspace.");
}

export async function createPost(workspaceId: string, createdBy: string, input: CreatePostInput): Promise<string> {
  const text = (input.text ?? "").trim();
  if (!text) throw new PostInputError("A post needs text.");
  if (text.length > 100_000) throw new PostInputError("That post is too long.");

  // Only this workspace's destinations; anything else is dropped here (and would be refused at publish anyway).
  const mine = new Set((await listDestinations(workspaceId)).map((d) => d.key));
  const providers = [...new Set(input.providers.map((k) => k.trim()).filter(Boolean))];
  const foreign = providers.filter((k) => !mine.has(k));
  if (foreign.length) throw new PostInputError(`Not a channel of this workspace: ${foreign.join(", ")}`);
  if (providers.length === 0) throw new PostInputError("Choose at least one channel.");

  let status = input.status ?? "draft";
  if (status === "scheduled" && !input.scheduledAt) throw new PostInputError("A scheduled post needs a time.");
  if (input.scheduledAt && status === "draft") status = "scheduled";

  const link = input.link?.trim() || null;
  if (link && !/^https?:\/\//i.test(link)) throw new PostInputError("The link must start with http:// or https://.");

  await assertPerNetworkMediaOwned(workspaceId, input.perNetwork);

  const mediaIds = [...new Set(input.mediaIds ?? [])];
  if (mediaIds.length) {
    const owned = await db
      .select({ id: schema.socialMedia.id })
      .from(schema.socialMedia)
      .where(and(eq(schema.socialMedia.workspaceId, workspaceId), inArray(schema.socialMedia.id, mediaIds), isNull(schema.socialMedia.postId)));
    if (owned.length !== mediaIds.length) throw new PostInputError("Some media is missing or already attached to another post.");
  }

  // G9: the server decides the approval state (a client flag cannot skip a workspace's approval rule).
  const approval = await approvalOnSave({
    workspaceId,
    userId: createdBy,
    submitting: input.submitForApproval ?? status !== "draft",
    askApproval: input.requireApproval === true,
  });

  const id = randomUUID();
  await db.insert(schema.socialPosts).values({
    id,
    workspaceId,
    createdBy,
    text,
    link,
    status,
    providers: providers.join(","),
    perNetwork: input.perNetwork ?? null,
    scheduledAt: input.scheduledAt ?? null,
    approvalStatus: approval.status,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedBy ? new Date() : null,
    renderId: input.renderId ?? null,
    exportId: input.exportId ?? null,
  });
  if (mediaIds.length) {
    await db
      .update(schema.socialMedia)
      .set({ postId: id })
      .where(and(eq(schema.socialMedia.workspaceId, workspaceId), inArray(schema.socialMedia.id, mediaIds)));
  }
  if (approval.status === "pending") {
    await logReview({ postId: id, workspaceId, decision: "submitted", reviewerUserId: createdBy });
    await notifyApprovers(workspaceId, id, text, createdBy);
  }
  return id;
}

/** Store an uploaded file as workspace media (not yet attached to a post). */
export async function createMedia(
  workspaceId: string,
  createdBy: string,
  file: { name: string; type: string; bytes: Uint8Array },
): Promise<{ id: string; kind: "image" | "video" }> {
  const kind = ALLOWED_MIME[file.type];
  if (!kind) throw new PostInputError("That file type is not supported (images: jpeg/png/gif/webp; video: mp4/mov/webm).");
  if (file.bytes.byteLength === 0) throw new PostInputError("The file is empty.");
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) throw new PostInputError("The file is larger than 200 MB.");
  const id = randomUUID();
  const storageKey = await writeMedia(workspaceId, id, file.bytes, file.type);
  await db.insert(schema.socialMedia).values({
    id,
    workspaceId,
    createdBy,
    kind,
    filename: file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || `${kind}`,
    mime: file.type,
    size: file.bytes.byteLength,
    storageKey,
    source: "upload",
  });
  return { id, kind };
}

/** A workspace's post with its destinations (no credentials), or null. */
export async function getPost(workspaceId: string, postId: string) {
  const post = await db.query.socialPosts.findFirst({
    where: and(eq(schema.socialPosts.id, postId), eq(schema.socialPosts.workspaceId, workspaceId)),
  });
  if (!post) return null;
  const targets = await db.select().from(schema.socialPostTargets).where(eq(schema.socialPostTargets.postId, postId));
  return { ...post, destinations: parseTargetKeys(post.providers), targets };
}

export async function listPosts(workspaceId: string, limit = 50) {
  return db
    .select()
    .from(schema.socialPosts)
    .where(eq(schema.socialPosts.workspaceId, workspaceId))
    .orderBy(desc(schema.socialPosts.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}

/** D9/G9: an approver approves or requests changes on a post that is awaiting approval. */
export async function decideApproval(
  workspaceId: string,
  postId: string,
  approverId: string,
  decision: "approved" | "rejected",
  note?: string | null,
): Promise<boolean> {
  return decide({
    workspaceId,
    postId,
    reviewerUserId: approverId,
    decision: decision === "approved" ? "approved" : "changes_requested",
    note,
  });
}
