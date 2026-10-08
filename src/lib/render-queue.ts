import { sql } from "drizzle-orm";
import { db } from "@/db";

// Where a render stands in the shared render queue, for the Render panel ("#3 in line · about 6 min").
// Order matches the worker's claim: priority desc (pro 20, plus 10, free 0), then created_at.
// Capacity = renders the live workers can run at once (render_workers seen in the last 2 minutes).

export type QueueInfo = {
  state: "queued" | "rendering";
  position: number | null; // 1 = next to start (queued only)
  capacity: number; // renders at once across live workers (0 = no worker online)
  avgSec: number; // typical render time (recent finished renders)
  etaStartSec: number | null; // queued: until it starts
  etaDoneSec: number | null; // until it's finished
  priority: number; // 0 free, 10 plus, 20 pro
  paidAhead: number; // queued renders ahead only because they're on a paid plan (upgrade hint)
};

export async function getQueueInfo(renderId: string): Promise<QueueInfo | null> {
  const rows = await db.execute<{
    status: string; priority: number; ahead: number; paid_ahead: number; running: number; capacity: number;
    avg_sec: number | null; elapsed: number | null;
  }>(sql`
    with r as (select id, status, priority, created_at, started_at from renders where id = ${renderId})
    select r.status, r.priority,
      (select count(*)::int from renders q where q.status = 'queued' and q.id <> r.id
         and (q.priority > r.priority or (q.priority = r.priority and (q.created_at < r.created_at or (q.created_at = r.created_at and q.id < r.id))))) as ahead,
      (select count(*)::int from renders q where q.status = 'queued' and q.id <> r.id
         and q.priority > r.priority and q.created_at > r.created_at) as paid_ahead,
      (select count(*)::int from renders where status = 'rendering') as running,
      (select coalesce(sum(concurrency), 0)::int from render_workers where last_seen_at > now() - interval '2 minutes') as capacity,
      (select avg(cpu_seconds)::float from (select cpu_seconds from renders where status = 'done' and cpu_seconds is not null
         order by completed_at desc nulls last limit 50) t) as avg_sec,
      extract(epoch from now() - r.started_at)::float as elapsed
    from r`);
  const x = rows[0];
  if (!x || (x.status !== "queued" && x.status !== "rendering")) return null;
  const avg = Math.max(30, Math.round(x.avg_sec ?? 240));
  const cap = x.capacity;
  if (x.status === "rendering") {
    const left = Math.max(15, avg - Math.round(x.elapsed ?? 0));
    return { state: "rendering", position: null, capacity: cap, avgSec: avg, etaStartSec: 0, etaDoneSec: left, priority: x.priority, paidAhead: 0 };
  }
  // Renders that start before this one = those running now + those ahead in line. With `cap` slots, it starts when
  // (before − cap + 1) of them have finished; running ones are on average half done.
  let etaStart: number | null = null;
  if (cap > 0) {
    const before = x.running + x.ahead;
    if (before < cap) etaStart = 0;
    else {
      const finishesNeeded = before - cap + 1;
      etaStart = Math.round((Math.ceil(finishesNeeded / cap) - 0.5) * avg);
    }
  }
  return {
    state: "queued", position: x.ahead + 1, capacity: cap, avgSec: avg, etaStartSec: etaStart,
    etaDoneSec: etaStart == null ? null : etaStart + avg, priority: x.priority, paidAhead: x.paid_ahead,
  };
}
