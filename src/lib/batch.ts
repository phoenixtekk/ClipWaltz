import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export type BatchSummary = {
  id: string;
  name: string;
  inboxPath: string;
  outputPath: string;
  donePath: string;
  grouping: string;
  scheduleMinutes: number;
  status: string;
  lastRunAt: string | null;
  createdAt: string;
  counts: { queued: number; rendering: number; done: number; failed: number };
};

export type BatchItemRow = {
  id: string;
  sourceName: string;
  status: string;
  outputFile: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

/** All auto-batches for an owner, newest first, with per-status item counts. */
export async function listBatches(ownerId: string): Promise<BatchSummary[]> {
  const jobs = await db
    .select()
    .from(schema.batchJobs)
    .where(eq(schema.batchJobs.ownerId, ownerId))
    .orderBy(desc(schema.batchJobs.createdAt));
  if (jobs.length === 0) return [];

  const counts = await db
    .select({
      batchId: schema.batchItems.batchId,
      status: schema.batchItems.status,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.batchItems)
    .groupBy(schema.batchItems.batchId, schema.batchItems.status);
  const byBatch = new Map<string, { queued: number; rendering: number; done: number; failed: number }>();
  for (const c of counts) {
    const cur = byBatch.get(c.batchId) ?? { queued: 0, rendering: 0, done: 0, failed: 0 };
    if (c.status in cur) (cur as Record<string, number>)[c.status] = c.n;
    byBatch.set(c.batchId, cur);
  }

  return jobs.map((j) => ({
    id: j.id,
    name: j.name,
    inboxPath: j.inboxPath,
    outputPath: j.outputPath,
    donePath: j.donePath,
    grouping: j.grouping,
    scheduleMinutes: j.scheduleMinutes,
    status: j.status,
    lastRunAt: j.lastRunAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    counts: byBatch.get(j.id) ?? { queued: 0, rendering: 0, done: 0, failed: 0 },
  }));
}

/** Recent items for a batch (for the detail/log view). */
export async function listBatchItems(batchId: string, limit = 50): Promise<BatchItemRow[]> {
  const rows = await db
    .select()
    .from(schema.batchItems)
    .where(eq(schema.batchItems.batchId, batchId))
    .orderBy(desc(schema.batchItems.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    sourceName: r.sourceName,
    status: r.status,
    outputFile: r.outputFile,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  }));
}
