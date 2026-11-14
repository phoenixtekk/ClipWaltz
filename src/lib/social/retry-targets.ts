import { and, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// ─── Retrying a destination that failed for a transient reason ───────────────
//
// Networks stall. Measured on this install, Telegram occasionally stops
// accepting uploads for minutes at a time while the same path is healthy either
// side of it — four in-request attempts across two minutes were not enough, and
// no in-request retry can be, because the request would have to hang that long.
//
// So a transient failure books a later attempt instead of giving up. Backoff is
// deliberately wide: the outage lasts minutes, so the retries must span far more
// than that. Permanent failures are never retried — a bot that is not a channel
// admin will fail identically forever, and those are handled by auto-pausing the
// destination instead.

/** Minutes after the failure to try again. One entry per attempt. */
const BACKOFF_MIN = [2, 10, 30, 120];

/**
 * Is this failure worth another attempt?
 *
 * Deliberately a whitelist. Anything unrecognised is treated as permanent, so a
 * new kind of rejection cannot put a post into an endless retry loop — the
 * failure stays visible on the post instead.
 */
export function isTransientPublishError(error: string | null | undefined): boolean {
  const e = (error ?? "").toLowerCase();
  if (!e) return false;
  return (
    e.includes("did not respond in time") ||
    e.includes("connection to telegram dropped") ||
    e.includes("could not reach telegram") ||
    e.includes("network level") ||
    e.includes("fetch failed") ||
    e.includes("timed out") ||
    e.includes("econnreset") ||
    e.includes("socket hang up") ||
    e.includes("service unavailable") ||
    e.includes("bad gateway") ||
    // Telegram's own gateway gives up around 120s and answers 504. Note the
    // wording: "Gateway Timeout", which does not contain "timed out".
    e.includes("gateway timeout") ||
    e.includes("504") ||
    // Any 5xx is the network having a bad minute, not a bad post. Matched only
    // when the number follows "http"/"status", NEVER as a bare number: a bare
    // /500/ would match "Text character limit of 500 exceeded" and put a post
    // that can never succeed into a permanent retry loop.
    /\b(?:http|status)\s*50[0234]\b/.test(e) ||
    e.includes("too many requests")
  );
}

/** Schedule the next attempt, or leave it alone once the budget is spent. */
export function nextRetryAt(attempts: number, from: Date): Date | null {
  const mins = BACKOFF_MIN[attempts];
  if (mins === undefined) return null; // out of attempts — stop here
  return new Date(from.getTime() + mins * 60_000);
}

/**
 * Re-attempt every destination whose retry is due.
 *
 * ClipWaltz: the claim is the same as SP's — clearing `retry_at` on rows selected `FOR UPDATE SKIP LOCKED`, so two
 * overlapping sweeps cannot take the same row — but instead of publishing inline the claimed row goes back to
 * `pending` with its attempt counted, and a `publish-target` job is enqueued for it. The job claims the row again
 * (pending → publishing), so a retry can still never publish a destination twice. Never throws.
 */
export async function retryDueTargets(
  now = new Date(),
  enqueue?: (targetId: string, attempt: number) => Promise<void>,
): Promise<{ retried: number }> {
  const due = (await db.execute(sql`
    UPDATE social_post_targets SET retry_at = NULL, status = 'pending', attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM social_post_targets
      WHERE status = 'failed' AND retry_at IS NOT NULL AND retry_at <= ${now.toISOString()}::timestamptz
        AND migration_hold IS NULL
      ORDER BY retry_at LIMIT 25 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, post_id, attempts`)) as unknown as Array<{ id: string; post_id: string; attempts: number }>;

  const send = enqueue ?? defaultEnqueue;
  let retried = 0;
  for (const row of due) {
    try {
      await send(row.id, row.attempts);
      retried++;
    } catch (e) {
      console.error(`[social] retry enqueue ${row.id} failed:`, (e as Error).message);
    }
    await refreshPostStatus(row.post_id);
  }
  return { retried };
}

async function defaultEnqueue(id: string, attempt: number) {
  const { enqueueSocialPublishTarget } = await import("@/lib/queue");
  await enqueueSocialPublishTarget(id, attempt);
}

/**
 * Re-derive the post's status from its destinations as they now stand.
 *
 * `handoff` is a fourth kind of outcome: a destination with no API, waiting on a person. It is neither success nor
 * failure, so it neither completes a post nor condemns it — a post with one published Page and one outstanding group
 * is `handoff`, not `partial`, because nothing has gone wrong. Marking the group posted calls back here and the post
 * settles to `published`.
 *
 * ClipWaltz addition: destinations still `pending` / `publishing` (queued in the worker), or failed with a retry
 * booked, keep the post `publishing` — SP published synchronously and never had an unfinished destination here.
 */
export async function refreshPostStatus(postId: string) {
  const rows = await db
    .select({ status: schema.socialPostTargets.status, retryAt: schema.socialPostTargets.retryAt })
    .from(schema.socialPostTargets)
    .where(eq(schema.socialPostTargets.postId, postId));
  if (!rows.length) return;

  const inFlight = rows.filter(
    (r) => r.status === "pending" || r.status === "publishing" || (r.status === "failed" && r.retryAt),
  ).length;
  const ok = rows.filter((r) => r.status === "published").length;
  const waiting = rows.filter((r) => r.status === "handoff").length;
  const failed = rows.length - ok - waiting - inFlight;

  const status =
    inFlight > 0 ? "publishing"
    : failed > 0 ? (ok > 0 ? "partial" : "failed")
    : waiting > 0 ? "handoff"
    : "published";
  await db
    .update(schema.socialPosts)
    .set({
      status,
      ...(ok > 0 ? { publishedAt: sql`coalesce(${schema.socialPosts.publishedAt}, now())` } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.socialPosts.id, postId));
}

/**
 * Rescue destinations stranded mid-publish.
 *
 * A worker that dies after claiming a row (pending → publishing) and before recording the result leaves it
 * `publishing` forever. Anything in that state well past a legitimate publish (SP allowed 15 minutes for slow
 * multi-network uploads) is marked failed and NOT retried: the network may well have accepted the post before the
 * worker died, and a duplicate is worse than a visible failure the operator can retry by hand.
 *
 * Rows still `pending` after a few minutes were never picked up (Redis was down when they were enqueued, or the job
 * was lost) and are simply enqueued again — the claim in the job makes that safe.
 */
export async function reapStuckPublishing(
  now = new Date(),
  enqueue?: (targetId: string, attempt: number) => Promise<void>,
): Promise<{ reaped: number; requeued: number }> {
  const cutoff = new Date(now.getTime() - 15 * 60 * 1000);
  const stuck = await db
    .update(schema.socialPostTargets)
    .set({
      status: "failed",
      error:
        "Publishing was interrupted (the worker stopped mid-publish). Check the network before retrying — the post may already be live.",
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.socialPostTargets.status, "publishing"),
        lte(schema.socialPostTargets.updatedAt, cutoff),
        isNull(schema.socialPostTargets.migrationHold),
      ),
    )
    .returning({ postId: schema.socialPostTargets.postId });
  for (const postId of new Set(stuck.map((r) => r.postId))) await refreshPostStatus(postId);

  const staleCutoff = new Date(now.getTime() - 5 * 60 * 1000);
  const stale = await db
    .select({ id: schema.socialPostTargets.id, attempts: schema.socialPostTargets.attempts })
    .from(schema.socialPostTargets)
    .where(
      and(
        eq(schema.socialPostTargets.status, "pending"),
        lte(schema.socialPostTargets.updatedAt, staleCutoff),
        isNull(schema.socialPostTargets.migrationHold),
      ),
    )
    .limit(50);
  const send = enqueue ?? defaultEnqueue;
  let requeued = 0;
  for (const t of stale) {
    // Touch updated_at first so the next sweep does not enqueue it again a minute later.
    await db.update(schema.socialPostTargets).set({ updatedAt: now }).where(eq(schema.socialPostTargets.id, t.id));
    try {
      await send(t.id, t.attempts);
      requeued++;
    } catch {
      /* Redis still down — the next sweep tries again */
    }
  }

  // A post left `publishing` with no destinations at all (e.g. they were deleted) is settled here too.
  const posts = await db
    .select({ id: schema.socialPosts.id })
    .from(schema.socialPosts)
    .where(
      and(
        eq(schema.socialPosts.status, "publishing"),
        lte(schema.socialPosts.updatedAt, cutoff),
        isNull(schema.socialPosts.migrationHold),
      ),
    )
    .limit(50);
  for (const p of posts) {
    const n = await db
      .select({ id: schema.socialPostTargets.id })
      .from(schema.socialPostTargets)
      .where(eq(schema.socialPostTargets.postId, p.id))
      .limit(1);
    if (n.length === 0) {
      await db.update(schema.socialPosts).set({ status: "failed", updatedAt: now }).where(eq(schema.socialPosts.id, p.id));
    } else {
      await refreshPostStatus(p.id);
    }
  }
  return { reaped: stuck.length, requeued };
}

/**
 * Retry ONE failed destination now, by hand (the post's "Retry" button). Only a `failed` row can be retried, and the
 * flip back to `pending` is conditional, so a double-click enqueues once.
 */
export async function retryTargetNow(
  targetId: string,
  postId: string,
  enqueue?: (targetId: string, attempt: number) => Promise<void>,
): Promise<boolean> {
  const rows = await db
    .update(schema.socialPostTargets)
    .set({ status: "pending", retryAt: null, attempts: sql`${schema.socialPostTargets.attempts} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(schema.socialPostTargets.id, targetId),
        eq(schema.socialPostTargets.postId, postId),
        inArray(schema.socialPostTargets.status, ["failed"]),
        isNull(schema.socialPostTargets.migrationHold),
      ),
    )
    .returning({ id: schema.socialPostTargets.id, attempts: schema.socialPostTargets.attempts });
  if (!rows.length) return false;
  await (enqueue ?? defaultEnqueue)(rows[0].id, rows[0].attempts);
  await refreshPostStatus(postId);
  return true;
}

/** Exposed for the runbook: anything currently waiting on a retry. */
export async function pendingRetries() {
  return db
    .select()
    .from(schema.socialPostTargets)
    .where(and(eq(schema.socialPostTargets.status, "failed"), isNotNull(schema.socialPostTargets.retryAt)))
    .orderBy(schema.socialPostTargets.retryAt);
}

export { BACKOFF_MIN };
