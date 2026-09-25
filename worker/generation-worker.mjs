#!/usr/bin/env node
// ClipWaltz AI generation worker (ADR-0002). Runs on linuxg1 (next to Redis + Postgres).
// Consumes the BullMQ generation queue, drives a job through the AISERVER wrapper, and writes
// the result back: MinIO for the video + a generation_versions row.
//
//   node --env-file=.env.local worker/generation-worker.mjs
//
// Media path (ADR: wrapper endpoints): download source image from MinIO → POST /inputs (stage on
// AISERVER) → POST /jobs → poll /jobs/{id} → GET /outputs/{file} → PUT to MinIO. ComfyUI stays
// isolated on AISERVER; this worker owns all MinIO I/O.
//
// Env: DATABASE_URL, REDIS_URL (default localhost), S3_* (MinIO), AISERVER_API_URL, AISERVER_API_TOKEN.
import { randomUUID, randomInt } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import postgres from "postgres";
import IORedis from "ioredis";
import { Worker } from "bullmq";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

const run = promisify(execFile);
const GENERATION_QUEUE = "clipwaltz-generation";
const EXPORT_QUEUE = "clipwaltz-export";
const ENHANCE_QUEUE = "clipwaltz-enhance";
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const AISERVER_URL = (process.env.AISERVER_API_URL ?? "http://192.168.166.158:8189").replace(/\/$/, "");
const AISERVER_TOKEN = process.env.AISERVER_API_TOKEN ?? "";
const POLL_MS = 5000;
const JOB_TIMEOUT_MS = Number(process.env.GEN_JOB_TIMEOUT_MS ?? 20 * 60 * 1000);
// ComfyUI runs one prompt at a time, so a job can wait behind a long one (e.g. a 30-min restore).
// The timeout clock starts when the wrapper reports "running"; queue wait has its own cap.
const QUEUE_WAIT_MS = Number(process.env.GEN_QUEUE_WAIT_MS ?? 3 * 60 * 60 * 1000);
function providerClock(timeoutMs) {
  const submitted = Date.now();
  let runningSince = null;
  return {
    observe(status) { if (status === "running" && runningSince === null) runningSince = Date.now(); },
    expired() { return runningSince === null ? Date.now() - submitted > QUEUE_WAIT_MS : Date.now() - runningSince > timeoutMs; },
  };
}

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }
if (!AISERVER_TOKEN) { console.error("AISERVER_API_TOKEN required"); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const S3_MAX_SOCKETS = Number(process.env.S3_MAX_SOCKETS ?? 256);
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://192.168.166.169:9000",
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  requestHandler: new NodeHttpHandler({
    httpAgent: new HttpAgent({ keepAlive: true, maxSockets: S3_MAX_SOCKETS }),
    httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets: S3_MAX_SOCKETS }),
  }),
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "",
  },
});
const BUCKET = process.env.S3_BUCKET ?? "clipwaltz";
const aiHeaders = { authorization: `Bearer ${AISERVER_TOKEN}` };

// Wan 2.2 TI2V-5B runs at 24 fps and needs a latent length of (4n+1) frames. Convert the
// requested clip length in seconds to a valid frame count (clamped 1–12 s to bound VRAM/time).
const WAN_FPS = 24;
function framesForSeconds(seconds) {
  const s = Math.min(12, Math.max(1, Number(seconds) || 5));
  return 4 * Math.round((s * WAN_FPS - 1) / 4) + 1;
}

// ─── Watermark (owner decision 2026-09-25: every video, bottom-left; admin can exempt paid plans) ──
// The app decides per job (request_json.watermark / export_jobs.watermark); same logo, size and
// placement as the music-video render worker: 22% of the short side, 3% padding, 90% opacity.
const WATERMARK_PATH = process.env.WATERMARK_PATH || join(dirname(fileURLToPath(import.meta.url)), "WaterMark.png");
const wmGeometry = (w, h) => {
  const s = Math.min(w, h) || 480;
  return { wmW: Math.max(32, Math.round(s * 0.22)), pad: Math.round(s * 0.03) };
};
// Overlay chain taking [base] → [out]. The logo is generated inside the graph (movie + loop +
// regular timestamps): on ffmpeg 7.x a PNG *input* drops the logo (single frame) or drops frames
// at random (-loop 1) — verified 2026-09-25 on the render worker.
const wmChain = (base, w, h) => {
  const { wmW, pad } = wmGeometry(w, h);
  return `movie='${WATERMARK_PATH}',scale=${wmW}:-1,format=rgba,colorchannelmixer=aa=0.9,loop=loop=-1:size=1:start=0,setpts=N/30/TB[wm];` +
    `[${base}][wm]overlay=x=${pad}:y=main_h-overlay_h-${pad}:format=auto:shortest=1,format=yuv420p[out]`;
};

/** Burn the logo into an MP4 (audio copied if present). */
async function watermarkBytes(bytes) {
  if (!existsSync(WATERMARK_PATH)) throw new Error(`watermark image missing at ${WATERMARK_PATH}`);
  const meta = await probeVideo(bytes).catch(() => ({}));
  const dir = mkdtempSync(join(tmpdir(), "cw-wm-"));
  try {
    const src = join(dir, "in.mp4"), out = join(dir, "out.mp4");
    writeFileSync(src, bytes);
    await run("ffmpeg", ["-y", "-i", src,
      "-filter_complex", wmChain("0:v", meta.width, meta.height), "-map", "[out]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "copy", "-movflags", "+faststart", out], { maxBuffer: 1 << 26 });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Store a finished version's video. Watermarked jobs keep the clean master next to it
 * (<n>.clean.mp4 → clean_key) so Enhance / Assemble / Export never process or stack the logo.
 */
async function storeVersionVideo(projectId, genJobId, n, bytes, watermark) {
  const base = `generations/${projectId}/${genJobId}/${n}`;
  const put = (Key, Body) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body, ContentType: "video/mp4" }));
  if (!watermark) { await put(`${base}.mp4`, bytes); return { output_key: `${base}.mp4`, clean_key: null }; }
  await put(`${base}.clean.mp4`, bytes);
  await put(`${base}.mp4`, await watermarkBytes(bytes));
  return { output_key: `${base}.mp4`, clean_key: `${base}.clean.mp4` };
}

// Next version number + insert under a per-project advisory lock: with GEN_CONCURRENCY=2 (and the
// enhance queue in parallel) two jobs of one project could otherwise both take max+1.
async function insertVersion(projectId, row) {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${projectId}))`;
    const [{ maxv }] = await tx`select coalesce(max(version_number),0)::int maxv from generation_versions where project_id = ${projectId}`;
    const version_number = (maxv ?? 0) + 1;
    await tx`insert into generation_versions ${tx({ ...row, version_number })}`;
    return version_number;
  });
}

async function setStatus(id, fields) {
  await sql`update generation_jobs set ${sql(fields)}, updated_at = now() where id = ${id}`;
}

// BullMQ retries a job automatically (attempts: 2). Only the LAST failure marks the job "failed"
// (which shows the user a Retry button); earlier ones put it back to "queued" for the auto-retry.
// Never overwrite cancelled/retried — the user already acted on it.
async function markAttemptFailed(job, id, err) {
  const final = (job?.attemptsMade ?? 1) >= (job?.opts?.attempts ?? 1);
  const msg = String(err?.message ?? err).slice(0, 1000);
  if (final) {
    await sql`update generation_jobs set status = 'failed', error_message = ${msg}, failed_at = now(), updated_at = now()
      where id = ${id} and status not in ('cancelled', 'retried')`;
  } else {
    await sql`update generation_jobs set status = 'queued', progress = 0, error_message = ${msg}, updated_at = now()
      where id = ${id} and status not in ('cancelled', 'retried')`;
  }
}

async function getBytes(key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Buffer.from(await out.Body.transformToByteArray());
}

// Stage a source image on AISERVER via the wrapper; returns the staged filename.
async function stageImage(key) {
  const bytes = await getBytes(key);
  const ext = (key.split(".").pop() || "png").toLowerCase();
  const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), `src.${ext}`);
  const r = await fetch(`${AISERVER_URL}/inputs`, { method: "POST", headers: aiHeaders, body: fd });
  if (!r.ok) throw new Error(`stage /inputs ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).filename;
}

async function processJob(genJobId) {
  const [j] = await sql`select * from generation_jobs where id = ${genJobId}`;
  if (!j) { console.warn("[gen] job gone", genJobId); return; }
  if (j.status === "cancelled" || j.status === "retried") { console.log(`[gen] skip ${j.status}`, genJobId); return; }

  const req = j.request_json ?? {};
  const workflow = j.workflow_name ?? req.workflow;
  console.log(`[gen] ${genJobId} start (${j.job_type}, ${workflow})`);
  await setStatus(genJobId, { status: "preparing", progress: 5, started_at: new Date() });

  // Resolve + stage the source image (image-to-video).
  let sourceImage = null;
  if (j.job_type === "image_to_video" && req.sourceAssetId) {
    const [a] = await sql`select storage_key, converted_key from assets where id = ${req.sourceAssetId}`;
    if (!a) throw new Error("source asset not found");
    sourceImage = await stageImage(a.converted_key ?? a.storage_key);
    await setStatus(genJobId, { status: "uploading_to_ai_node", progress: 15 });
  }

  // Pick the seed here (not in the wrapper) and record it on the job, so Duplicate can reproduce
  // this exact version later.
  const seed = Number.isSafeInteger(req.seed) ? req.seed : randomInt(0, 2 ** 32);
  if (seed !== req.seed) await sql`update generation_jobs set request_json = ${sql.json({ ...req, seed })} where id = ${genJobId}`;

  // Submit to the wrapper.
  const body = {
    workflow,
    inputs: {
      prompt: j.prompt ?? "",
      source_image: sourceImage,
      width: req.width ?? 704,
      height: req.height ?? 480,
      duration: req.durationSec ?? 5,
      length: framesForSeconds(req.durationSec ?? 5),
      motion: req.motion ?? "balanced",
      seed,
      negative_prompt: j.negative_prompt ?? null,
      steps: req.steps ?? null, // routing rule's quality profile; null → workflow default
    },
  };
  const subRes = await fetch(`${AISERVER_URL}/jobs`, {
    method: "POST",
    headers: { ...aiHeaders, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!subRes.ok) throw new Error(`/jobs ${subRes.status}: ${(await subRes.text()).slice(0, 300)}`);
  const providerJobId = (await subRes.json()).job_id;
  await setStatus(genJobId, { status: "generating", progress: 30 });

  // Poll to completion.
  const clock = providerClock(JOB_TIMEOUT_MS);
  let out = null;
  while (!clock.expired()) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    // Honour a cancellation requested via the app.
    const [cur] = await sql`select status from generation_jobs where id = ${genJobId}`;
    if (cur?.status === "cancelled") {
      await fetch(`${AISERVER_URL}/jobs/${providerJobId}/cancel`, { method: "POST", headers: aiHeaders }).catch(() => {});
      console.log("[gen] cancelled", genJobId);
      return;
    }
    const pr = await fetch(`${AISERVER_URL}/jobs/${providerJobId}`, { headers: aiHeaders });
    if (!pr.ok) continue;
    const st = await pr.json();
    clock.observe(st.status);
    if (st.status === "completed") { out = st.outputs?.[0] ?? null; break; }
    if (st.status === "failed") throw new Error(`provider failed: ${st.error ?? "unknown"}`);
  }
  if (!out) throw new Error("generation timed out");

  // Pull the output MP4 from the wrapper and store it in MinIO.
  await setStatus(genJobId, { status: "uploading_output", progress: 85 });
  const rel = out.subfolder ? `${out.subfolder}/${out.filename}` : out.filename;
  const dl = await fetch(`${AISERVER_URL}/outputs/${rel}`, { headers: aiHeaders });
  if (!dl.ok) throw new Error(`/outputs ${dl.status}`);
  const videoBytes = Buffer.from(await dl.arrayBuffer());
  const [{ maxv }] = await sql`select coalesce(max(version_number),0)::int maxv from generation_versions where project_id = ${j.project_id}`;
  const versionNumber = (maxv ?? 0) + 1;
  const { output_key: outputKey, clean_key } = await storeVersionVideo(j.project_id, genJobId, versionNumber, videoBytes, !!req.watermark);

  const versionId = randomUUID();
  const meta = await probeVideo(videoBytes).catch(() => ({})); // CW-MVP-112 output metadata
  await insertVersion(j.project_id, {
    id: versionId,
    generation_job_id: genJobId,
    project_id: j.project_id,
    scene_id: j.scene_id ?? null,
    version_number: versionNumber,
    output_key: outputKey,
    clean_key,
    duration_sec: meta.duration ?? null,
    settings: { ...req, width: meta.width || null, height: meta.height || null, fps: meta.fps ?? null },
  });
  await setStatus(genJobId, { status: "completed", progress: 100, completed_at: new Date() });
  console.log(`[gen] ${genJobId} done → ${outputKey} (v${versionNumber}, ${videoBytes.length} bytes)`);
}

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const worker = new Worker(
  GENERATION_QUEUE,
  async (job) => { await processJob(job.data.generationJobId); },
  // One job per ComfyUI instance: the AISERVER runs one per GPU and load-balances (ADR-0008).
  { connection, concurrency: Number(process.env.GEN_CONCURRENCY ?? 2), lockDuration: 5 * 60 * 1000 },
);

worker.on("failed", async (job, err) => {
  const id = job?.data?.generationJobId;
  console.error(`[gen] FAILED ${id} (attempt ${job?.attemptsMade}/${job?.opts?.attempts ?? 1}): ${err?.message}`);
  if (id) {
    try {
      await markAttemptFailed(job, id, err);
    } catch (e) { console.error("[gen] status write failed", e); }
  }
});
worker.on("completed", (job) => console.log(`[gen] queue job ${job.id} completed`));
console.log(`[gen] ClipWaltz generation worker up (queue=${GENERATION_QUEUE}, aiserver=${AISERVER_URL})`);

// ─── Export worker: transcode a generated version to a final deliverable ─────────
// Short-clip ffmpeg on linuxg1 (ffmpeg already installed; this is not a heavy assembler render).
function scaleFilter(res) {
  if (res === "720p") return "scale=w='if(gt(iw,ih),-2,720)':h='if(gt(iw,ih),720,-2)'";
  if (res === "1080p") return "scale=w='if(gt(iw,ih),-2,1080)':h='if(gt(iw,ih),1080,-2)'";
  return null; // native
}

// Frame size after scaleFilter (short side → 720/1080, aspect kept, even width).
function scaledSize(w, h, res) {
  const t = res === "720p" ? 720 : res === "1080p" ? 1080 : 0;
  if (!t || !w || !h) return { w, h };
  return w > h ? { w: Math.round((w * t) / h / 2) * 2, h: t } : { w: t, h: Math.round((h * t) / w / 2) * 2 };
}

async function processExport(exportJobId) {
  const [ej] = await sql`select * from export_jobs where id = ${exportJobId}`;
  if (!ej) { console.warn("[exp] job gone", exportJobId); return; }
  // Always start from the clean master; the logo (if due) is added once, after scaling.
  const [ver] = await sql`select coalesce(clean_key, output_key) output_key from generation_versions where id = ${ej.source_version_id}`;
  if (!ver?.output_key) throw new Error("source version has no output");

  await sql`update export_jobs set status='processing', started_at=now() where id=${exportJobId}`;
  const fmt = ej.output_format === "webm" ? "webm" : "mp4";
  const dir = mkdtempSync(join(tmpdir(), "cw-export-"));
  const srcPath = join(dir, "src.mp4");
  const outPath = join(dir, `out.${fmt}`);
  try {
    writeFileSync(srcPath, await getBytes(ver.output_key));
    const vf = scaleFilter(ej.resolution);
    const args = ["-y", "-i", srcPath];
    if (ej.watermark) {
      if (!existsSync(WATERMARK_PATH)) throw new Error(`watermark image missing at ${WATERMARK_PATH}`);
      // Logo size follows the OUTPUT frame: probe the scaled size via the same filter.
      const meta = await probeVideo(readFileSync(srcPath)).catch(() => ({}));
      const scaled = scaledSize(meta.width, meta.height, ej.resolution);
      args.push("-filter_complex", `[0:v]${vf ?? "null"}[base];${wmChain("base", scaled.w, scaled.h)}`, "-map", "[out]");
    } else if (vf) args.push("-vf", vf);
    if (fmt === "webm") args.push("-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-an");
    else args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", "-an");
    args.push(outPath);
    await run("ffmpeg", args, { maxBuffer: 1 << 26 });

    const outKey = `exports/${ej.project_id}/${exportJobId}.${fmt}`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: outKey, Body: readFileSync(outPath),
      ContentType: fmt === "webm" ? "video/webm" : "video/mp4",
    }));
    await sql`update export_jobs set status='completed', output_key=${outKey}, completed_at=now() where id=${exportJobId}`;
    console.log(`[exp] ${exportJobId} done → ${outKey} (${fmt}, ${ej.resolution})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const exportWorker = new Worker(
  EXPORT_QUEUE,
  async (job) => { await processExport(job.data.exportJobId); },
  { connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null }), concurrency: 2 },
);
exportWorker.on("failed", async (job, err) => {
  const id = job?.data?.exportJobId;
  console.error(`[exp] FAILED ${id}: ${err?.message}`);
  if (id) {
    try {
      await sql`update export_jobs set status='failed', error_message=${String(err?.message ?? err).slice(0, 1000)} where id=${id}`;
    } catch (e) { console.error("[exp] status write failed", e); }
  }
});
console.log(`[exp] ClipWaltz export worker up (queue=${EXPORT_QUEUE})`);

// ─── Enhance worker: ffmpeg post-process a version → a new enhanced version ──────
// Motion interpolation (minterpolate → 2× fps) and/or 2× lanczos upscale + light sharpen.
// ffmpeg on linuxg1 (short clips). ML super-res/RIFE is a later upgrade behind the same action.
// ffmpeg enhancement (fast): motion interpolation and/or lanczos upscale. Returns output bytes.
// mc_mode=obmc (no aobmc/vsbmc) is much faster than full motion-comp while still smooth.
async function ffmpegEnhance(req) {
  const dir = mkdtempSync(join(tmpdir(), "cw-enh-"));
  try {
    const srcPath = join(dir, "src.mp4"), outPath = join(dir, "out.mp4");
    writeFileSync(srcPath, await getBytes(req.sourceKey));
    const filters = [];
    if (req.interpolate) filters.push("minterpolate=fps=48:mi_mode=mci:mc_mode=obmc");
    if (req.upscale) filters.push("scale=iw*2:ih*2:flags=lanczos", "unsharp=5:5:0.8:5:5:0.0");
    // "Clean" preset (CW-MVP-132): light temporal/spatial denoise + gentle sharpen.
    if (req.denoise) filters.push("hqdn3d=2:1.5:3:3", "unsharp=5:5:0.5:5:5:0.0");
    const args = ["-y", "-i", srcPath];
    if (filters.length) args.push("-vf", filters.join(","));
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "18", "-movflags", "+faststart", "-an", outPath);
    await run("ffmpeg", args, { maxBuffer: 1 << 26 });
    return readFileSync(outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Run one AISERVER enhancement workflow on the given video bytes; returns the output bytes.
// `extraInputs` are merged into the wrapper's job inputs; `timeoutMs` overrides JOB_TIMEOUT_MS.
async function runAiWorkflow(workflow, inputBytes, genJobId, { extraInputs = {}, timeoutMs = JOB_TIMEOUT_MS } = {}) {
  const fd = new FormData();
  fd.append("file", new Blob([inputBytes], { type: "video/mp4" }), "src.mp4");
  const up = await fetch(`${AISERVER_URL}/inputs`, { method: "POST", headers: aiHeaders, body: fd });
  if (!up.ok) throw new Error(`stage /inputs ${up.status}: ${(await up.text()).slice(0, 200)}`);
  const staged = (await up.json()).filename;
  const sub = await fetch(`${AISERVER_URL}/jobs`, {
    method: "POST", headers: { ...aiHeaders, "content-type": "application/json" },
    body: JSON.stringify({ workflow, inputs: { source_image: staged, ...extraInputs } }),
  });
  if (!sub.ok) throw new Error(`/jobs ${sub.status}: ${(await sub.text()).slice(0, 200)}`);
  const providerJobId = (await sub.json()).job_id;
  const clock = providerClock(timeoutMs);
  while (!clock.expired()) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const [cur] = await sql`select status from generation_jobs where id = ${genJobId}`;
    if (cur?.status === "cancelled") { await fetch(`${AISERVER_URL}/jobs/${providerJobId}/cancel`, { method: "POST", headers: aiHeaders }).catch(() => {}); throw new Error("cancelled"); }
    const pr = await fetch(`${AISERVER_URL}/jobs/${providerJobId}`, { headers: aiHeaders });
    if (!pr.ok) continue;
    const st = await pr.json();
    clock.observe(st.status);
    if (st.status === "completed") {
      const out = st.outputs?.[0];
      if (!out) throw new Error(`${workflow}: no output`);
      const rel = out.subfolder ? `${out.subfolder}/${out.filename}` : out.filename;
      const dl = await fetch(`${AISERVER_URL}/outputs/${rel}`, { headers: aiHeaders });
      if (!dl.ok) throw new Error(`/outputs ${dl.status}`);
      return Buffer.from(await dl.arrayBuffer());
    }
    if (st.status === "failed") throw new Error(`${workflow} failed: ${st.error ?? "unknown"}`);
  }
  throw new Error(`${workflow} timed out`);
}

// Width/height/frame count of a video, via ffprobe on a temp copy.
async function probeVideo(bytes) {
  const dir = mkdtempSync(join(tmpdir(), "cw-probe-"));
  try {
    const p = join(dir, "v.mp4");
    writeFileSync(p, bytes);
    const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets",
      "-show_entries", "stream=width,height,nb_read_packets,r_frame_rate:format=duration", "-of", "json", p]);
    const j = JSON.parse(stdout);
    const s = j.streams?.[0] ?? {};
    const [fn, fd] = String(s.r_frame_rate ?? "0/1").split("/").map(Number);
    return { width: Number(s.width), height: Number(s.height), frames: Number(s.nb_read_packets),
      duration: Number(j.format?.duration) || null, fps: fd ? Math.round((fn / fd) * 100) / 100 : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// SeedVR2 restore (ADR-0007): 2× the short side, capped at 1080 (multiple of 16). Batch size is
// 21 frames (4n+1) up to ~1.4 MP output, 13 above — the largest that stayed ≤8.5 GB peak on one
// 10 GB RTX 3080 in the 2026-09-24 benchmarks (1408×960 b21 = 8.8 GB; 1920×1080 b13 = 8.4 GB).
const RESTORE_MAX_FRAMES = 400; // ~8 s @ 48 fps; ~30 min worst case at 1080p
const RESTORE_TIMEOUT_MS = 60 * 60 * 1000;
function restoreParams({ width, height }) {
  const short = Math.min(width, height), long = Math.max(width, height);
  const resolution = Math.max(256, Math.floor(Math.min(1080, short * 2) / 16) * 16); // wrapper floor
  const outPixels = resolution * Math.round((long * resolution) / short);
  return { resolution, batch_size: outPixels > 1_400_000 ? 13 : 21 };
}

// AI enhancement on AISERVER: Real-ESRGAN (engine "ai") or SeedVR2 restore (engine "restore")
// for the upscale step, and/or RIFE interpolation.
// ORDER MATTERS: upscale first, then interpolate — RIFE must be LAST so its doubled frame rate
// survives to the final encode (running ESRGAN last would re-encode at its own fps and drop it).
async function aiEnhance(req, genJobId) {
  // Workflow ids resolved by the app's routing registry (ADR-0009); defaults for older jobs.
  const wf = { upscale: "esrgan-upscale-v1", interpolate: "rife-interpolate-v1", restore: "seedvr2-restore-v1", ...(req.workflows ?? {}) };
  const src = await getBytes(req.sourceKey);
  let bytes = null;
  if (req.engine === "restore") {
    const info = await probeVideo(src);
    if (!info.width || !info.height || !Number.isFinite(info.frames)) throw new Error("could not read source video dimensions / frame count");
    if (info.frames > RESTORE_MAX_FRAMES) throw new Error(`AI Restore supports clips up to ${RESTORE_MAX_FRAMES} frames (this one has ${info.frames})`);
    bytes = await runAiWorkflow(wf.restore, src, genJobId, { extraInputs: restoreParams(info), timeoutMs: RESTORE_TIMEOUT_MS });
  } else if (req.upscale) {
    bytes = await runAiWorkflow(wf.upscale, src, genJobId);
  }
  if (req.interpolate) bytes = await runAiWorkflow(wf.interpolate, bytes ?? src, genJobId);
  if (!bytes) bytes = await runAiWorkflow(wf.upscale, src, genJobId); // default: upscale
  return bytes;
}

// CW-MVP-160..162 storyboard: join each scene's picked version in order, trimmed to the scene's
// target length, normalised to the first clip's size at 24 fps. Returns the output bytes.
async function assembleMontage(req, genJobId) {
  const parts = Array.isArray(req.parts) ? req.parts : [];
  if (parts.length < 2) throw new Error("storyboard needs at least two picked scenes");
  const dir = mkdtempSync(join(tmpdir(), "cw-montage-"));
  try {
    let size = null;
    const list = [];
    for (let i = 0; i < parts.length; i++) {
      const [cur] = await sql`select status from generation_jobs where id = ${genJobId}`;
      if (cur?.status === "cancelled") throw new Error("cancelled");
      const src = join(dir, `in${i}.mp4`), out = join(dir, `n${i}.mp4`);
      writeFileSync(src, await getBytes(parts[i].key));
      if (!size) {
        const m = await probeVideo(readFileSync(src));
        size = { w: (m.width || 1280) & ~1, h: (m.height || 720) & ~1 };
      }
      const t = Number(parts[i].durationTarget) > 0 ? ["-t", String(parts[i].durationTarget)] : [];
      await run("ffmpeg", ["-y", "-i", src, ...t,
        "-vf", `scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p`,
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", out], { maxBuffer: 1 << 26 });
      list.push(`file '${out.replace(/'/g, "'\\''")}'`);
      await setStatus(genJobId, { progress: Math.min(80, 20 + Math.round((60 * (i + 1)) / parts.length)) });
    }
    const listFile = join(dir, "list.txt"), final = join(dir, "storyboard.mp4");
    writeFileSync(listFile, list.join("\n"));
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", final], { maxBuffer: 1 << 26 });
    return readFileSync(final);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function processEnhance(genJobId) {
  const [j] = await sql`select * from generation_jobs where id = ${genJobId}`;
  if (!j) { console.warn("[enh] job gone", genJobId); return; }
  if (j.status === "cancelled" || j.status === "retried") return;
  const req = j.request_json ?? {};
  if (j.job_type === "montage") return processMontage(j, req, genJobId);
  if (!req.sourceKey) throw new Error("no sourceKey on enhancement job");
  const ai = req.engine === "ai" || req.engine === "restore";
  await setStatus(genJobId, { status: ai ? "generating" : "enhancing", progress: 40, started_at: new Date() });

  const videoBytes = ai ? await aiEnhance(req, genJobId) : await ffmpegEnhance(req);

  await setStatus(genJobId, { status: "uploading_output", progress: 85 });
  const [{ maxv }] = await sql`select coalesce(max(version_number),0)::int maxv from generation_versions where project_id = ${j.project_id}`;
  const versionNumber = (maxv ?? 0) + 1;
  const { output_key: outKey, clean_key } = await storeVersionVideo(j.project_id, genJobId, versionNumber, videoBytes, !!req.watermark);
  const meta = await probeVideo(videoBytes).catch(() => ({})); // CW-MVP-112 output metadata
  await insertVersion(j.project_id, {
    id: randomUUID(), generation_job_id: genJobId, project_id: j.project_id, scene_id: j.scene_id ?? null,
    version_number: versionNumber, output_key: outKey, clean_key,
    duration_sec: meta.duration ?? null,
    settings: { enhancedFrom: req.sourceVersionId, engine: ai ? req.engine : "ffmpeg", interpolate: !!req.interpolate, upscale: !!req.upscale || req.engine === "restore",
      denoise: !!req.denoise, preset: req.preset ?? null, width: meta.width || null, height: meta.height || null, fps: meta.fps },
  });
  await setStatus(genJobId, { status: "completed", progress: 100, completed_at: new Date() });
  console.log(`[enh] ${genJobId} done → ${outKey} (engine=${ai ? req.engine : "ffmpeg"})`);
}

async function processMontage(j, req, genJobId) {
  await setStatus(genJobId, { status: "encoding", progress: 10, started_at: new Date() });
  const videoBytes = await assembleMontage(req, genJobId);
  await setStatus(genJobId, { status: "uploading_output", progress: 85 });
  const [{ maxv }] = await sql`select coalesce(max(version_number),0)::int maxv from generation_versions where project_id = ${j.project_id}`;
  const versionNumber = (maxv ?? 0) + 1;
  const { output_key: outKey, clean_key } = await storeVersionVideo(j.project_id, genJobId, versionNumber, videoBytes, !!req.watermark);
  const meta = await probeVideo(videoBytes).catch(() => ({}));
  await insertVersion(j.project_id, {
    id: randomUUID(), generation_job_id: genJobId, project_id: j.project_id, scene_id: null,
    version_number: versionNumber, output_key: outKey, clean_key, duration_sec: meta.duration ?? null,
    settings: { montage: true, scenes: (req.parts ?? []).length, width: meta.width || null, height: meta.height || null, fps: meta.fps ?? null },
  });
  await setStatus(genJobId, { status: "completed", progress: 100, completed_at: new Date() });
  console.log(`[enh] storyboard ${genJobId} done → ${outKey} (${(req.parts ?? []).length} scenes)`);
}

const enhanceWorker = new Worker(
  ENHANCE_QUEUE,
  async (job) => { await processEnhance(job.data.generationJobId); },
  { connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null }), concurrency: 1, lockDuration: 10 * 60 * 1000 },
);
enhanceWorker.on("failed", async (job, err) => {
  const id = job?.data?.generationJobId;
  console.error(`[enh] FAILED ${id} (attempt ${job?.attemptsMade}/${job?.opts?.attempts ?? 1}): ${err?.message}`);
  if (id) {
    try {
      await markAttemptFailed(job, id, err);
    } catch (e) { console.error("[enh] status write failed", e); }
  }
});
console.log(`[enh] ClipWaltz enhance worker up (queue=${ENHANCE_QUEUE})`);

// Free-plan upload retention (notice ~24 h ahead, delete after 7 days) runs in the app, which holds
// the SES creds; this worker (same host, linuxg1) just triggers it every 6 h. See src/lib/retention.ts.
const APP_INTERNAL_URL = (process.env.APP_INTERNAL_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
async function triggerRetention() {
  if (!process.env.WORKER_CALLBACK_SECRET) return;
  try {
    const r = await fetch(`${APP_INTERNAL_URL}/api/internal/retention`, {
      method: "POST", headers: { "x-worker-secret": process.env.WORKER_CALLBACK_SECRET }, signal: AbortSignal.timeout(10 * 60_000),
    });
    console.log(`[retention] ${r.status} ${(await r.text()).slice(0, 300)}`);
  } catch (e) {
    console.error("[retention] trigger failed:", e?.message ?? e);
  }
}
setTimeout(triggerRetention, 5 * 60_000);
setInterval(triggerRetention, 6 * 60 * 60_000);
