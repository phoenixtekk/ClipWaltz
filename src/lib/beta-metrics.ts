import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

// Beta metrics (DESIGN_BUILD_PLAN §3): cost, funnel and reliability over a window, derived from
// renders / generation_jobs / export_jobs / "user" and the analytics_events stream
// (src/lib/analytics.ts). Admin-only callers (/admin/ops).

export type Metric = { label: string; value: string; hint?: string };
export type BetaMetrics = {
  days: number;
  cost: Metric[];
  funnel: Metric[];
  reliability: Metric[];
  topRenderErrors: { error: string; n: number }[];
  eventsSince: string | null; // first analytics event (instrumentation start)
};

type Row = Record<string, unknown>;
const rows = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Row[];
const num = (v: unknown) => (v == null ? null : Number(v));
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const gb = (bytes: number | null) => (bytes == null ? "—" : `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 2)} GB`);
const dur = (s: number | null) => (s == null ? "—" : s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(1)} h`);

export async function getBetaMetrics(days: number): Promise<BetaMetrics> {
  const d = Math.max(1, Math.min(365, Math.round(days)));
  const since = sql`now() - make_interval(days => ${d})`;
  const [renders, ai, events, draft, storage, gbDays, signups, conv, paidNow, errors, first] = await Promise.all([
    db.execute(sql`select
        count(*) filter (where status = 'done')::int done,
        count(*) filter (where status = 'failed')::int failed,
        count(*) filter (where status = 'done' and shared_at is not null)::int shared,
        percentile_cont(0.5) within group (order by cpu_seconds) filter (where status = 'done') med_secs,
        coalesce(sum(cpu_seconds), 0) total_secs,
        percentile_cont(0.5) within group (order by extract(epoch from started_at - created_at)) filter (where started_at is not null) med_wait
      from renders where created_at > ${since}`),
    db.execute(sql`select
        count(*) filter (where status = 'completed')::int done,
        count(*) filter (where status = 'failed')::int failed,
        coalesce(sum(extract(epoch from completed_at - started_at)) filter (where status = 'completed'), 0) gpu_secs,
        percentile_cont(0.5) within group (order by extract(epoch from completed_at - started_at)) filter (where status = 'completed' and job_type in ('text_to_video','image_to_video')) med_gen
      from generation_jobs where created_at > ${since}`),
    db.execute(sql`select name, count(*)::int n, coalesce(sum((props->>'bytes')::bigint), 0) bytes
      from analytics_events where created_at > ${since} group by name`),
    db.execute(sql`select
        percentile_cont(0.5) within group (order by (props->>'secondsSinceProjectCreated')::float) med_created,
        percentile_cont(0.5) within group (order by (props->>'secondsSinceFirstUpload')::float) med_upload
      from analytics_events where name = 'draft_preview_shown' and created_at > ${since}`),
    db.execute(sql`select props from analytics_events where name = 'storage_snapshot' order by created_at desc limit 1`),
    db.execute(sql`select coalesce(sum((props->>'bytes_total')::bigint), 0) byte_days, count(*)::int n
      from analytics_events where name = 'storage_snapshot' and created_at > ${since}`),
    db.execute(sql`select count(*)::int n from "user" where created_at > ${since}`),
    // Of the users who signed up in the window, how many moved from free to a paid plan.
    db.execute(sql`select count(distinct e.user_id)::int n from analytics_events e join "user" u on u.id = e.user_id
      where e.name = 'plan_changed' and e.props->>'from' = 'free' and e.props->>'to' in ('plus','pro')
        and u.created_at > ${since}`),
    db.execute(sql`select count(*)::int n from "user" where plan in ('plus','pro')`),
    db.execute(sql`select coalesce(error_message, '(no reason recorded)') error, count(*)::int n from renders
      where status = 'failed' and created_at > ${since} group by 1 order by 2 desc limit 5`),
    db.execute(sql`select min(created_at) at from analytics_events`),
  ]);

  const r = rows(renders)[0] ?? {};
  const g = rows(ai)[0] ?? {};
  const ev = new Map(rows(events).map((e) => [String(e.name), { n: Number(e.n), bytes: Number(e.bytes) }]));
  const n = (name: string) => ev.get(name)?.n ?? 0;
  const dr = rows(draft)[0] ?? {};
  const snap = (rows(storage)[0]?.props ?? null) as Record<string, number> | null;
  const gd = rows(gbDays)[0] ?? {};
  const rDone = Number(r.done ?? 0), rFailed = Number(r.failed ?? 0);
  const gDone = Number(g.done ?? 0), gFailed = Number(g.failed ?? 0);
  const egress = (ev.get("render_downloaded")?.bytes ?? 0) + (ev.get("export_downloaded")?.bytes ?? 0);
  const snapBreakdown = snap
    ? Object.entries(snap).filter(([k]) => k.startsWith("bytes_") && k !== "bytes_total")
      .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k.slice(6)} ${gb(v)}`).join(" · ")
    : undefined;
  const upStarted = n("upload_started"), upDone = n("upload_completed");

  return {
    days: d,
    cost: [
      { label: "Render time (median)", value: dur(num(r.med_secs)), hint: `worker wall-clock per finished render · ${rDone} done` },
      { label: "Render worker time", value: dur(Number(r.total_secs ?? 0)), hint: "all renders incl. failed" },
      { label: "AI GPU time", value: dur(Number(g.gpu_secs ?? 0)), hint: `${gDone} finished AI jobs · median clip ${dur(num(g.med_gen))}` },
      { label: "Storage now", value: gb(snap?.bytes_total ?? null), hint: snapBreakdown },
      { label: "Storage GB-days", value: gd.n ? `${(Number(gd.byte_days) / 1e9).toFixed(1)}` : "—", hint: `${Number(gd.n ?? 0)} daily snapshots` },
      { label: "Download egress", value: gb(egress), hint: `${n("render_downloaded")} render + ${n("export_downloaded")} export downloads` },
    ],
    funnel: [
      { label: "Upload success", value: pct(upDone, upStarted), hint: `${upDone}/${upStarted} · ${n("upload_failed")} failures · ${n("upload_resumed")} resumes` },
      { label: "Time to first draft", value: dur(num(dr.med_upload)), hint: `median from first upload · ${dur(num(dr.med_created))} from project creation` },
      { label: "Renders requested", value: String(n("render_requested")) },
      { label: "Share rate", value: pct(Number(r.shared ?? 0), rDone), hint: "finished renders shared to the feed/link" },
      { label: "Download rate", value: pct(n("render_downloaded"), rDone), hint: "render downloads per finished render" },
      { label: "Free → paid", value: pct(Number(rows(conv)[0]?.n ?? 0), Number(rows(signups)[0]?.n ?? 0)),
        hint: `${Number(rows(conv)[0]?.n ?? 0)} of ${Number(rows(signups)[0]?.n ?? 0)} new sign-ups · ${Number(rows(paidNow)[0]?.n ?? 0)} paid accounts now` },
    ],
    reliability: [
      { label: "Render failure rate", value: pct(rFailed, rDone + rFailed), hint: `${rFailed} failed` },
      { label: "AI job failure rate", value: pct(gFailed, gDone + gFailed), hint: `${gFailed} failed` },
      { label: "Render queue wait (median)", value: dur(num(r.med_wait)) },
    ],
    topRenderErrors: rows(errors).map((e) => ({ error: String(e.error), n: Number(e.n) })),
    eventsSince: rows(first)[0]?.at ? new Date(String(rows(first)[0].at)).toISOString() : null,
  };
}
