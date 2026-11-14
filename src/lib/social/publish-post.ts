import { randomUUID } from "crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { publishToTargets } from "@/lib/social/publishing";
import { readMedia } from "@/lib/social/media";
import { emailCapExceeded } from "@/lib/social/email-cap";
import { parseKey, resolveTarget } from "@/lib/social/destinations";
import { setConnectionPaused, updateConnectionById } from "@/lib/social/connections";
import { isTransientPublishError, nextRetryAt, refreshPostStatus, BACKOFF_MIN } from "@/lib/social/retry-targets";
import type { MediaInput, PublishResult, PublishTarget } from "@/lib/social/publishing/types";
import { composePin, domainOf } from "@/lib/social/publishing/pin-image";

// Publishing a stored post. Ported from SP `src/lib/publish-post.ts`.
//
// What changed in the port, and why:
//
//  • SP published every destination INLINE, in the request (or the cron sweep), then deleted and re-inserted the
//    post's `post_target` rows with the results. A process that died in between left a post "publishing" forever
//    (that is what SP's `reapStuckPublishing` was for). ClipWaltz splits it: `publishPost` writes one PENDING target
//    row per destination and enqueues one `publish-target` job per row; the social worker runs `publishTargetJob`,
//    which claims its row (pending → publishing) before touching the network. A duplicate job, a double-clicked
//    Publish, or two overlapping sweeps therefore publish each destination once (plan §4.5, R3).
//  • Per-workspace scoping: every destination key resolves against the POST's workspace (`resolveTarget`).
//  • Auto AI Image / Video / GIF and the per-network render queue are P3 (the generation queue on the ComfyUI box,
//    D1). Until then a post that asks for one publishes without it and says so in its warnings — the same honesty SP
//    adopted after a dead GPU went unnoticed for a day (2026-08-31).
//  • Approval (D9): a post whose `approvalStatus` is `pending` or `rejected` is never published.

type PostRow = typeof schema.socialPosts.$inferSelect;

/** Parse the stored CSV of destination keys (provider or provider#connId). */
export function parseTargetKeys(csv: string): string[] {
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

type Overrides = Record<string, { text?: string; mediaIds?: string[]; link?: string; meta?: Record<string, unknown> }>;

/** Resolve ONE destination key of a post to a publish target (with per-network text/media/link/meta overrides). */
export async function resolvePostTarget(post: PostRow, key: string, media: MediaInput[]) {
  // The POST's workspace, not the caller: a scheduled publish has no session.
  const t = await resolveTarget(key, post.workspaceId);
  const ov = ((post.perNetwork ?? {}) as Overrides)[key];
  const text = ov?.text && ov.text.trim() ? ov.text : undefined;
  const mediaIds = ov?.mediaIds;

  // Provider extras (explainer metadata, a custom thumbnail). The post stores a thumbnail as a MEDIA ID — a post row
  // is not the place for image bytes — so it is loaded here, at the point the adapter needs it.
  let meta = ov?.meta;
  if (meta && typeof meta.thumbnailMediaId === "string") {
    const { thumbnailMediaId, ...rest } = meta;
    try {
      meta = { ...rest, thumbnail: await readMedia(thumbnailMediaId, post.workspaceId) };
    } catch {
      // A missing thumbnail must not sink the upload: the video is the post, the picture is a nicety, and YouTube
      // will use its own frame.
      meta = rest;
    }
  }

  return {
    ...t,
    text,
    link: ov?.link,
    media: mediaIds ? media.filter((m) => mediaIds.includes(m.id)) : undefined,
    ...(meta !== undefined ? { meta } : {}),
  };
}

/** Resolve a post's destination keys to publish targets, dropping parked/unowned ones. */
export async function resolvePostTargets(post: PostRow, media: MediaInput[]): Promise<PublishTarget[]> {
  const resolved = await Promise.all(parseTargetKeys(post.providers).map((key) => resolvePostTarget(post, key, media)));
  // Drop parked destinations here rather than letting them fail: a stored destination list (an Auto Post rule, a
  // scheduled post) still names them.
  return resolved.filter((t) => !t.paused);
}

/** Load a post's stored media attachments (bytes read from MinIO). */
export async function loadPostMedia(postId: string): Promise<MediaInput[]> {
  const rows = await db.select().from(schema.socialMedia).where(eq(schema.socialMedia.postId, postId));
  const out: MediaInput[] = [];
  for (const m of rows) {
    try {
      const data = await readMedia(m.id, m.workspaceId);
      out.push({ id: m.id, kind: m.kind === "video" ? "video" : "image", mime: m.mime, filename: m.filename, data });
    } catch {
      /* object missing — skip rather than fail the post */
    }
  }
  return out;
}

/**
 * Errors that will not fix themselves on a retry — the destination is misconfigured, not merely unavailable. A bot
 * that was never added to a channel rejects every post forever, so continuing to send there just loses content.
 */
export function isPermanentDestinationError(error: string | undefined | null): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return (
    e.includes("not a member of the channel") ||
    e.includes("chat not found") ||
    e.includes("bot was kicked") ||
    e.includes("not enough rights") ||
    e.includes("chat_write_forbidden") ||
    e.includes("unauthorized")
  );
}

/** Append non-fatal notes to a post (kept on the row, so a scheduled publish's notes are still visible tomorrow). */
export async function addPostWarnings(postId: string, warnings: string[]) {
  if (!warnings.length) return;
  await db
    .update(schema.socialPosts)
    .set({
      warnings: sql`coalesce(${schema.socialPosts.warnings}, '[]'::jsonb) || ${JSON.stringify(warnings)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(schema.socialPosts.id, postId));
}

/** Statuses from which a post may (re)enter publishing. */
const PUBLISHABLE_FROM = ["draft", "queued", "scheduled", "failed", "rendering"];

export interface PublishPostResult {
  ok: boolean;
  status: string;
  queued?: number;
  targetIds?: string[];
  warnings?: string[];
  error?: string;
}

/**
 * Publish a stored post: one pending target row per destination, one `publish-target` job per row. Never throws.
 *
 * Idempotent on the post: the status flip to `publishing` is a conditional UPDATE, so a second call while the first
 * is in flight (a double-click, the scheduler racing a manual publish) claims nothing and creates no targets.
 */
export async function publishPost(
  postId: string,
  opts: { enqueue?: (targetId: string, attempt: number) => Promise<void> } = {},
): Promise<PublishPostResult> {
  const post = await db.query.socialPosts.findFirst({ where: eq(schema.socialPosts.id, postId) });
  if (!post) return { ok: false, status: "failed", error: "not found" };
  if (post.approvalStatus === "pending" || post.approvalStatus === "rejected") {
    return { ok: false, status: post.status, error: `This post is ${post.approvalStatus === "pending" ? "awaiting approval" : "rejected"}.` };
  }

  const media = await loadPostMedia(postId);
  const keys = parseTargetKeys(post.providers);
  const resolved = await Promise.all(keys.map((key) => resolvePostTarget(post, key, media)));
  const targets = resolved.filter((t) => !t.paused);
  const warnings: string[] = [];

  const skipped = resolved.filter((t) => t.paused);
  if (skipped.length) {
    warnings.push(
      `${skipped.map((t) => t.label).join(", ")} ${skipped.length === 1 ? "was" : "were"} skipped — paused, disconnected, or not a channel of this workspace.`,
    );
  }

  // P3 will route these through the generation queue (ComfyUI box, D1). Say so rather than silently dropping them.
  if ((post.autoImage || post.autoVideo || post.autoGif) && media.length === 0) {
    const what = post.autoVideo ? "Auto AI Video" : post.autoGif ? "Auto AI GIF" : "Auto AI Image";
    warnings.push(`${what} is not available yet in ClipWaltz — the post was published without generated media.`);
  }

  // The claim. Only one caller gets the row into `publishing`.
  const claimed = await db
    .update(schema.socialPosts)
    .set({ status: "publishing", warnings: null, updatedAt: new Date() })
    .where(and(eq(schema.socialPosts.id, postId), inArray(schema.socialPosts.status, PUBLISHABLE_FROM)))
    .returning({ id: schema.socialPosts.id });
  if (claimed.length === 0) {
    return { ok: false, status: post.status, error: "This post is already publishing or published." };
  }

  if (targets.length === 0) {
    warnings.push("There were no connected destinations to publish to.");
    await db
      .update(schema.socialPosts)
      .set({ status: "failed", warnings, updatedAt: new Date() })
      .where(eq(schema.socialPosts.id, postId));
    return { ok: false, status: "failed", warnings, error: "No connected destinations." };
  }

  // Fresh results for this run: drop any rows from an earlier failed attempt (SP did the same in commitPublish).
  await db.delete(schema.socialPostTargets).where(eq(schema.socialPostTargets.postId, postId));
  const rows = targets.map((t) => ({
    id: randomUUID(),
    postId,
    provider: t.provider,
    connectionId: t.connectionId,
    label: t.label,
    status: "pending",
  }));
  await db.insert(schema.socialPostTargets).values(rows);
  if (warnings.length) await addPostWarnings(postId, warnings);

  const enqueue =
    opts.enqueue ?? (async (id: string, attempt: number) => (await import("@/lib/queue")).enqueueSocialPublishTarget(id, attempt));
  for (const r of rows) {
    // A failed enqueue (Redis down) leaves the row pending; the sweep re-enqueues stale pending rows.
    await enqueue(r.id, 0).catch((e) => console.error(`[social] enqueue ${r.id} failed:`, (e as Error).message));
  }
  return { ok: true, status: "publishing", queued: rows.length, targetIds: rows.map((r) => r.id), warnings };
}

export interface PublishTargetResult {
  claimed: boolean;
  status?: string;
  error?: string;
}

/**
 * The `publish-target` job: publish ONE destination row. Idempotent — the row is claimed `pending → publishing` first,
 * and anything not pending (already published, failed, in flight in another worker) is left alone.
 */
export async function publishTargetJob(targetId: string): Promise<PublishTargetResult> {
  const [row] = await db
    .update(schema.socialPostTargets)
    .set({ status: "publishing", updatedAt: new Date() })
    .where(and(eq(schema.socialPostTargets.id, targetId), eq(schema.socialPostTargets.status, "pending")))
    .returning();
  if (!row) return { claimed: false };

  const post = await db.query.socialPosts.findFirst({ where: eq(schema.socialPosts.id, row.postId) });
  if (!post) {
    await db.delete(schema.socialPostTargets).where(eq(schema.socialPostTargets.id, targetId));
    return { claimed: true, status: "gone" };
  }

  const key = row.connectionId ? `${row.provider}#${row.connectionId}` : row.provider;
  // The destination may be stored on the post under a bare legacy key; find the override entry either way.
  const storedKey = parseTargetKeys(post.providers).find((k) => {
    const p = parseKey(k);
    return p.provider === row.provider && p.connId === (row.connectionId ?? row.provider);
  }) ?? key;

  const media = await loadPostMedia(post.id);
  let target = await resolvePostTarget(post, storedKey, media);
  const warnings: string[] = [];

  if (target.paused) {
    // Paused or disconnected since the post was queued: record it, never publish it.
    await db
      .update(schema.socialPostTargets)
      .set({ status: "failed", error: "This destination was paused or disconnected before it was published.", updatedAt: new Date() })
      .where(eq(schema.socialPostTargets.id, targetId));
    await refreshPostStatus(post.id);
    return { claimed: true, status: "failed" };
  }

  // Email goes out through ClipWaltz's own SES account: refuse once this workspace has used its daily send cap.
  if (target.provider === "email") {
    const capped = await emailCapExceeded(post.workspaceId);
    if (capped) {
      await db
        .update(schema.socialPostTargets)
        .set({ status: "failed", error: capped, retryAt: null, updatedAt: new Date() })
        .where(eq(schema.socialPostTargets.id, targetId));
      await refreshPostStatus(post.id);
      return { claimed: true, status: "failed", error: capped };
    }
  }

  // Pinterest gets the image reshaped into a Pin.
  //
  // It is the only destination where the image's SHAPE decides whether the post works: Pinterest's own guidance is
  // 2:3, and "fully vertical images get more engagement". Done here, at the last moment, so it applies however the
  // image arrived. Null means "nothing to do" — a failed reshape must never cost the destination.
  if (target.provider === "pinterest") {
    const pool = target.media ?? media;
    const source = pool.find((m) => m.kind === "image");
    if (source) {
      const pin = await composePin(source.data, { domain: domainOf(target.link ?? post.link) }).catch(() => null);
      if (pin) {
        target = { ...target, media: [{ id: source.id, kind: "image" as const, mime: "image/jpeg", filename: "pin.jpg", data: pin }] };
      }
    }
  }

  const [r] = await publishToTargets({ text: post.text, link: post.link ?? undefined, media, targets: [target] }).catch(
    (e): PublishResult[] => [
      { provider: row.provider as PublishTarget["provider"], ok: false, error: e instanceof Error ? e.message : "Publishing failed." },
    ],
  );

  if (r?.updatedAccessToken && row.connectionId) {
    await updateConnectionById(row.connectionId, { accessToken: r.updatedAccessToken }, post.workspaceId).catch(() => {});
  }

  const now = new Date();
  if (r?.ok || r?.manual) {
    await db
      .update(schema.socialPostTargets)
      .set({
        // A hand-off is not a failure: it is a destination with no API, waiting on a person. Recording it as `failed`
        // would retry it forever, pause the connection, and read as a fault in the post history.
        status: r.ok ? "published" : "handoff",
        externalId: r.postId ?? null,
        url: r.manual ? r.manualUrl ?? null : r.url ?? null,
        error: r.error ?? null,
        retryAt: null,
        updatedAt: now,
      })
      .where(eq(schema.socialPostTargets.id, targetId));
    if (r.manual) {
      warnings.push(
        `${r.label ?? "Facebook Group"} is waiting for you — Meta removed the Groups API, so the post is prepared and ready to paste in the Post by hand queue.`,
      );
    }
  } else {
    const error = r?.error ?? "Publishing failed.";
    // A destination that failed for a passing reason — a stalled upload, a reset connection — gets a later attempt
    // rather than being abandoned. The network outages seen on SP lasted minutes, which no in-request retry outlasts.
    const again = isTransientPublishError(error) ? nextRetryAt(row.attempts, now) : null;
    const permanent = !again && isPermanentDestinationError(error) && row.connectionId;
    await db
      .update(schema.socialPostTargets)
      .set({
        status: "failed",
        error: again
          ? `${error} — retrying automatically in ${BACKOFF_MIN[row.attempts]} minutes.`
          : permanent
            ? `${error} — this destination was paused automatically; resume it on the Networks page once it is fixed.`
            : `${error}${row.attempts > 0 ? " — automatic retries exhausted." : ""}`,
        retryAt: again,
        updatedAt: now,
      })
      .where(eq(schema.socialPostTargets.id, targetId));

    // Park a destination that failed for a reason retrying cannot cure. It keeps its connection and history, but stops
    // swallowing posts until the operator fixes it and resumes — the alternative is losing every future post to it.
    if (permanent && row.connectionId) {
      await setConnectionPaused(row.connectionId, true, post.workspaceId).catch(() => {});
      warnings.push(
        `${row.label ?? row.provider} was paused automatically: ${error} Nothing will publish there until you fix it and resume it on the Networks page.`,
      );
    }
  }

  if (warnings.length) await addPostWarnings(post.id, warnings);
  await refreshPostStatus(post.id);
  return { claimed: true, status: r?.ok ? "published" : r?.manual ? "handoff" : "failed", error: r?.error };
}

/** Destinations of a post that have not finished (used by the composer/status UI in P2). */
export async function unfinishedTargets(postId: string) {
  return db
    .select({ id: schema.socialPostTargets.id, status: schema.socialPostTargets.status })
    .from(schema.socialPostTargets)
    .where(
      and(
        eq(schema.socialPostTargets.postId, postId),
        notInArray(schema.socialPostTargets.status, ["published", "handoff", "failed"]),
      ),
    );
}
