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
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function setStatus(id, fields) {
  await sql`update generation_jobs set ${sql(fields)}, updated_at = now() where id = ${id}`;
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
  if (j.status === "cancelled") { console.log("[gen] skip cancelled", genJobId); return; }

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
      seed: req.seed ?? null,
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
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let out = null;
  while (Date.now() < deadline) {
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
  const outputKey = `generations/${j.project_id}/${genJobId}/${versionNumber}.mp4`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: outputKey, Body: videoBytes, ContentType: "video/mp4" }));

  const versionId = randomUUID();
  await sql`insert into generation_versions ${sql({
    id: versionId,
    generation_job_id: genJobId,
    project_id: j.project_id,
    scene_id: j.scene_id ?? null,
    version_number: versionNumber,
    output_key: outputKey,
    settings: req,
  })}`;
  await setStatus(genJobId, { status: "completed", progress: 100, completed_at: new Date() });
  console.log(`[gen] ${genJobId} done → ${outputKey} (v${versionNumber}, ${videoBytes.length} bytes)`);
}

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const worker = new Worker(
  GENERATION_QUEUE,
  async (job) => { await processJob(job.data.generationJobId); },
  { connection, concurrency: 1, lockDuration: 5 * 60 * 1000 }, // single GPU node → serialize
);

worker.on("failed", async (job, err) => {
  const id = job?.data?.generationJobId;
  console.error(`[gen] FAILED ${id}: ${err?.message}`);
  if (id) {
    try {
      await setStatus(id, { status: "failed", error_message: String(err?.message ?? err).slice(0, 1000), failed_at: new Date() });
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

async function processExport(exportJobId) {
  const [ej] = await sql`select * from export_jobs where id = ${exportJobId}`;
  if (!ej) { console.warn("[exp] job gone", exportJobId); return; }
  const [ver] = await sql`select output_key from generation_versions where id = ${ej.source_version_id}`;
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
    if (vf) args.push("-vf", vf);
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
async function processEnhance(genJobId) {
  const [j] = await sql`select * from generation_jobs where id = ${genJobId}`;
  if (!j) { console.warn("[enh] job gone", genJobId); return; }
  if (j.status === "cancelled") return;
  const req = j.request_json ?? {};
  if (!req.sourceKey) throw new Error("no sourceKey on enhancement job");
  await setStatus(genJobId, { status: "enhancing", progress: 40, started_at: new Date() });

  const dir = mkdtempSync(join(tmpdir(), "cw-enh-"));
  const srcPath = join(dir, "src.mp4");
  const outPath = join(dir, "out.mp4");
  try {
    writeFileSync(srcPath, await getBytes(req.sourceKey));
    const filters = [];
    if (req.interpolate) filters.push("minterpolate=fps=48:mi_mode=mci:mc_mode=aobmc:vsbmc=1");
    if (req.upscale) filters.push("scale=iw*2:ih*2:flags=lanczos", "unsharp=5:5:0.8:5:5:0.0");
    const args = ["-y", "-i", srcPath];
    if (filters.length) args.push("-vf", filters.join(","));
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "18", "-movflags", "+faststart", "-an", outPath);
    await run("ffmpeg", args, { maxBuffer: 1 << 26 });

    const [{ maxv }] = await sql`select coalesce(max(version_number),0)::int maxv from generation_versions where project_id = ${j.project_id}`;
    const versionNumber = (maxv ?? 0) + 1;
    const outKey = `generations/${j.project_id}/${genJobId}/${versionNumber}.mp4`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: outKey, Body: readFileSync(outPath), ContentType: "video/mp4" }));
    await sql`insert into generation_versions ${sql({
      id: randomUUID(), generation_job_id: genJobId, project_id: j.project_id, scene_id: j.scene_id ?? null,
      version_number: versionNumber, output_key: outKey,
      settings: { enhancedFrom: req.sourceVersionId, interpolate: !!req.interpolate, upscale: !!req.upscale },
    })}`;
    await setStatus(genJobId, { status: "completed", progress: 100, completed_at: new Date() });
    console.log(`[enh] ${genJobId} done → ${outKey} (interp=${!!req.interpolate} upscale=${!!req.upscale})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const enhanceWorker = new Worker(
  ENHANCE_QUEUE,
  async (job) => { await processEnhance(job.data.generationJobId); },
  { connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null }), concurrency: 1, lockDuration: 10 * 60 * 1000 },
);
enhanceWorker.on("failed", async (job, err) => {
  const id = job?.data?.generationJobId;
  console.error(`[enh] FAILED ${id}: ${err?.message}`);
  if (id) {
    try {
      await setStatus(id, { status: "failed", error_message: String(err?.message ?? err).slice(0, 1000), failed_at: new Date() });
    } catch (e) { console.error("[enh] status write failed", e); }
  }
});
console.log(`[enh] ClipWaltz enhance worker up (queue=${ENHANCE_QUEUE})`);
