import "server-only";
import { randomUUID } from "crypto";
import { and, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";

// Beta instrumentation (DESIGN_BUILD_PLAN §3): append-only product events in `analytics_events`.
// Metrics are derived in src/lib/ops-admin-actions.ts (getBetaMetrics) for /admin/ops.
//
// Server-side events:  render_requested · render_downloaded · export_downloaded · plan_changed ·
//                      storage_snapshot
// Client-sent events (allow-listed in analytics-actions.ts): upload_started · upload_completed ·
//                      upload_failed · upload_resumed · draft_preview_shown

export type EventProps = Record<string, string | number | boolean | null>;

/** Record one event. Never throws — instrumentation must not break the action it measures. */
export async function track(
  name: string,
  opts: { userId?: string | null; projectId?: string | null; props?: EventProps } = {},
): Promise<void> {
  try {
    await db.insert(schema.analyticsEvents).values({
      id: randomUUID(),
      name,
      userId: opts.userId ?? null,
      projectId: opts.projectId ?? null,
      props: opts.props ?? null,
    });
  } catch (e) {
    console.error(`[analytics] ${name} not recorded:`, (e as Error).message);
  }
}

/**
 * One event per download (egress metrics): skip ranged continuations (byte offset > 0) so a
 * streamed/resumed download counts once. Size comes from a HEAD on the object.
 */
export async function trackDownload(
  req: Request,
  name: "render_downloaded" | "export_downloaded",
  opts: { userId: string; projectId: string; key: string; id: string },
): Promise<void> {
  const range = req.headers.get("range");
  const m = range ? /bytes=(\d+)-/.exec(range) : null;
  if (m && Number(m[1]) > 0) return;
  const { headObject } = await import("./storage");
  const bytes = await headObject(opts.key).then((h) => h.size, () => null);
  await track(name, { userId: opts.userId, projectId: opts.projectId, props: { id: opts.id, bytes } });
}

/** Daily storage snapshot (GB-days = Σ daily bytes). At most one per UTC day; returns true if written. */
export async function snapshotStorageDaily(): Promise<boolean> {
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const [done] = await db.select({ id: schema.analyticsEvents.id }).from(schema.analyticsEvents)
    .where(and(eq(schema.analyticsEvents.name, "storage_snapshot"), gte(schema.analyticsEvents.createdAt, day))).limit(1);
  if (done) return false;
  const { bucketUsage } = await import("./storage");
  const usage = await bucketUsage();
  const props: EventProps = {};
  let total = 0;
  for (const [prefix, u] of Object.entries(usage)) { props[`bytes_${prefix}`] = u.bytes; props[`objects_${prefix}`] = u.objects; total += u.bytes; }
  props.bytes_total = total;
  await track("storage_snapshot", { props });
  return true;
}
