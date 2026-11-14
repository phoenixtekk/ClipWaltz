import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { fetchPostMetrics } from "@/lib/social/analytics";
import { fetchComments } from "@/lib/social/comments";
import { getConnectionById, type Connection } from "@/lib/social/connections";
import { publishTargetJob } from "@/lib/social/publish-post";
import { runSweep } from "@/lib/social/scheduler";

// The job handlers worker/social-worker.mjs runs (queue: SOCIAL_QUEUE in src/lib/queue.ts). Everything here is
// background work with no session: each handler names the workspace through the post it touches.
//
// This module and everything it imports must stay free of next/headers, the auth session and `server-only` — the
// worker loads it with plain Node (via tsx), not inside Next.

export { publishTargetJob, runSweep };

/** Providers whose post metrics SP could read (src/lib/social/analytics.ts). */
const METRIC_PROVIDERS = ["facebook", "instagram", "threads", "bluesky"];
const COMMENT_PROVIDERS = ["facebook", "instagram", "threads", "bluesky"];

async function connectionFor(target: { postId: string; connectionId: string | null }): Promise<Connection | null> {
  if (!target.connectionId) return null;
  const [post] = await db
    .select({ workspaceId: schema.socialPosts.workspaceId })
    .from(schema.socialPosts)
    .where(eq(schema.socialPosts.id, target.postId));
  return post ? getConnectionById(target.connectionId, post.workspaceId) : null;
}

/**
 * The hourly `metrics-pull`: refresh engagement numbers for destinations published in the last 30 days whose cache is
 * older than an hour. Bounded per run so a large backlog cannot hold the worker for long. Never throws.
 */
export async function metricsPull(opts: { now?: Date; limit?: number } = {}): Promise<{ checked: number; updated: number }> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const stale = new Date(now.getTime() - 3600 * 1000);
  const rows = await db
    .select({
      id: schema.socialPostTargets.id,
      postId: schema.socialPostTargets.postId,
      provider: schema.socialPostTargets.provider,
      connectionId: schema.socialPostTargets.connectionId,
      externalId: schema.socialPostTargets.externalId,
    })
    .from(schema.socialPostTargets)
    .where(
      and(
        eq(schema.socialPostTargets.status, "published"),
        inArray(schema.socialPostTargets.provider, METRIC_PROVIDERS),
        isNotNull(schema.socialPostTargets.externalId),
        gte(schema.socialPostTargets.createdAt, since),
        or(isNull(schema.socialPostTargets.metricsAt), lte(schema.socialPostTargets.metricsAt, stale)),
      ),
    )
    .limit(opts.limit ?? 200);

  let updated = 0;
  for (const t of rows) {
    try {
      const conn = await connectionFor(t);
      const m = await fetchPostMetrics(t.provider, t.externalId!, conn);
      await db
        .update(schema.socialPostTargets)
        .set({ metrics: m, metricsAt: now })
        .where(eq(schema.socialPostTargets.id, t.id));
      updated++;
    } catch {
      /* one network failing never stops the rest */
    }
  }
  return { checked: rows.length, updated };
}

/** `comments-pull` (on demand): fetch the comments on one published destination into its cache. */
export async function commentsPull(targetId: string): Promise<{ ok: boolean; count: number }> {
  const [t] = await db.select().from(schema.socialPostTargets).where(eq(schema.socialPostTargets.id, targetId));
  if (!t || t.status !== "published" || !t.externalId || !COMMENT_PROVIDERS.includes(t.provider)) return { ok: false, count: 0 };
  const conn = await connectionFor(t);
  const items = await fetchComments(t.provider, t.externalId, conn);
  await db
    .update(schema.socialPostTargets)
    .set({ comments: items, commentsAt: new Date() })
    .where(eq(schema.socialPostTargets.id, targetId));
  return { ok: true, count: items.length };
}
