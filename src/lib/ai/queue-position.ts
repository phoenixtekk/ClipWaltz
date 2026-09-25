import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * CW-MVP-101: 1-based place in the GPU queue for a still-queued job (same queue = generation vs
 * enhancement), counting higher-priority jobs first then older jobs at the same priority. null once
 * the job has started or finished.
 */
export async function queuePositionOf(job: { id: string; status: string; jobType: string; priority: number; createdAt: Date }): Promise<number | null> {
  if (job.status !== "queued") return null;
  // enhancement + montage (storyboard) share the enhance queue; generations have their own.
  const sameQueue = job.jobType === "enhancement" || job.jobType === "montage"
    ? sql`${schema.generationJobs.jobType} in ('enhancement', 'montage')`
    : sql`${schema.generationJobs.jobType} not in ('enhancement', 'montage')`;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.generationJobs).where(and(
    eq(schema.generationJobs.status, "queued"), sameQueue,
    sql`(${schema.generationJobs.priority} > ${job.priority} or (${schema.generationJobs.priority} = ${job.priority} and ${schema.generationJobs.createdAt} < ${job.createdAt}))`,
  ));
  return n + 1;
}
