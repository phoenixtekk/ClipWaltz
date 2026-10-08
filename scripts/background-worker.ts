// Background worker (pm2 "clipwaltz-bg-worker" on linuxg1). Two jobs the web app no longer does itself, so the site
// can run as several copies:
//   1. Cloud storage uploads — the app only queues cloud_saves rows (render-ready / "Save to…"); uploads run here.
//   2. Render queue watch — emails ADMIN_EMAILS when the oldest queued render has waited > QUEUE_ALERT_MIN minutes
//      (default 5) or no render worker is online while renders wait; at most every 30 min, plus an "all clear".
// Run: node --env-file=.env.local node_modules/.bin/tsx scripts/background-worker.ts
process.env.CLOUD_WORKER = "1";

import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { pollQueued, recoverInterrupted } from "../src/lib/cloud/saves";
import { sendEmail, simpleEmail } from "../src/lib/email";

const POLL_MS = 5000;
const WATCH_MS = 60_000;
const ALERT_AFTER_MIN = Math.max(1, Number(process.env.QUEUE_ALERT_MIN ?? 5));
const REPEAT_MS = 30 * 60_000;
const ADMINS = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.clipwaltz.com";

const alerted: Record<"slow" | "offline", number> = { slow: 0, offline: 0 }; // last alert time (0 = not alerting)

async function notify(subject: string, body: string) {
  console.log(`[queue-watch] ${subject} — ${body}`);
  for (const to of ADMINS) {
    await sendEmail({ to, subject, html: simpleEmail(subject, body, { label: "Open admin", url: `${BASE}/admin` }) })
      .catch((e) => console.error("[queue-watch] email failed:", (e as Error).message));
  }
}

async function watchQueue() {
  const [q] = await db.execute<{ queued: number; oldest_min: number | null; running: number; capacity: number; workers: number }>(sql`
    select (select count(*)::int from renders where status = 'queued') as queued,
      (select extract(epoch from now() - min(created_at)) / 60 from renders where status = 'queued')::float as oldest_min,
      (select count(*)::int from renders where status = 'rendering') as running,
      (select coalesce(sum(concurrency), 0)::int from render_workers where last_seen_at > now() - interval '2 minutes') as capacity,
      (select count(*)::int from render_workers where last_seen_at > now() - interval '2 minutes') as workers`);
  const now = Date.now();
  const wait = q.oldest_min ?? 0;
  const offline = q.queued > 0 && q.capacity === 0 && wait >= 3;
  const slow = !offline && q.queued > 0 && wait > ALERT_AFTER_MIN;
  const state = `${q.queued} queued, ${q.running} rendering, ${q.workers} worker(s) online (${q.capacity} renders at once)`;

  for (const [key, on, subject, body] of [
    ["offline", offline, "ClipWaltz: no render workers online", `Renders are waiting but no render worker has checked in for 2 minutes. Oldest wait ${Math.round(wait)} min. ${state}.`],
    ["slow", slow, `ClipWaltz: render queue wait is ${Math.round(wait)} min`, `The oldest queued render has waited ${Math.round(wait)} minutes (alert threshold ${ALERT_AFTER_MIN}). ${state}. Consider adding render capacity.`],
  ] as const) {
    if (on && now - alerted[key] > REPEAT_MS) {
      await notify(subject, body);
      alerted[key] = now;
    } else if (!on && alerted[key]) {
      await notify(`ClipWaltz: render queue back to normal`, `Cleared: ${key === "offline" ? "render workers are back online" : `queue wait under ${ALERT_AFTER_MIN} min`}. ${state}.`);
      alerted[key] = 0;
    }
  }
}

async function main() {
  const recovered = await recoverInterrupted();
  console.log(`[bg-worker] started — uploads + render queue watch (alert after ${ALERT_AFTER_MIN} min, ${ADMINS.length} admin email(s))${recovered ? `; re-queued ${recovered} interrupted upload(s)` : ""}`);
  setInterval(() => watchQueue().catch((e) => console.error("[queue-watch] error:", (e as Error).message)), WATCH_MS);
  for (;;) {
    try {
      await pollQueued();
    } catch (e) {
      console.error("[cloud-worker] poll error:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error("[bg-worker] fatal:", e);
  process.exit(1);
});
