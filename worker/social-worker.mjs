#!/usr/bin/env node
// ClipWaltz Social Publishing worker (ADR-0011, plan §4.5). Runs on linuxg1 next to Redis + Postgres as the pm2
// process `clipwaltz-social-worker`. Replaces Social Publishing's crontab → POST /api/cron/run sweep.
//
//   node --env-file=.env.local --import tsx worker/social-worker.mjs              # run the worker
//   node --env-file=.env.local --import tsx worker/social-worker.mjs --sweep-once # one sweep, print it, exit
//   … --sweep-once --inline   # same, but publish due destinations in-process instead of enqueuing (no Redis needed)
//   … --metrics-once          # one metrics pull, print it, exit
//
// `--import tsx` is required: the job logic is the app's own TypeScript (src/lib/social/**, src/lib/queue.ts), loaded
// directly rather than duplicated here, so the worker and the web app can never disagree about how a post publishes.
// tsx resolves the `@/` path alias from tsconfig.json — start it from the repo root.
//
// Jobs on SOCIAL_QUEUE (name derived from GENERATION_QUEUE in src/lib/queue.ts, so dev never touches prod's queue):
//   publish-target { targetId }  one destination; idempotent — the row is claimed pending → publishing first
//   sweep                        repeatable every 60 s: due scheduled posts, Auto Post slots, retries, token refresh
//   metrics-pull                 repeatable hourly: engagement numbers for recently published destinations
//   comments-pull { targetId }   on demand: comments for one published destination
//
// Env: DATABASE_URL, REDIS_URL (default redis://127.0.0.1:6379), S3_* (MinIO), TOKEN_ENC_KEY (decrypts channel
// credentials — must match the web app's), BETTER_AUTH_SECRET + NEXT_PUBLIC_APP_URL (signed media URLs),
// SOCIAL_WORKER_CONCURRENCY (default 4), and the per-network client ids/secrets (see env.example).
import { Worker } from "bullmq";

const args = new Set(process.argv.slice(2));
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const jobs = await import("../src/lib/social/jobs.ts");

function log(...a) {
  console.log(new Date().toISOString(), "[social]", ...a);
}

// ── One-shot modes (runbooks, tests) ─────────────────────────────────────────
if (args.has("--sweep-once") || args.has("--metrics-once")) {
  let out;
  if (args.has("--sweep-once")) {
    const inline = args.has("--inline")
      ? async (targetId) => {
          const r = await jobs.publishTargetJob(targetId);
          log(`inline publish-target ${targetId}:`, JSON.stringify(r));
        }
      : undefined;
    out = await jobs.runSweep({ enqueue: inline });
  } else {
    out = await jobs.metricsPull();
  }
  console.log(JSON.stringify(out));
  // Close the lazily-opened clients so the process exits.
  const { redisIfOpen } = await import("../src/lib/queue.ts");
  await redisIfOpen()?.quit().catch(() => {});
  process.exit(0);
}

// ── The worker ───────────────────────────────────────────────────────────────
const { SOCIAL_QUEUE, redis, socialQueue } = await import("../src/lib/queue.ts");
const concurrency = Math.max(1, Number(process.env.SOCIAL_WORKER_CONCURRENCY || 4));

// The repeatable jobs. upsert is idempotent, so every worker start (and every extra worker) re-asserts the same two
// schedules rather than adding more.
const q = socialQueue();
await q.upsertJobScheduler("social-sweep", { every: 60_000 }, { name: "sweep", data: {}, opts: { removeOnComplete: 100, removeOnFail: 500 } });
await q.upsertJobScheduler("social-metrics", { every: 3_600_000 }, { name: "metrics-pull", data: {}, opts: { removeOnComplete: 50, removeOnFail: 200 } });

// A sweep that outlasts its minute must not run twice at once in this process (the database claims make concurrent
// sweeps across processes safe, but there is no point doing the work twice).
let sweeping = false;

const worker = new Worker(
  SOCIAL_QUEUE,
  async (job) => {
    switch (job.name) {
      case "publish-target": {
        const r = await jobs.publishTargetJob(String(job.data?.targetId ?? ""));
        if (r.claimed) log(`publish-target ${job.data.targetId} → ${r.status}${r.error ? ` (${String(r.error).slice(0, 160)})` : ""}`);
        return r;
      }
      case "sweep": {
        if (sweeping) return { skipped: "previous sweep still running" };
        sweeping = true;
        try {
          const s = await jobs.runSweep();
          const busy = Object.entries(s).some(([k, v]) => k !== "errors" && Number(v) > 0) || s.errors.length > 0;
          if (busy) log("sweep", JSON.stringify(s));
          return s;
        } finally {
          sweeping = false;
        }
      }
      case "metrics-pull": {
        const m = await jobs.metricsPull();
        log("metrics-pull", JSON.stringify(m));
        return m;
      }
      case "comments-pull":
        return jobs.commentsPull(String(job.data?.targetId ?? ""));
      default:
        throw new Error(`unknown social job "${job.name}"`);
    }
  },
  { connection: redis(), concurrency },
);

worker.on("failed", (job, err) => log(`job ${job?.name} ${job?.id} failed:`, err?.message));
worker.on("error", (err) => log("worker error:", err?.message));
log(`listening on ${SOCIAL_QUEUE} (concurrency ${concurrency})`);

async function shutdown(sig) {
  log(`${sig} — closing`);
  await worker.close().catch(() => {});
  await q.close().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
