"use server";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "./admin";
import type { JobType } from "bullmq";
import { generationQueue, enhanceQueue, exportQueue } from "./queue";
import { friendlyJobError } from "./ai/errors";

// Admin operations view: live queues (CW-MVP-192) + basic usage metrics (CW-MVP-193). Admin-only.

export type QueueCounts = { name: string; waiting: number; active: number; delayed: number; failed: number; completed: number };
export type OpsJob = {
  id: string; jobType: string; status: string; progress: number; workflow: string | null; quality: string | null;
  project: string; user: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null;
  runSeconds: number | null; waitSeconds: number | null; error: string | null; errorDetail: string | null;
};
export type OpsQueue = {
  queues: QueueCounts[];
  studio: { state: string; gpus: number; activeJobs: number; backends: { url: string; online: boolean; activeJobs: number }[] } | null;
  renders: { status: string; n: number }[];
  jobs: OpsJob[];
};

async function counts(name: string, q: { getJobCounts: (...t: JobType[]) => Promise<Record<string, number>> }): Promise<QueueCounts> {
  try {
    const c = await q.getJobCounts("waiting", "prioritized", "active", "delayed", "failed", "completed");
    return { name, waiting: (c.waiting ?? 0) + (c.prioritized ?? 0), active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0, completed: c.completed ?? 0 };
  } catch {
    return { name, waiting: -1, active: -1, delayed: -1, failed: -1, completed: -1 }; // Redis unreachable
  }
}

/** CW-MVP-192: queue depths, AISERVER GPUs, render queue, and the latest 60 AI jobs. */
export async function getOpsQueue(): Promise<OpsQueue> {
  await requireAdmin();
  const [queues, studio, renders, jobs] = await Promise.all([
    Promise.all([counts("Generation", generationQueue()), counts("Enhance", enhanceQueue()), counts("Export", exportQueue())]),
    (async () => {
      try {
        const { aiProvider } = await import("./ai/comfyui-provider");
        const h = await Promise.race([aiProvider.healthCheck(), new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 5000))]);
        return { state: h.status, gpus: h.gpuCount, activeJobs: h.activeJobs, backends: h.backends ?? [] };
      } catch {
        return null;
      }
    })(),
    db.select({ status: schema.renders.status, n: sql<number>`count(*)::int` }).from(schema.renders)
      .where(sql`${schema.renders.status} in ('queued','rendering') or ${schema.renders.createdAt} > now() - interval '24 hours'`)
      .groupBy(schema.renders.status),
    db.select({
      id: schema.generationJobs.id, jobType: schema.generationJobs.jobType, status: schema.generationJobs.status,
      progress: schema.generationJobs.progress, workflow: schema.generationJobs.workflowName, request: schema.generationJobs.requestJson,
      project: schema.projects.title, user: schema.user.email, createdAt: schema.generationJobs.createdAt,
      startedAt: schema.generationJobs.startedAt, completedAt: schema.generationJobs.completedAt, failedAt: schema.generationJobs.failedAt,
      error: schema.generationJobs.errorMessage,
    })
      .from(schema.generationJobs)
      .innerJoin(schema.projects, eq(schema.generationJobs.projectId, schema.projects.id))
      .leftJoin(schema.user, eq(schema.generationJobs.requestedBy, schema.user.id))
      .orderBy(desc(schema.generationJobs.createdAt))
      .limit(60),
  ]);
  const secs = (a: Date | null, b: Date | null) => (a && b ? Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000)) : null);
  return {
    queues,
    studio,
    renders,
    jobs: jobs.map((j) => {
      const end = j.completedAt ?? j.failedAt;
      return {
        id: j.id, jobType: j.jobType, status: j.status, progress: j.progress, workflow: j.workflow,
        quality: typeof (j.request as Record<string, unknown> | null)?.quality === "string" ? String((j.request as Record<string, unknown>).quality) : null,
        project: j.project, user: j.user, createdAt: j.createdAt.toISOString(),
        startedAt: j.startedAt?.toISOString() ?? null, finishedAt: end?.toISOString() ?? null,
        runSeconds: secs(j.startedAt, end), waitSeconds: secs(j.createdAt, j.startedAt),
        error: friendlyJobError(j.error), errorDetail: j.error,
      };
    }),
  };
}

export type UsageMetrics = {
  days: number;
  totals: { label: string; value: string; hint?: string }[];
  daily: { day: string; generations: number; enhancements: number; exports: number; renders: number; failed: number; activeUsers: number }[];
  byType: { type: string; total: number; completed: number; failed: number; avgRunSec: number | null }[];
};

/** CW-MVP-193: usage over the last `days` days (7 or 30). */
export async function getUsageMetrics(days = 30): Promise<UsageMetrics> {
  await requireAdmin();
  const d = days === 7 ? 7 : 30;
  const since = sql`now() - make_interval(days => ${d})`;
  const [byType, daily, renderAgg, users, exportsN] = await Promise.all([
    db.select({
      type: schema.generationJobs.jobType,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${schema.generationJobs.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${schema.generationJobs.status} = 'failed')::int`,
      avgRun: sql<number | null>`avg(extract(epoch from ${schema.generationJobs.completedAt} - ${schema.generationJobs.startedAt}))`,
    }).from(schema.generationJobs).where(sql`${schema.generationJobs.createdAt} > ${since}`).groupBy(schema.generationJobs.jobType),
    db.execute(sql`
      with days as (select generate_series(date_trunc('day', now()) - make_interval(days => ${d - 1}), date_trunc('day', now()), interval '1 day')::date as day)
      select to_char(days.day, 'YYYY-MM-DD') as day,
        (select count(*) from generation_jobs g where g.created_at::date = days.day and g.job_type <> 'enhancement')::int as generations,
        (select count(*) from generation_jobs g where g.created_at::date = days.day and g.job_type = 'enhancement')::int as enhancements,
        (select count(*) from export_jobs e where e.created_at::date = days.day)::int as exports,
        (select count(*) from renders r where r.created_at::date = days.day)::int as renders,
        (select count(*) from generation_jobs g where g.created_at::date = days.day and g.status = 'failed')::int as failed,
        (select count(distinct u) from (
           select g.requested_by as u from generation_jobs g where g.created_at::date = days.day
           union select p.owner_id from renders r join projects p on p.id = r.project_id where r.created_at::date = days.day) x)::int as active_users
      from days order by days.day desc`),
    db.select({
      n: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${schema.renders.status} = 'done')::int`,
      cpu: sql<number>`coalesce(sum(${schema.renders.cpuSeconds}), 0)::int`,
    }).from(schema.renders).where(sql`${schema.renders.createdAt} > ${since}`),
    db.execute(sql`select count(*)::int as signups from "user" where created_at > now() - make_interval(days => ${d})`),
    db.execute(sql`select count(*)::int as n from export_jobs where created_at > now() - make_interval(days => ${d})`),
  ]);
  const rows = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Record<string, unknown>[];
  const gen = byType.filter((t) => t.type !== "enhancement");
  const genTotal = gen.reduce((a, t) => a + t.total, 0);
  const genDone = gen.reduce((a, t) => a + t.completed, 0);
  const genFailed = gen.reduce((a, t) => a + t.failed, 0);
  const enh = byType.find((t) => t.type === "enhancement");
  const r = renderAgg[0] ?? { n: 0, done: 0, cpu: 0 };
  const dailyRows = rows(daily).map((x) => ({
    day: String(x.day), generations: Number(x.generations), enhancements: Number(x.enhancements), exports: Number(x.exports),
    renders: Number(x.renders), failed: Number(x.failed), activeUsers: Number(x.active_users),
  }));
  const activeDays = dailyRows.filter((x) => x.activeUsers > 0).length;
  return {
    days: d,
    totals: [
      { label: "AI generations", value: String(genTotal), hint: genTotal ? `${Math.round((genDone / genTotal) * 100)}% succeeded · ${genFailed} failed` : undefined },
      { label: "Enhancements", value: String(enh?.total ?? 0), hint: enh?.total ? `${enh.completed} done · ${enh.failed} failed` : undefined },
      { label: "Exports", value: String(Number(rows(exportsN)[0]?.n ?? 0)) },
      { label: "Music-video renders", value: String(r.n), hint: r.n ? `${r.done} done · ${Math.round(r.cpu / 60)} CPU-min` : undefined },
      { label: "New sign-ups", value: String(Number(rows(users)[0]?.signups ?? 0)) },
      { label: "Days with activity", value: `${activeDays}/${d}` },
    ],
    daily: dailyRows,
    byType: byType.map((t) => ({ type: t.type, total: t.total, completed: t.completed, failed: t.failed, avgRunSec: t.avgRun == null ? null : Math.round(Number(t.avgRun)) })),
  };
}
