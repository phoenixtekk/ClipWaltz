// Explainer + Shorts render jobs on the render worker (AI box) — plan §4.5, P5 (decision D6).
//
// Why here and not on linuxg1: the work is CPU-only (canvas frames + ffmpeg x264, ElevenLabs over HTTPS, the AI Box
// for the script) and an episode is ~10 CPU-minutes of encoding. linuxg1 has 4 cores shared by ~20 production apps;
// the AI box has 32 and already runs ClipWaltz's ffmpeg renders. SP ran this inside its web process on linuxg1.
//
// The job table is `social_render_jobs` (src/db/app-schema.ts). This module only renders and stores:
//   explainer  ONE stage per claim (scripting → voicing → assembling → meta → ready), persisted between stages, so a
//              restart resumes and never re-spends ElevenLabs characters on narration that already exists.
//   short      the whole short in one pass (~90 s).
// Bytes go to MinIO under `social/<workspace>/<uuid>` with a `social_media` row; `payload` carries ids only. When a
// job reaches `done` (or `failed`), the social worker's sweep on linuxg1 finalizes the post (src/lib/social/render-jobs.ts)
// and settles the credits — this side never publishes anything.
//
// The pipeline code is the app's own TypeScript, bundled by scripts/build-social-render.mjs into ./dist/pipeline.mjs.
//
// Env (AI box .env.worker): ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID (owner's cloned voice — site-admin workspaces
// only), ELEVENLABS_DEFAULT_VOICE_ID (stock voice for everyone else), ELEVENLABS_MODEL (optional),
// EXPLAINER_OLLAMA_URL / EXPLAINER_OLLAMA_MODEL (default the AI Box + qwen3.8:27b), WORKPLACE_STORE_URL (optional).
import { randomUUID } from "node:crypto";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const MAX_ATTEMPTS = 2; // per stage: a stage that throws twice in a row fails the job (SP's MAX_ATTEMPTS)
const STAGE_PROGRESS = { scripting: 10, voicing: 30, assembling: 80, meta: 95, ready: 100 };

let pipelinePromise = null;
const pipeline = () => (pipelinePromise ??= import("./dist/pipeline.mjs"));

function voiceFor(payload) {
  return payload?.voice === "owner" ? process.env.ELEVENLABS_VOICE_ID || "" : process.env.ELEVENLABS_DEFAULT_VOICE_ID || "";
}

/** @param {{ sql: any, s3: any, BUCKET: string }} io */
function store(io, job) {
  const key = (id) => `social/${job.workspace_id}/${id}`;
  return {
    async put(buf, kind, mime, filename, { attach = true } = {}) {
      const id = randomUUID();
      await io.s3.send(new PutObjectCommand({ Bucket: io.BUCKET, Key: key(id), Body: buf, ContentType: mime }));
      await io.sql`insert into social_media (id, workspace_id, created_by, post_id, kind, filename, mime, size, storage_key, source)
        values (${id}, ${job.workspace_id}, ${job.created_by}, ${attach ? job.post_id : null}, ${kind}, ${filename}, ${mime}, ${buf.byteLength}, ${key(id)}, 'ai')`;
      return id;
    },
    async load(id) {
      const [m] = await io.sql`select storage_key from social_media where id = ${id} and workspace_id = ${job.workspace_id}`;
      if (!m) throw new Error(`media ${id} not found`);
      const out = await io.s3.send(new GetObjectCommand({ Bucket: io.BUCKET, Key: m.storage_key }));
      return Buffer.from(await out.Body.transformToByteArray());
    },
    async drop(id) {
      if (!id) return;
      const [m] = await io.sql`delete from social_media where id = ${id} and workspace_id = ${job.workspace_id} returning storage_key`;
      if (m) await io.s3.send(new DeleteObjectCommand({ Bucket: io.BUCKET, Key: m.storage_key })).catch(() => {});
    },
  };
}

async function advanceExplainer(io, job) {
  const { runStage } = await pipeline();
  const payload = job.payload;
  if (!payload?.stage) throw new Error("explainer job has no payload");
  // The destinations can change while the job renders; the meta stage writes per-network copy, so read them fresh.
  if (payload.stage === "meta" && job.post_id) {
    const [p] = await io.sql`select providers from social_posts where id = ${job.post_id}`;
    const current = [...new Set(String(p?.providers ?? "").split(",").map((k) => k.trim().split("#")[0]).filter(Boolean))];
    if (current.length) payload.providers = current;
  }

  const st = store(io, job);
  const r = await runStage(payload, (id) => st.load(id), { voiceId: voiceFor(payload) });
  const next = r.payload;
  const a = r.artifacts ?? {};

  // Narration parts are intermediate (resume only) — not attached to the post, so no destination ever receives one.
  if (a.narration) {
    const prev = next.narrationMediaIds ?? [];
    next.narrationMediaIds = [];
    for (const [i, part] of a.narration.entries()) next.narrationMediaIds.push(await st.put(part, "audio", "audio/mpeg", `narration-${i + 1}.mp3`, { attach: false }));
    for (const id of prev) await st.drop(id);
  }
  const swap = async (field, buf, kind, mime, filename) => {
    if (!buf) return;
    const old = next[field];
    next[field] = await st.put(buf, kind, mime, filename);
    if (old && old !== next[field]) await st.drop(old);
  };
  await swap("videoMediaId", a.video, "video", "video/mp4", "episode.mp4");
  await swap("compactMediaId", a.compactVideo, "video", "video/mp4", "episode-compact.mp4");
  await swap("verticalMediaId", a.verticalVideo, "video", "video/mp4", "episode-vertical.mp4");
  await swap("audioMediaId", a.audio, "audio", "audio/mpeg", "episode.mp3");
  await swap("thumbnailMediaId", a.thumbnail, "image", "image/png", "thumbnail.png");

  const finished = next.stage === "ready";
  await io.sql`update social_render_jobs set status = ${finished ? "done" : "queued"}, stage = ${next.stage},
      payload = ${io.sql.json(next)}, progress = ${STAGE_PROGRESS[next.stage] ?? 0}, attempts = 0, error = null, updated_at = now()
    where id = ${job.id}`;
  return `${payload.stage} → ${next.stage}`;
}

async function buildShortJob(io, job) {
  const { buildShort, shortCaption } = await pipeline();
  const p = job.payload ?? {};
  const built = await buildShort({
    source: p.source === "workplace" ? "workplace" : "seed",
    solutionFilter: p.solutionFilter ?? "",
    solutionCursor: p.solutionCursor ?? 0,
    seedPrompt: p.seedPrompt ?? "",
    topic: p.topic ?? "",
    voiceId: voiceFor(p),
    audience: p.audience || undefined,
    onProgress: (f) => {
      io.sql`update social_render_jobs set progress = ${Math.round(f * 95)}, updated_at = now() where id = ${job.id}`.catch(() => {});
    },
  });
  if (!built.build) throw Object.assign(new Error(built.error ?? "The short could not be built."), { permanent: true });
  const b = built.build;
  const st = store(io, job);
  const videoMediaId = await st.put(b.video, "video", "video/mp4", "short.mp4");
  const thumbnailMediaId = await st.put(b.thumbnail, "image", "image/png", "short-thumbnail.png");
  const result = {
    title: b.script.title,
    caption: shortCaption(b.script),
    tags: b.script.tags,
    durationSec: b.durationSec,
    sourceName: b.source?.name ?? null,
    sourceUrl: b.source?.url ?? null,
    nextCursor: built.nextCursor ?? null,
    warnings: b.warnings,
    videoMediaId,
    thumbnailMediaId,
  };
  await io.sql`update social_render_jobs set status = 'done', stage = 'ready', progress = 100, error = null,
      payload = ${io.sql.json({ ...p, result })}, updated_at = now() where id = ${job.id}`;
  return `short ${Math.round(b.durationSec)}s`;
}

/**
 * Claim and run one social render job. Returns true when a job was claimed (the worker loop then polls again at once).
 * @param {{ sql: any, s3: any, BUCKET: string }} io
 */
export async function socialRenderTick(io) {
  const [job] = await io.sql`
    update social_render_jobs set status = 'running', attempts = attempts + 1, started_at = coalesce(started_at, now()), updated_at = now()
    where id = (select id from social_render_jobs where status = 'queued' order by created_at asc limit 1 for update skip locked)
    returning *`;
  if (!job) return false;
  const t0 = Date.now();
  try {
    const what = job.kind === "explainer" ? await advanceExplainer(io, job) : await buildShortJob(io, job);
    console.log(`[social-render] ${job.kind} ${job.id} ${what} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    const msg = String(e?.message ?? e).slice(0, 500);
    const dead = e?.permanent || job.attempts >= MAX_ATTEMPTS;
    console.error(`[social-render] ${job.kind} ${job.id} ${dead ? "FAILED" : "will retry"}: ${msg}`);
    await io.sql`update social_render_jobs set status = ${dead ? "failed" : "queued"}, error = ${msg}, updated_at = now() where id = ${job.id}`;
  }
  return true;
}

/** Startup: this worker is the only writer of 'running' — anything still running was interrupted. Re-queue it. */
export async function reapSocialRenders(io) {
  const failed = await io.sql`update social_render_jobs set status = 'failed', error = 'interrupted repeatedly (worker restarts)', updated_at = now()
    where status = 'running' and attempts >= ${MAX_ATTEMPTS + 1} returning id`;
  const requeued = await io.sql`update social_render_jobs set status = 'queued', updated_at = now() where status = 'running' returning id`;
  if (failed.length || requeued.length) console.log(`[social-render] restart: re-queued ${requeued.length}, failed ${failed.length}`);
}

