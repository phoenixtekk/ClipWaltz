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
import { join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import postgres from "postgres";
import IORedis from "ioredis";
import { Worker, Queue, UnrecoverableError } from "bullmq";
import { WATERMARK_PATH, wmChain, wmBox } from "./watermark.mjs";
import { composeRemix } from "./remix-compose.mjs";
import { runImageJob, afterImageJobFailure } from "./image/job.mjs";
import { startDeckWorker, DECK_QUEUE } from "./deck/jobs.mjs";
import { decryptSecret } from "./deck/llm.mjs";
import { chatJson, TEXT_MODEL, LANG_NAMES } from "./deck/planner.mjs";
import { videoModel, VIDEO_PROVIDERS, VIDEO_SETTINGS_KEY } from "./video/catalog.mjs";
import { submitCloud, pollCloud, cancelCloud, downloadOutput, videoErrorText } from "./video/cloud.mjs";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

const run = promisify(execFile);
// Overridable for a dev instance (must match the app's env — src/lib/queue.ts).
const GENERATION_QUEUE = process.env.GENERATION_QUEUE || "clipwaltz-generation";
const EXPORT_QUEUE = process.env.EXPORT_QUEUE || "clipwaltz-export";
const ENHANCE_QUEUE = process.env.ENHANCE_QUEUE || "clipwaltz-enhance";
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

// Watermark: see worker/watermark.mjs (shared with the remix composer).

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

// A job cancelled while ffmpeg/AI work was running: drop the result instead of completing it.
async function wasCancelled(id) {
  const [r] = await sql`select status from generation_jobs where id = ${id}`;
  return r?.status === "cancelled" || r?.status === "retried";
}

async function setStatus(id, fields) {
  await sql`update generation_jobs set ${sql(fields)}, updated_at = now() where id = ${id}`;
}

// BullMQ retries a job automatically (attempts: 2). Only the LAST failure marks the job "failed"
// (which shows the user a Retry button); earlier ones put it back to "queued" for the auto-retry.
// Never overwrite cancelled/retried — the user already acted on it.
async function markAttemptFailed(job, id, err) {
  // An UnrecoverableError (a final answer such as "not the same person") is never retried, whatever attempts are left.
  const final = err?.name === "UnrecoverableError" || (job?.attemptsMade ?? 1) >= (job?.opts?.attempts ?? 1);
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

  // Waltz Image (plan G1/G2/G5): one still on the ComfyUI box 192.168.166.183 (D1), not the AISERVER wrapper.
  if (j.job_type === "image") {
    await runImageJob({
      sql, setStatus, wasCancelled,
      putBytes: (Key, Body, ContentType) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body, ContentType })),
    }, j);
    return;
  }

  if (j.job_type === "translate_prep") return runTranslatePrep(j, req, genJobId);
  const videoBytes = req.cloud ? await runCloud(j, req, genJobId)
    : j.job_type === "translate_video" ? await runTranslateVideo(j, req, genJobId)
    : req.computer ? await runComputer(j, req, genJobId)
    : j.job_type === "talking_photo" ? await runTalking(j, req, genJobId)
    : await runAiserver(j, req, genJobId, workflow);
  if (!videoBytes) return; // cancelled
  await storeResult(j, req, genJobId, videoBytes);
}

// ─── Waltz Avatar Phase 3: translate a video of yourself (src/lib/translate-actions.ts) ───────────────────────────
// prep (free): the video's speech → whisper-small on AISERVER (voice-transcribe-v1) → the deck LLM translates it; the
// result waits in request_json.prep for the user to review. video: is it the presenter's person (presenter-match-v1)? →
// the reviewed text in their cloned voice (voice-clone-tts-v1) → fitted to the video's length (atempo 0.8–1.25×) → the
// video's own frames lip-synced to it (presenter-dub-v1) → the AI-generated label → a new version.
async function assetVideoBytes(assetId) {
  const [a] = await sql`select storage_key, converted_key, kind from assets where id = ${assetId}`;
  if (!a || a.kind !== "video") throw new Error("source video not found");
  return getBytes(a.converted_key ?? a.storage_key);
}

async function aiOutput(o) {
  const rel = o.subfolder ? `${o.subfolder}/${o.filename}` : o.filename;
  const dl = await fetch(`${AISERVER_URL}/outputs/${rel}`, { headers: aiHeaders });
  if (!dl.ok) throw new Error(`/outputs ${dl.status}`);
  return Buffer.from(await dl.arrayBuffer());
}

async function runTranslatePrep(j, req, genJobId) {
  const dir = mkdtempSync(join(tmpdir(), "cw-tprep-"));
  try {
    writeFileSync(join(dir, "v.mp4"), await assetVideoBytes(req.sourceAssetId));
    await run("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "v.mp4"), "-t", "180", "-vn", "-ac", "1", "-ar", "16000", join(dir, "a.wav")]);
    const fd = new FormData();
    fd.append("file", new Blob([readFileSync(join(dir, "a.wav"))], { type: "audio/wav" }), "speech.wav");
    const up = await fetch(`${AISERVER_URL}/inputs`, { method: "POST", headers: aiHeaders, body: fd });
    if (!up.ok) throw new Error(`stage /inputs ${up.status}`);
    await setStatus(genJobId, { status: "generating", progress: 20 });
    const staged = (await up.json()).filename;
    let st;
    try {
      st = await runPresenterJob("voice-transcribe-v1", { audio: staged }, 20 * 60_000, genJobId);
    } finally {
      await unstage(staged);
    }
    if (await wasCancelled(genJobId)) return;
    const tr = st.result ?? {};
    if (st.status !== "completed") throw new Error(`transcription failed — ${st.error ?? st.status}`);
    if (!String(tr.text ?? "").trim()) throw new UnrecoverableError("We couldn't hear any speech in that video");
    await setStatus(genJobId, { progress: 70 });
    const target = LANG_NAMES[req.lang] ?? "English";
    const out = await chatJson(TEXT_MODEL,
      `Translate this spoken text${tr.language ? ` (language code "${tr.language}")` : ""} into natural, idiomatic ${target} as it would be ` +
      `SPOKEN by the same person — same meaning, same tone, similar length, no additions. Keep names, brands, numbers and ` +
      `web addresses exactly (write web addresses the way a ${target} speaker says them aloud).\n\nTEXT: ${JSON.stringify(String(tr.text).slice(0, 6000))}\n\n` +
      `JSON shape: {"translation": string}`, null, { temperature: 0.2 });
    const translation = String(out?.data?.translation ?? "").trim();
    if (!translation) throw new Error("The translation came back empty — try again");
    const prep = { source: String(tr.text), sourceLang: tr.language ?? null, translation, seconds: Number(tr.seconds) || null };
    await sql`update generation_jobs set request_json = ${sql.json({ ...req, prep })}, status = 'completed', progress = 100,
      completed_at = now(), updated_at = now() where id = ${genJobId} and status not in ('cancelled', 'retried')`;
    console.log(`[gen] ${genJobId} translate prep → ${req.lang}: ${prep.source.length} → ${translation.length} chars`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runTranslateVideo(j, req, genJobId) {
  const [p] = await sql`select id, footage_key, voice_ref_key, voice_status, status from presenters where id = ${req.presenterId}`;
  if (!p || p.status !== "ready" || p.voice_status !== "ready") throw new UnrecoverableError("your presenter or its voice isn't ready any more");
  const dir = mkdtempSync(join(tmpdir(), "cw-tvid-"));
  const staged = []; // every file put on AISERVER for this job (the user's face + voice) — removed when the job ends
  const stage = async (...a) => { const n = await stageFile(...a); staged.push(n); return n; };
  try {
    const src = join(dir, "v.mp4");
    writeFileSync(src, await assetVideoBytes(req.sourceAssetId));
    // 1. Same person as the consented presenter? (voice match + a visible face)
    await setStatus(genJobId, { status: "uploading_to_ai_node", progress: 8 });
    const video = await stage(null, "video.mp4", "video/mp4", readFileSync(src));
    const footage = await stage(p.footage_key, "footage.mp4", "video/mp4");
    const m = await runPresenterJob("presenter-match-v1", { presenter_id: p.id, video, audio: footage }, PRESENTER_TIMEOUT_MS, genJobId);
    if (await wasCancelled(genJobId)) return null;
    if (m.status !== "completed") {
      if (m.result?.match?.reason) throw new UnrecoverableError(m.result.match.reason); // a verdict, not a glitch
      throw new Error(`We couldn't check that this is a video of you — ${m.error ?? m.status}`);
    }
    // 2. The translation in the user's cloned voice, one line per sentence group (≤ 600 chars).
    await setStatus(genJobId, { status: "generating", progress: 20 });
    const lines = speechLines(String(req.text));
    writeFileSync(join(dir, "ref.wav"), await getBytes(p.voice_ref_key));
    const ref = await stage(null, "ref.wav", "audio/wav", readFileSync(join(dir, "ref.wav")));
    const v = await runPresenterJob("voice-clone-tts-v1", { audio: ref, lines, language: req.lang }, 60 * 60_000, genJobId);
    if (await wasCancelled(genJobId)) return null;
    if (v.status !== "completed") throw new Error(`your cloned voice failed — ${v.error ?? v.status}`);
    const [, ...wavs] = v.outputs ?? [];
    const list = [];
    for (const [n, o] of wavs.entries()) {
      const f = join(dir, `l${n}.wav`);
      writeFileSync(f, await aiOutput(o));
      list.push(`file '${f.replace(/\\/g, "/")}'`);
    }
    writeFileSync(join(dir, "list.txt"), list.join("\n"));
    await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-ac", "1", "-ar", "24000", join(dir, "speech.wav")]);
    // 3. Fit the speech to the video: speed up / slow down by up to 25 % (a longer translation runs past the video; the
    //    lip-sync then plays the video's last stretch back and forth).
    const vlen = (await probeFile(src)).duration || 0;
    const slen = (await probeFile(join(dir, "speech.wav"))).duration || 0;
    const tempo = vlen > 0 && slen > 0 ? Math.min(1.25, Math.max(0.8, slen / vlen)) : 1;
    await run("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "speech.wav"), "-af", `atempo=${tempo.toFixed(4)}`, join(dir, "fit.wav")]);
    // 4. The video's own frames lip-synced to the new speech (a temporary presenter cache on AISERVER, deleted after).
    await setStatus(genJobId, { progress: 45 });
    const audio = await stage(null, "speech.wav", "audio/wav", readFileSync(join(dir, "fit.wav")));
    const d = await runPresenterJob("presenter-dub-v1", { presenter_id: randomUUID(), video, audio }, 90 * 60_000, genJobId);
    if (await wasCancelled(genJobId)) return null;
    if (d.status !== "completed") throw new Error(`lip-sync failed — ${d.error ?? d.status}`);
    const dubbed = await aiOutput(d.outputs[0]);
    await setStatus(genJobId, { status: "uploading_output", progress: 85 });
    const final = await finishTalking(dubbed, null, req.aiLabel !== false);
    // Credits: estimated from the source length; settle down to what was made (2 × the presenter rate).
    const meta = await probeVideo(final).catch(() => ({}));
    if (meta.duration) {
      const credits = Math.max(1, Math.ceil((Math.min(180, meta.duration) * 2) / 10));
      await sql`update generation_jobs set credits = ${credits} where id = ${genJobId} and credits > ${credits}`;
    }
    if (await wasCancelled(genJobId)) return null;
    return final;
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const n of staged) await unstage(n);
  }
}

/** The translation as lines for the cloned voice: sentences grouped up to ~400 characters; a longer sentence is split at
 *  word boundaries (never cut off). */
function speechLines(text) {
  const MAX = 400;
  const pieces = [];
  for (const sent of (text.match(/[^.!?。]+[.!?。]*\s*/g) ?? [text]).map((s) => s.trim()).filter(Boolean)) {
    let rest = sent;
    while (rest.length > MAX) {
      let cut = Math.max(rest.lastIndexOf(", ", MAX), rest.lastIndexOf(" ", MAX));
      if (cut <= 0) cut = MAX;
      pieces.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) pieces.push(rest);
  }
  return pieces.reduce((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && (last + " " + s).length <= MAX) acc[acc.length - 1] = `${last} ${s}`;
    else acc.push(s);
    return acc;
  }, []);
}

/** Remove a staged input from AISERVER now instead of leaving it for the 6-hour cleanup. */
async function unstage(name) {
  await fetch(`${AISERVER_URL}/inputs/${encodeURIComponent(name)}`, { method: "DELETE", headers: aiHeaders }).catch(() => {});
}

// ─── Talking photo (Phase C2): EchoMimic v3-Flash in AISERVER's clipwaltz-talking service ────────────────────────
// Photo (+ the user's recording, or a script Kokoro speaks on AISERVER) → a speaking clip at ~320×576, then Real-ESRGAN
// 2× (ComfyUI), the speech put back (the upscale drops audio) and a visible "AI-generated" label (EU AI Act Art. 50).
// A 30 s clip is ~8 chunks of ~3.5 min on one 3080, so the running timeout is an hour.
const TALKING_TIMEOUT_MS = Number(process.env.GEN_TALKING_TIMEOUT_MS ?? 60 * 60 * 1000);
const LABEL_FONTS = [process.env.AI_LABEL_FONT, "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:/Windows/Fonts/arialbd.ttf"].filter(Boolean);

// ─── The user's own computer (Phase C3): ClipWaltz Connector v0.2 + local ComfyUI ───────────────────────────────
// The job goes out as a connector_jobs row (kind comfy.run): the template id + checked values in `payload`, the photo /
// speech as MinIO keys in `inputs` (the Connector downloads them by name, never sees the keys). The Connector uploads the
// video (connector_jobs.output_key); this copies it into the project like any version and removes the temporaries.
// 0 credits. No AISERVER GPU is used — a typed script is spoken by Kokoro on AISERVER (CPU, a few seconds).
const COMPUTER_CLAIM_MS = 3 * 60_000; // the Connector long-polls every ≤ 25 s; longer means it isn't running
const COMPUTER_SILENT_MS = 5 * 60_000; // a running job reports progress every 15 s
const COMPUTER_TIMEOUT_MS = Number(process.env.GEN_COMPUTER_TIMEOUT_MS ?? 3 * 60 * 60 * 1000);
// Talking sizes on a home GPU (multiples of 16): the pixel budget ClipWaltz's own service renders (512×384 → 320×576,
// 7.7 GB peak on a headless 3080), with 97-frame chunks for headroom on a card that also drives a desktop.
const TALK_SIZES = { "9:16": [320, 576], "1:1": [448, 448], "16:9": [576, 320] };
// InfiniteTalk (infinitetalk-v1) renders at Wan 2.1's 480p sizes on a 24 GB class card.
const INFINITETALK_SIZES = { "9:16": [480, 832], "1:1": [624, 624], "16:9": [832, 480] };
// Measured 2026-10-14 on a 10 GB RTX 3080 with the Connector's --allow-low-vram (the 14B model streamed from system RAM):
// 4 s of speech in 917 s incl. a ~6 min first model load, ~37 s per sampling step. A 24 GB card is faster (not measured);
// this only sets the progress estimate and the job's deadline.
const INFINITETALK_SEC_PER_SEC = 120;

async function runComputer(j, req, genJobId) {
  const { connectorId, template } = req.computer;
  const tmp = `connector-in/${genJobId}`;
  const inputs = {};
  const [a] = await sql`select storage_key, converted_key, width, height from assets where id = ${req.sourceAssetId}`;
  if (!a) throw new Error("source photo not found");
  const photoKey = a.converted_key ?? a.storage_key;
  const ext = (photoKey.split(".").pop() || "").toLowerCase();
  inputs.photo = { key: photoKey, mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" };
  const seed = Number.isSafeInteger(req.seed) ? req.seed : randomInt(0, 2 ** 32);
  if (seed !== req.seed) await sql`update generation_jobs set request_json = ${sql.json({ ...req, seed })} where id = ${genJobId}`;

  let payload, expectSec;
  if (template === "clipwaltz-talking-v1" || template === "infinitetalk-v1") {
    let speechSec;
    if (req.audioKey) {
      inputs.speech = { key: req.audioKey, mime: "audio/mp4" };
      speechSec = Number(/-(\d+)ms\.m4a$/.exec(req.audioKey)?.[1] ?? 0) / 1000;
    } else {
      // Kokoro on AISERVER (the user's computer has no TTS); the WAV goes to MinIO for the Connector to fetch.
      const r = await fetch(`${AISERVER_URL}/tts`, {
        method: "POST", headers: { ...aiHeaders, "content-type": "application/json" },
        body: JSON.stringify({ text: req.script, voice: req.voice ?? "af_heart", speed: req.speed ?? 1, max_seconds: 30 }),
      });
      if (!r.ok) throw new Error(`voice: ${r.status} ${(await r.text()).slice(0, 200)}`);
      const wav = Buffer.from(await r.arrayBuffer());
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${tmp}/speech.wav`, Body: wav, ContentType: "audio/wav" }));
      inputs.speech = { key: `${tmp}/speech.wav`, mime: "audio/wav" };
      speechSec = estimateWavSeconds(wav);
    }
    const aspect = req.aspect && TALK_SIZES[req.aspect] ? req.aspect
      : a.width && a.height ? (Math.abs(a.width / a.height - 1) < 0.15 ? "1:1" : a.width > a.height ? "16:9" : "9:16") : "9:16";
    if (template === "infinitetalk-v1") {
      const [width, height] = INFINITETALK_SIZES[aspect];
      // 25 fps; the speech's own length (the Connector trims the last window to it), at most 30 s.
      const frames = Math.min(751, Math.max(25, Math.ceil(speechSec * 25) + 1));
      payload = { template, inputs: { width, height, seed, frames } };
      expectSec = Math.round(speechSec * INFINITETALK_SEC_PER_SEC);
    } else {
      const [width, height] = TALK_SIZES[aspect];
      payload = { template, inputs: { width, height, seed, chunkFrames: 97, maxSeconds: Math.min(30, Math.max(1, Math.ceil(speechSec + 0.5))) } };
      expectSec = Math.round(speechSec * 60); // a 10 GB card: roughly a minute per second of speech
    }
  } else if (template === "wan-i2v-v1") {
    const w = Math.round((req.width ?? 704) / 32) * 32, h = Math.round((req.height ?? 480) / 32) * 32;
    payload = { template, inputs: { prompt: j.prompt ?? "", negativePrompt: j.negative_prompt ?? "", width: w, height: h, length: framesForSeconds(req.durationSec ?? 5), seed, steps: req.steps ?? 20 } };
    expectSec = 900; // 5 s at 704×480 on a desktop RTX 3080: sampling alone took 14 min (2026-10-14)
  } else {
    throw new Error(`unknown computer template ${template}`);
  }
  payload.expectSec = expectSec;

  const cid = randomUUID();
  await sql`insert into connector_jobs (id, connector_id, kind, payload, inputs) values (${cid}, ${connectorId}, 'comfy.run', ${sql.json(payload)}, ${sql.json(inputs)})`;
  await setStatus(genJobId, { status: "uploading_to_ai_node", progress: 10 });
  console.log(`[gen] ${genJobId} → computer ${connectorId.slice(0, 8)} (${template})`);
  const t0 = Date.now();
  let outputKey = null;
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const [cur] = await sql`select status from generation_jobs where id = ${genJobId}`;
      if (cur?.status === "cancelled" || cur?.status === "retried") {
        // The Connector learns it from its next progress call (the row is no longer "running") and stops ComfyUI.
        await sql`update connector_jobs set status = 'expired', finished_at = now() where id = ${cid} and status in ('queued', 'running')`;
        console.log("[gen] cancelled", genJobId);
        return null;
      }
      const [cj] = await sql`select cj.status, cj.progress, cj.error, cj.output_key, cj.started_at, c.last_seen_at
        from connector_jobs cj join connectors c on c.id = cj.connector_id where cj.id = ${cid}`;
      if (!cj) throw new Error("the job for your computer disappeared");
      if (cj.status === "done") { outputKey = cj.output_key; break; }
      if (cj.status === "failed") throw new Error(`your computer: ${cj.error ?? "failed"}`);
      if (cj.status === "queued" && Date.now() - t0 > COMPUTER_CLAIM_MS) throw new Error("your computer didn't pick up the job — is the ClipWaltz Connector running?");
      if (cj.status === "running" && cj.last_seen_at && Date.now() - new Date(cj.last_seen_at).getTime() > COMPUTER_SILENT_MS) {
        throw new Error("lost contact with your computer");
      }
      if (Date.now() - t0 > COMPUTER_TIMEOUT_MS) throw new Error("your computer took too long");
      if (cj.status === "running") await setStatus(genJobId, { status: "generating", progress: 15 + Math.round((cj.progress ?? 0) * 0.65) });
    }
    if (!outputKey) throw new Error("your computer finished without a video");
    await setStatus(genJobId, { status: "uploading_output", progress: 85 });
    const bytes = await getBytes(outputKey);
    await sql`update connectors set last_used_at = now(), last_error = null where id = ${connectorId}`;
    return j.job_type === "talking_photo" ? finishTalking(bytes, null, req.aiLabel !== false) : bytes;
  } catch (e) {
    await sql`update connectors set last_error = ${String(e?.message ?? e).slice(0, 300)}, last_error_at = now() where id = ${connectorId}`.catch(() => {});
    await sql`update connector_jobs set status = 'expired', finished_at = now() where id = ${cid} and status in ('queued', 'running')`.catch(() => {});
    throw e;
  } finally {
    // Nothing kept: the job row, its uploaded video and the speech we made.
    const [row] = await sql`delete from connector_jobs where id = ${cid} returning output_key`.catch(() => []);
    for (const key of [row?.output_key, inputs.speech?.key?.startsWith(tmp) ? inputs.speech.key : null].filter(Boolean)) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {});
    }
  }
}

/** Seconds of a PCM WAV from its header (fallback when ffprobe can't read it). */
function estimateWavSeconds(wav) {
  const rate = wav.readUInt32LE(28); // byte rate
  return rate ? (wav.length - 44) / rate : 5;
}

async function runTalking(j, req, genJobId) {
  const [a] = await sql`select storage_key, converted_key from assets where id = ${req.sourceAssetId}`;
  if (!a) throw new Error("source photo not found");
  const image = await stageImage(a.converted_key ?? a.storage_key);
  let audio = null;
  if (req.audioKey) {
    const fd = new FormData();
    fd.append("file", new Blob([await getBytes(req.audioKey)], { type: "audio/mp4" }), "speech.m4a");
    const r = await fetch(`${AISERVER_URL}/inputs`, { method: "POST", headers: aiHeaders, body: fd });
    if (!r.ok) throw new Error(`stage /inputs ${r.status}: ${(await r.text()).slice(0, 300)}`);
    audio = (await r.json()).filename;
  }
  const seed = Number.isSafeInteger(req.seed) ? req.seed : randomInt(0, 2 ** 32);
  if (seed !== req.seed) await sql`update generation_jobs set request_json = ${sql.json({ ...req, seed })} where id = ${genJobId}`;
  await setStatus(genJobId, { status: "uploading_to_ai_node", progress: 10 });

  const sub = await fetch(`${AISERVER_URL}/jobs`, {
    method: "POST", headers: { ...aiHeaders, "content-type": "application/json" },
    body: JSON.stringify({ workflow: req.workflow ?? "echomimic-talking-v1", inputs: {
      source_image: image, audio, text: audio ? null : req.script, voice: req.voice ?? "af_heart", speed: req.speed ?? 1,
      duration: 30, seed, aspect: req.aspect ?? "photo",
    } }),
  });
  if (!sub.ok) throw new Error(`/jobs ${sub.status}: ${(await sub.text()).slice(0, 300)}`);
  const providerJobId = (await sub.json()).job_id;
  await setStatus(genJobId, { status: "generating", progress: 15 });

  const clock = providerClock(TALKING_TIMEOUT_MS);
  let out = null;
  while (!clock.expired()) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const [cur] = await sql`select status from generation_jobs where id = ${genJobId}`;
    if (cur?.status === "cancelled" || cur?.status === "retried") {
      await fetch(`${AISERVER_URL}/jobs/${providerJobId}/cancel`, { method: "POST", headers: aiHeaders }).catch(() => {});
      console.log("[gen] cancelled", genJobId);
      return null;
    }
    const pr = await fetch(`${AISERVER_URL}/jobs/${providerJobId}`, { headers: aiHeaders });
    if (!pr.ok) continue;
    const st = await pr.json();
    clock.observe(st.status);
    if (st.status === "completed") { out = st.outputs?.[0] ?? null; break; }
    if (st.status === "failed") throw new Error(`talking photo failed: ${st.error ?? "unknown"}`);
    if (typeof st.progress === "number") await setStatus(genJobId, { progress: 15 + Math.round(st.progress * 0.6) });
  }
  if (!out) throw new Error("talking photo timed out");
  const rel = out.subfolder ? `${out.subfolder}/${out.filename}` : out.filename;
  const dl = await fetch(`${AISERVER_URL}/outputs/${rel}`, { headers: aiHeaders });
  if (!dl.ok) throw new Error(`/outputs ${dl.status}`);
  const raw = Buffer.from(await dl.arrayBuffer());

  // Standard: Real-ESRGAN 2×. High (owner 2026-10-14, 2 credits/s): SeedVR2 restore — more natural skin and eyes.
  // A failed High restore falls back to ESRGAN and is charged as Standard; a failed upscale keeps the native size
  // rather than failing a clip the user waited for.
  await setStatus(genJobId, { status: "uploading_output", progress: 80 });
  let upscaled = null;
  let rate = req.quality === "high" ? 2 : 1;
  if (rate === 2) {
    try {
      const info = await probeVideo(raw);
      upscaled = await runAiWorkflow("seedvr2-restore-v1", raw, genJobId, { extraInputs: restoreParams(info), timeoutMs: RESTORE_TIMEOUT_MS });
    } catch (e) {
      if (String(e?.message) === "cancelled") return null;
      console.warn(`[gen] ${genJobId} talking restore failed, using the standard upscale: ${e?.message ?? e}`);
      rate = 1;
    }
  }
  if (!upscaled) {
    try {
      upscaled = await runAiWorkflow("esrgan-upscale-v1", raw, genJobId);
    } catch (e) {
      if (String(e?.message) === "cancelled") return null;
      console.warn(`[gen] ${genJobId} talking upscale skipped: ${e?.message ?? e}`);
    }
  }
  const final = await finishTalking(raw, upscaled, req.aiLabel !== false);

  // Credits: charged up front from the script estimate (or the recording's length); settle to the seconds rendered.
  const meta = await probeVideo(final).catch(() => ({}));
  // Refund only: the balance was checked for the up-front amount, so the settle may never raise it.
  if (meta.duration) {
    const credits = Math.min(j.credits ?? 0, Math.max(1, Math.ceil(Math.min(30, meta.duration)) * rate));
    await sql`update generation_jobs set credits = ${credits} where id = ${genJobId} and credits > ${credits}`;
  }
  return final;
}

/** Speech from the original render over the (upscaled) picture, plus the "AI-generated" label top-right. */
async function finishTalking(raw, upscaled, label) {
  const dir = mkdtempSync(join(tmpdir(), "cw-talk-"));
  try {
    const src = join(dir, "raw.mp4"), up = join(dir, "up.mp4"), out = join(dir, "out.mp4");
    writeFileSync(src, raw);
    if (upscaled) writeFileSync(up, upscaled);
    const pic = upscaled ? up : src;
    const meta = await probeVideo(upscaled ?? raw).catch(() => ({}));
    const short = Math.min(meta.width || 320, meta.height || 576);
    const font = LABEL_FONTS.find((f) => existsSync(f));
    const fs = Math.max(12, Math.round(short * 0.035)), pad = Math.round(short * 0.03);
    // drawtext's fontfile is a filter option: escape the drive colon of a Windows dev path.
    // The label is a legal requirement (EU AI Act Art. 50): no font → fail the job (credits refunded), never ship it unlabelled.
    if (label && !font) throw new Error("no font for the AI-generated label — install fonts-dejavu-core or set AI_LABEL_FONT");
    const vf = label
      ? `drawtext=fontfile='${font.replace(/:/g, "\\:")}':text='AI-generated':fontsize=${fs}:fontcolor=white:` +
        `box=1:boxcolor=black@0.45:boxborderw=${Math.round(fs * 0.4)}:x=w-tw-${pad}:y=${pad},format=yuv420p`
      : "format=yuv420p";
    await run("ffmpeg", ["-v", "error", "-y", "-i", pic, "-i", src, "-map", "0:v:0", "-map", "1:a:0?", "-vf", vf,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "copy", "-shortest", "-movflags", "+faststart", out],
      { maxBuffer: 1 << 26 });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Built-in model: the AISERVER wrapper (ComfyUI, Wan 2.2) ──────────────────────
async function runAiserver(j, req, genJobId, workflow) {
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
      // A WaltzDeck AI backdrop is one still frame.
      length: req.deckBackdrop ? 1 : framesForSeconds(req.durationSec ?? 5),
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

  // Pull the output MP4 from the wrapper.
  await setStatus(genJobId, { status: "uploading_output", progress: 85 });
  const rel = out.subfolder ? `${out.subfolder}/${out.filename}` : out.filename;
  const dl = await fetch(`${AISERVER_URL}/outputs/${rel}`, { headers: aiHeaders });
  if (!dl.ok) throw new Error(`/outputs ${dl.status}`);
  return Buffer.from(await dl.arrayBuffer());
}

// ─── Cloud video models (Kling / Runway / MiniMax — Phase C1) ──────────────────────
const CLOUD_POLL_MS = 10_000;
const CLOUD_TIMEOUT_MS = Number(process.env.GEN_CLOUD_TIMEOUT_MS ?? 30 * 60 * 1000);
const aspectOf = (w, h) => (!w || !h ? "16:9" : w === h ? "1:1" : w > h ? "16:9" : "9:16");

// The key that pays for this clip, read at run time: ClipWaltz's (admin) or the user's own (AI models page).
async function cloudKey(j, cloud) {
  if (cloud.source === "own") {
    const [k] = await sql`select key_enc from user_ai_keys where user_id = ${j.requested_by} and provider = ${cloud.provider}`;
    if (!k) throw new Error(`Your ${VIDEO_PROVIDERS[cloud.provider]?.label ?? cloud.provider} key was removed — add it again under AI models`);
    return decryptSecret(k.key_enc);
  }
  const [row] = await sql`select value from app_settings where key = ${VIDEO_SETTINGS_KEY}`;
  const enc = row?.value?.[cloud.provider]?.platformKeyEnc;
  if (!enc) throw new Error(`${VIDEO_PROVIDERS[cloud.provider]?.label ?? cloud.provider} isn't set up right now`);
  return decryptSecret(enc);
}

// Source photo for a vendor: JPEG/PNG under 4.5 MB (Runway's data-URI limit is 5 MB); anything else is re-encoded.
async function imageForCloud(key) {
  const bytes = await getBytes(key);
  const ext = (key.split(".").pop() || "").toLowerCase();
  if (bytes.length <= 4.5 * 1024 * 1024 && ["jpg", "jpeg", "png"].includes(ext)) {
    return { b64: bytes.toString("base64"), mime: ext === "png" ? "image/png" : "image/jpeg" };
  }
  const dir = mkdtempSync(join(tmpdir(), "cw-cloudimg-"));
  try {
    writeFileSync(join(dir, "in"), bytes);
    await run("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "in"), "-vf", "scale='min(1920,iw)':-2", "-q:v", "3", join(dir, "out.jpg")]);
    return { b64: readFileSync(join(dir, "out.jpg")).toString("base64"), mime: "image/jpeg" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runCloud(j, req, genJobId) {
  const model = videoModel(req.cloud.model);
  if (!model) throw new Error(`unknown cloud model ${req.cloud.model}`);
  const apiKey = await cloudKey(j, req.cloud);
  let image = null;
  if (j.job_type === "image_to_video") {
    const [a] = await sql`select storage_key, converted_key from assets where id = ${req.sourceAssetId}`;
    if (!a) throw new Error("source asset not found");
    image = await imageForCloud(a.converted_key ?? a.storage_key);
  }
  // Last chance to honour a cancel: from here on a ClipWaltz-key clip can't be cancelled (the app refuses once
  // cloud.submitting / cloud.taskId is set), because the vendor may bill it.
  const [marked] = await sql`update generation_jobs set status = 'uploading_to_ai_node', progress = 15,
      request_json = ${sql.json({ ...req, cloud: { ...req.cloud, submitting: true } })}, updated_at = now()
    where id = ${genJobId} and status not in ('cancelled', 'retried') returning id`;
  if (!marked) {
    console.log("[gen] cancelled before submit", genJobId);
    return null;
  }
  let taskId;
  try {
    taskId = await submitCloud(model, apiKey, {
      task: j.job_type, prompt: j.prompt ?? "", image, aspect: aspectOf(req.width, req.height),
      durationSec: req.durationSec ?? 5, seed: req.seed ?? null,
    });
  } catch (e) {
    throw new Error(`${model.label}: ${videoErrorText(e, apiKey)}`);
  }
  const [running] = await sql`update generation_jobs set request_json = ${sql.json({ ...req, cloud: { ...req.cloud, submitting: true, taskId } })},
      status = 'generating', progress = 30, updated_at = now()
    where id = ${genJobId} and status not in ('cancelled', 'retried') returning id`;
  if (!running) {
    // Cancelled during the submit (own-key clip — ClipWaltz-key clips can't be cancelled by now): stop it at the vendor.
    await cancelCloud(model, apiKey, taskId);
    console.log("[gen] cancelled during submit", genJobId);
    return null;
  }
  console.log(`[gen] ${genJobId} → ${model.id} task ${taskId} (${req.cloud.source} key)`);

  const t0 = Date.now();
  let url = null;
  let lastTransient = null;
  while (Date.now() - t0 < CLOUD_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, CLOUD_POLL_MS));
    const [cur] = await sql`select status from generation_jobs where id = ${genJobId}`;
    if (cur?.status === "cancelled" || cur?.status === "retried") {
      await cancelCloud(model, apiKey, taskId);
      console.log("[gen] cancelled", genJobId);
      return null;
    }
    let st;
    try {
      st = await pollCloud(model, apiKey, taskId);
    } catch (e) {
      lastTransient = videoErrorText(e, apiKey);
      continue; // network hiccup: keep polling until the deadline
    }
    if (st.transient) lastTransient = videoErrorText(st.transient, apiKey);
    if (st.state === "done") { url = st.url; break; }
    if (st.state === "failed") throw new Error(`${model.label}: ${videoErrorText(st.error, apiKey)}`);
    const pct = Math.min(80, 30 + Math.round(((Date.now() - t0) / (5 * 60_000)) * 50));
    await setStatus(genJobId, { progress: pct });
  }
  if (!url) throw new Error(`${model.label} didn't finish in ${Math.round(CLOUD_TIMEOUT_MS / 60000)} min${lastTransient ? ` (${lastTransient})` : ""}`);
  await setStatus(genJobId, { status: "uploading_output", progress: 85 });
  return downloadOutput(url);
}

// ─── Store a finished clip (built-in or cloud) as a project version ────────────────
async function storeResult(j, req, genJobId, videoBytes) {
  if (req.deckBackdrop) {
    await storeDeckBackdrop(j, req, videoBytes);
    await setStatus(genJobId, { status: "completed", progress: 100, completed_at: new Date() });
    console.log(`[gen] ${genJobId} done → deck backdrop`);
    return;
  }
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
  if (req.deckFill?.sceneId) await deckFillScene(j, req.deckFill.sceneId, { key: clean_key ?? outputKey, versionNumber, meta, bytes: videoBytes.length });
  // Never flip a job the user cancelled meanwhile to completed (a cancelled job's credits are refunded).
  await sql`update generation_jobs set status = 'completed', progress = 100, completed_at = now(), updated_at = now()
    where id = ${genJobId} and status not in ('cancelled', 'retried')`;
  console.log(`[gen] ${genJobId} done → ${outputKey} (v${versionNumber}, ${videoBytes.length} bytes)`);
}

// WaltzDeck AI backdrop: the single frame → a JPEG in the deck's backdrop library (projects.deck.backdrops), then
// applied to its scene (deck_scenes.background) or as the deck default (deck.brief.backdrop). The tone (light / dark
// centre, where the words go) decides the text colour over it (worker/deck/backdrop.mjs).
async function storeDeckBackdrop(j, req, videoBytes) {
  const dir = mkdtempSync(join(tmpdir(), "cw-backdrop-"));
  try {
    const v = join(dir, "v.mp4"), out = join(dir, "b.jpg");
    writeFileSync(v, videoBytes);
    await run("ffmpeg", ["-v", "error", "-y", "-i", v, "-frames:v", "1", "-q:v", "2", out]);
    // Brightness (0–255) of a 3×3 grid over the picture: the text colour follows the cells under the words
    // (worker/deck/backdrop.mjs backdropTone). `tone` = the centre cell.
    const { stdout } = await run("ffmpeg", ["-v", "error", "-i", out, "-vf", "scale=3:3:flags=area,format=gray", "-f", "rawvideo", "-"], { encoding: "buffer" });
    const grid = [...(stdout ?? [])].slice(0, 9);
    const tone = (grid[4] ?? 0) > 150 ? "light" : "dark";
    const key = `projects/${j.project_id}/backdrops/${j.id}.jpg`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: readFileSync(out), ContentType: "image/jpeg" }));
    const b = req.deckBackdrop;
    const bg = { style: "ai", intensity: ["calm", "balanced", "vivid"].includes(b.intensity) ? b.intensity : "balanced", seed: 0, imageId: j.id };
    await sql.begin(async (tx) => {
      const [p] = await tx`select deck, aspect from projects where id = ${j.project_id} for update`;
      if (!p) return;
      const deck = p.deck ?? {};
      const entry = { id: j.id, key, prompt: String(req.userPrompt ?? "").slice(0, 200), preset: String(b.preset ?? "custom"), tone, grid, aspect: p.aspect, createdAt: new Date().toISOString() };
      const next = { ...deck, backdrops: [...(deck.backdrops ?? []), entry] };
      if (!b.sceneId) next.brief = { ...(deck.brief ?? {}), backdrop: bg };
      await tx`update projects set deck = ${tx.json(next)}, updated_at = now() where id = ${j.project_id}`;
      if (b.sceneId) await tx`update deck_scenes set background = ${tx.json(bg)}, updated_at = now() where id = ${b.sceneId} and project_id = ${j.project_id}`;
    });
    console.log(`[gen] deck backdrop ${j.id} (${tone}) → ${b.sceneId ? `scene ${b.sceneId}` : "deck default"}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// WaltzDeck AI fill (phase 5): the finished clip becomes a normal project video (library media row + asset, like an
// upload — the clean master, since every render adds its own watermark) and replaces the storyboard scene's media.
// Then its vision description is queued so the editor stops showing "looking…" and planning can use it.
let _deckQueue = null;
async function deckFillScene(j, sceneId, { key: versionKey, versionNumber, meta, bytes }) {
  let key = versionKey;
  try {
    const [sc] = await sql`select id, order_index from deck_scenes where id = ${sceneId} and project_id = ${j.project_id}`;
    if (!sc) return console.log(`[gen] deck fill: scene ${sceneId} is gone — clip kept as v${versionNumber} only`);
    const [p] = await sql`select workspace_id from projects where id = ${j.project_id}`;
    const assetId = randomUUID(), mediaId = randomUUID();
    const name = `AI clip — scene ${sc.order_index + 1} (v${versionNumber}).mp4`;
    // Its own file under the project's uploads, so deleting the Waltz AI version (or Free-plan retention of the
    // upload) never removes the other's file.
    const src = key;
    key = `projects/${j.project_id}/${assetId}-ai-clip.mp4`;
    await s3.send(new CopyObjectCommand({ Bucket: BUCKET, Key: key, CopySource: `${BUCKET}/${encodeURI(src)}`, ContentType: "video/mp4", MetadataDirective: "REPLACE" }));
    await sql.begin(async (tx) => {
      const [{ next }] = await tx`select coalesce(max(order_index), -1) + 1 as next from assets where project_id = ${j.project_id}`;
      if (j.requested_by) {
        await tx`insert into media ${tx({ id: mediaId, owner_id: j.requested_by, kind: "video", original_name: name, storage_key: key,
          conversion_state: "ready", size_bytes: bytes, duration_sec: meta.duration ?? null, last_used_at: new Date() })}`;
      }
      await tx`insert into assets ${tx({ id: assetId, project_id: j.project_id, media_id: j.requested_by ? mediaId : null, workspace_id: p?.workspace_id ?? null,
        storage_key: key, kind: "video", original_name: name, upload_state: "uploaded", conversion_state: "ready",
        duration_sec: meta.duration ?? null, width: meta.width || null, height: meta.height || null, order_index: Number(next) })}`;
      await tx`update deck_scenes set asset_id = ${assetId}, in_sec = null, frame = null, why = ${`Made by AI (Waltz AI v${versionNumber}).`}, updated_at = now()
        where id = ${sceneId}`;
    });
    if (!_deckQueue) _deckQueue = new Queue(DECK_QUEUE, { connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) });
    await _deckQueue.add("describe", { assetId }, { jobId: `describe-${assetId}`, attempts: 1, removeOnComplete: 500, removeOnFail: 1000 }).catch(() => {});
    console.log(`[gen] deck fill: scene ${sceneId} → asset ${assetId}`);
  } catch (e) {
    console.error(`[gen] deck fill for scene ${sceneId} failed (clip kept as v${versionNumber}): ${e.message}`);
  }
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
    // A post waiting for its Auto AI Image publishes without it once the image job has finally failed.
    await afterImageJobFailure(sql, id).catch((e) => console.error("[gen] image failure release failed", e));
  }
});
worker.on("completed", (job) => console.log(`[gen] queue job ${job.id} completed`));
console.log(`[gen] ClipWaltz generation worker up (queue=${GENERATION_QUEUE}, aiserver=${AISERVER_URL})`);

// Cloud clips (Phase C1) wait on a vendor, not a GPU: their own queue + concurrency (src/lib/queue.ts
// CLOUD_GENERATION_QUEUE). One attempt per job (set by the app), so a failure is final and refunds the credits.
const CLOUD_GENERATION_QUEUE = `${GENERATION_QUEUE}-cloud`;
const cloudWorker = new Worker(
  CLOUD_GENERATION_QUEUE,
  async (job) => { await processJob(job.data.generationJobId); },
  { connection, concurrency: Number(process.env.GEN_CLOUD_CONCURRENCY ?? 4), lockDuration: 5 * 60 * 1000 },
);
cloudWorker.on("failed", async (job, err) => {
  const id = job?.data?.generationJobId;
  console.error(`[gen-cloud] FAILED ${id}: ${err?.message}`);
  if (id) {
    try {
      await markAttemptFailed(job, id, err);
    } catch (e) { console.error("[gen-cloud] status write failed", e); }
  }
});
console.log(`[gen] cloud video worker up (queue=${CLOUD_GENERATION_QUEUE})`);

// Video on users' own computers (Phase C3): a job only polls Postgres while their GPU works (minutes to hours), so it
// has its own queue — it must never hold one of the 4 cloud-clip slots. The app caps active jobs per user (2).
const COMPUTER_GENERATION_QUEUE = `${GENERATION_QUEUE}-computer`;
const computerWorker = new Worker(
  COMPUTER_GENERATION_QUEUE,
  async (job) => { await processJob(job.data.generationJobId); },
  { connection, concurrency: Number(process.env.GEN_COMPUTER_CONCURRENCY ?? 20), lockDuration: 5 * 60 * 1000 },
);
computerWorker.on("failed", async (job, err) => {
  console.error(`[gen] computer job ${job?.id} failed:`, err?.message ?? err);
  if (job?.data?.generationJobId) await markAttemptFailed(job, job.data.generationJobId, err).catch(() => {});
});
console.log(`[gen] computer video worker up (queue=${COMPUTER_GENERATION_QUEUE})`);

// ─── Waltz Avatar presenters (Phase 1) ─────────────────────────────────────────────────────────────────────────
// prepare: the footage + live consent clip go to AISERVER (presenter-prepare-v1 in the clipwaltz-talking service): the
// consent check (spoken code, face, voice match — aiserver/talking/consent.py) and, if it passes, the presenter cache.
// delete: forget the cache on AISERVER (the app already removed the MinIO files and the row).
const PRESENTER_QUEUE = `${GENERATION_QUEUE}-presenter`;
const PRESENTER_TIMEOUT_MS = 30 * 60_000;

// Files staged on AISERVER during one presenter-queue job (footage, consent clips, voice references — a user's face and
// voice): removed when that job ends rather than left for the 6-hour cleanup. Per job, as the queue runs two at once.
const stagedFiles = new AsyncLocalStorage();

async function stageFile(key, name, type, bytes = null) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes ?? await getBytes(key)], { type }), name);
  const r = await fetch(`${AISERVER_URL}/inputs`, { method: "POST", headers: aiHeaders, body: fd });
  if (!r.ok) throw new Error(`stage /inputs ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const filename = (await r.json()).filename;
  stagedFiles.getStore()?.push(filename);
  return filename;
}

/** Submit a presenter-* job to the wrapper and wait for it. → the wrapper's final job record. */
/** `genJobId` (a generation job, e.g. a translation): when the user cancels it, the AISERVER job is cancelled too so the
 *  GPU stops at once (the app's cancel only marks the row). */
async function runPresenterJob(workflow, inputs, timeoutMs = PRESENTER_TIMEOUT_MS, genJobId = null) {
  const sub = await fetch(`${AISERVER_URL}/jobs`, {
    method: "POST", headers: { ...aiHeaders, "content-type": "application/json" }, body: JSON.stringify({ workflow, inputs }),
  });
  if (!sub.ok) throw new Error(`/jobs ${sub.status}: ${(await sub.text()).slice(0, 300)}`);
  const id = (await sub.json()).job_id;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const r = await fetch(`${AISERVER_URL}/jobs/${id}`, { headers: aiHeaders });
    if (!r.ok) continue;
    const st = await r.json();
    if (st.status === "completed" || st.status === "failed" || st.status === "cancelled") return st;
    if (genJobId && await wasCancelled(genJobId)) {
      await fetch(`${AISERVER_URL}/jobs/${id}/cancel`, { method: "POST", headers: aiHeaders }).catch(() => {});
      return { status: "cancelled" };
    }
  }
  await fetch(`${AISERVER_URL}/jobs/${id}/cancel`, { method: "POST", headers: aiHeaders }).catch(() => {});
  throw new Error(`${workflow} timed out`);
}

async function processPresenter({ presenterId, action }) {
  if (action === "delete") {
    const r = await fetch(`${AISERVER_URL}/presenters/${presenterId}`, { method: "DELETE", headers: aiHeaders });
    console.log(`[presenter] ${presenterId} cache delete → ${r.status}`);
    return;
  }
  if (action === "voice") return processVoice(presenterId);
  if (action === "portraits") return libraryPortraits(presenterId);
  if (action === "ai_build") return libraryAiBuild(presenterId);
  if (action === "library_prepare") return libraryPrepare(presenterId);
  const [p] = await sql`select * from presenters where id = ${presenterId}`;
  if (!p || p.status !== "queued") return;
  if (p.source === "photo") return settleBuild(p, () => photoBuild(p));
  await sql`update presenters set status = 'preparing', updated_at = now() where id = ${presenterId}`;
  const [consent] = await sql`select id, statement from presenter_consents where presenter_id = ${presenterId} order by created_at desc limit 1`;
  if (!consent) throw new Error("no consent record for this attempt");
  try {
    // The exact objects checked here are the ones the presenter keeps (a later upload uses a new key and can't land while
    // the presenter is being built — the app's routes only update draft / failed rows).
    const video = await stageFile(p.footage_key, "footage.mp4", "video/mp4");
    const clip = await stageFile(p.consent_key, "consent.mp4", "video/mp4");
    const st = await runPresenterJob("presenter-prepare-v1", { presenter_id: presenterId, video, consent_clip: clip, consent_code: p.consent_code, consent_statement: consent.statement });
    const chk = st.result?.consent ?? null;
    if (consent && chk) {
      await sql`update presenter_consents set verified = ${!!chk.ok}, result = ${sql.json(chk)}, verified_at = ${chk.ok ? new Date() : null} where id = ${consent.id}`;
    }
    if (st.status !== "completed") {
      // A failed consent check is final for this code: the user records again with a new one (restartConsent).
      // Shown to the user: the consent check's reason, or a footage problem the service worded for them; anything else
      // is an internal error (logged, not shown).
      const reason = chk && !chk.ok ? chk.reason : st.result?.user_error ?? "We couldn't build the presenter — try again in a few minutes";
      await sql`update presenters set status = 'failed', error = ${reason}, updated_at = now() where id = ${presenterId}`;
      console.log(`[presenter] ${presenterId} failed: ${reason} (${String(st.error ?? "").slice(0, 300)})`);
      return;
    }
    // Thumbnail: a frame 1 s into the footage, 480 px tall.
    let thumbKey = null;
    const dir = mkdtempSync(join(tmpdir(), "cw-pthumb-"));
    try {
      writeFileSync(join(dir, "f.mp4"), await getBytes(p.footage_key));
      await run("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", join(dir, "f.mp4"), "-frames:v", "1", "-vf", "scale=-2:480", "-q:v", "3", join(dir, "t.jpg")]);
      thumbKey = `presenters/${p.user_id}/${presenterId}/thumb.jpg`;
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: thumbKey, Body: readFileSync(join(dir, "t.jpg")), ContentType: "image/jpeg" }));
    } catch (e) {
      console.warn(`[presenter] ${presenterId} thumbnail skipped: ${e?.message ?? e}`);
      thumbKey = null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const meta = { frames: st.result?.frames, width: st.result?.width, height: st.result?.height, missing: st.result?.missing };
    // The code is spent once it has been checked.
    const done = await sql`update presenters set status = 'ready', error = null, meta = ${sql.json(meta)}, thumb_key = ${thumbKey},
      consent_code = null, ready_at = now(), updated_at = now()
      where id = ${presenterId} and status = 'preparing' and footage_key = ${p.footage_key} and consent_key = ${p.consent_key} returning id`;
    if (!done.length) {
      console.warn(`[presenter] ${presenterId} changed or was deleted while building — not marked ready`);
      return;
    }
    console.log(`[presenter] ${presenterId} ready (${meta.frames} frames, consent voice ${chk?.voice_score})`);
  } catch (e) {
    await sql`update presenters set status = 'failed', error = ${"Something went wrong building the presenter — try again"}, updated_at = now() where id = ${presenterId}`;
    throw e;
  }
}

// ─── Phase 2 — ClipWaltz's presenter library (admin-made; every user may use a ready one) ───────────────────────
// ai: a fictional face (Wan 2.2 one-frame stills — the admin picks one) → ~20 s of talking footage from it (EchoMimic,
// echomimic-talking-v1, + Real-ESRGAN 2×) → the usual presenter cache. actor: footage the admin uploaded with a signed
// release (releaseRef) → the presenter cache. No consent clip: the face is fictional, or the release covers it.
const PORTRAIT_COUNT = 3;
const BASE_SCRIPT = "Hello and welcome. Today I want to walk you through something useful, step by step. " +
  "It only takes a minute, and by the end you will know exactly what to do next. Let's get started together.";

// The same pipeline also builds a user's own presenter made without footage (kind twin): source "ai" (a fictional face the
// user generated and picked — portraits + ai_build) or "photo" (a frame of their live consent clip — photoBuild, after the
// consent check). Those builds are charged (buildChargeId, a generation_jobs row): settleBuild marks it completed when the
// presenter is ready, else failed — which refunds it.
const userAi = (p) => p.kind === "twin" && p.source === "ai";

async function settleBuild(p, build) {
  try {
    await build();
  } finally {
    if (p.build_charge_id) {
      const [now] = await sql`select status from presenters where id = ${p.id}`;
      const ok = now?.status === "ready";
      await sql`update generation_jobs set status = ${ok ? "completed" : "failed"}, progress = ${ok ? 100 : 0},
        error_message = ${ok ? null : "Presenter build didn't finish — refunded"}, completed_at = ${ok ? new Date() : null},
        failed_at = ${ok ? null : new Date()}, updated_at = now()
        where id = ${p.build_charge_id} and job_type = 'presenter_build' and status = 'generating'`;
      console.log(`[presenter] ${p.id} build charge ${ok ? "settled" : "refunded"}`);
    }
  }
}

/** A user's photo presenter: the live consent clip is checked (sentence, code, a face — and, as the "footage" is the clip
 *  itself, the voice match trivially holds), then the picked frame of that same clip is animated like an AI face. */
async function photoBuild(p) {
  const presenterId = p.id;
  await sql`update presenters set status = 'preparing', updated_at = now() where id = ${presenterId}`;
  const [consent] = await sql`select id, statement from presenter_consents where presenter_id = ${presenterId} and kind = 'likeness' order by created_at desc limit 1`;
  try {
    if (!consent || !p.consent_key || p.photo_at == null) throw new Error("photo presenter without consent / frame");
    const clip = await stageFile(p.consent_key, "consent.mp4", "video/mp4");
    const st = await runPresenterJob("presenter-consent-v1", {
      presenter_id: presenterId, video: clip, consent_clip: clip, consent_code: p.consent_code, consent_statement: consent.statement,
    });
    const chk = st.result?.consent ?? null;
    if (chk) await sql`update presenter_consents set verified = ${!!chk.ok}, result = ${sql.json(chk)}, verified_at = ${chk.ok ? new Date() : null} where id = ${consent.id}`;
    if (st.status !== "completed" || !chk?.ok) {
      const reason = chk && !chk.ok ? chk.reason : "We couldn't check the consent recording — try again in a few minutes";
      await sql`update presenters set status = 'failed', error = ${`${reason} (credits refunded)`}, updated_at = now() where id = ${presenterId}`;
      console.log(`[presenter] ${presenterId} photo consent failed: ${reason}`);
      return;
    }
    // The picked frame, cropped to 9:16 around the middle (the recorder frames the face there) → the portrait to animate.
    const dir = mkdtempSync(join(tmpdir(), "cw-photo-"));
    const portraitKey = `presenters/${p.user_id}/${presenterId}/portrait-photo-${randomUUID()}.png`;
    try {
      writeFileSync(join(dir, "c.mp4"), await getBytes(p.consent_key));
      await run("ffmpeg", ["-v", "error", "-y", "-ss", String(p.photo_at), "-i", join(dir, "c.mp4"), "-frames:v", "1",
        "-vf", "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=-2:1280:flags=lanczos", join(dir, "p.png")]);
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: portraitKey, Body: readFileSync(join(dir, "p.png")), ContentType: "image/png" }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // The code is spent once it has been checked.
    await sql`update presenters set thumb_key = ${portraitKey}, consent_code = null, updated_at = now() where id = ${presenterId}`;
    await buildFromPortrait({ ...p, thumb_key: portraitKey });
  } catch (e) {
    await sql`update presenters set status = 'failed', error = ${"Something went wrong building the presenter — try again (credits refunded)"}, updated_at = now() where id = ${presenterId}`;
    throw e;
  }
}

async function libraryPortraits(presenterId) {
  const [p] = await sql`select * from presenters where id = ${presenterId}`;
  if (!p || !(p.kind === "ai" || userAi(p)) || p.status !== "queued") return;
  const prompt = `Photorealistic chest-up portrait of ${String(p.description ?? "a friendly adult").slice(0, 300)}, a professional video ` +
    "presenter, looking straight into the camera with a friendly expression, mouth closed, wearing smart casual clothes, " +
    "head and shoulders with space above the head, bright soft glowing studio light, plain light grey background, sharp focus, natural skin, 85mm photo";
  const keys = [];
  try {
    for (let n = 0; n < PORTRAIT_COUNT; n++) {
      const st = await runPresenterJob("wan-text-to-video-v1", {
        prompt, width: 704, height: 1280, length: 1, steps: 30, seed: randomInt(0, 2 ** 31),
        negative_prompt: "dark, underexposed, cartoon, painting, illustration, deformed, extra fingers, bare shoulders, text, watermark, logo",
      });
      if (st.status !== "completed") throw new Error(st.error ?? "portrait failed");
      const o = st.outputs[0];
      const rel = o.subfolder ? `${o.subfolder}/${o.filename}` : o.filename;
      const dl = await fetch(`${AISERVER_URL}/outputs/${rel}`, { headers: aiHeaders });
      if (!dl.ok) throw new Error(`/outputs ${dl.status}`);
      const dir = mkdtempSync(join(tmpdir(), "cw-portrait-"));
      try {
        writeFileSync(join(dir, "p.mp4"), Buffer.from(await dl.arrayBuffer()));
        await run("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "p.mp4"), "-frames:v", "1", join(dir, "p.png")]);
        const key = `presenters/${p.user_id}/${presenterId}/portrait-${n}-${randomUUID()}.png`;
        await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: readFileSync(join(dir, "p.png")), ContentType: "image/png" }));
        keys.push(key);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    await sql`update presenters set portrait_keys = ${sql.json(keys)}, status = 'draft', error = null, updated_at = now() where id = ${presenterId}`;
  } catch (e) {
    await sql`update presenters set status = 'failed', error = ${"Couldn't make the faces — try again"}, updated_at = now() where id = ${presenterId}`;
    throw e;
  }
}

async function libraryAiBuild(presenterId) {
  const [p] = await sql`select * from presenters where id = ${presenterId}`;
  if (!p || !(p.kind === "ai" || userAi(p)) || p.status !== "queued" || !p.thumb_key) return;
  return settleBuild(p, async () => {
    try {
      await sql`update presenters set status = 'preparing', updated_at = now() where id = ${presenterId}`;
      await buildFromPortrait(p);
    } catch (e) {
      const msg = userAi(p) ? "Couldn't build this presenter — try again (credits refunded)" : "Couldn't build this presenter — try again";
      await sql`update presenters set status = 'failed', error = ${msg}, updated_at = now() where id = ${presenterId}`;
      throw e;
    }
  });
}

/** The portrait (thumb_key) speaks a neutral script in the presenter's voice → base footage (EchoMimic + Real-ESRGAN)
 *  → the presenter cache → ready. */
async function buildFromPortrait(p) {
  const presenterId = p.id;
  const image = await stageFile(p.thumb_key, "portrait.png", "image/png");
  const st = await runPresenterJob("echomimic-talking-v1", {
    source_image: image, text: BASE_SCRIPT, voice: p.voice, speed: 1, duration: 30, seed: randomInt(0, 2 ** 31), aspect: "9:16",
  }, 90 * 60_000);
  if (st.status !== "completed") throw new Error(`base footage: ${st.error ?? st.status}`);
  const o = st.outputs[0];
  const dl = await fetch(`${AISERVER_URL}/outputs/${o.subfolder ? `${o.subfolder}/` : ""}${o.filename}`, { headers: aiHeaders });
  if (!dl.ok) throw new Error(`/outputs ${dl.status}`);
  const raw = Buffer.from(await dl.arrayBuffer());
  let up = null;
  try {
    up = await runAiWorkflow("esrgan-upscale-v1", raw, presenterId);
  } catch (e) {
    console.warn(`[presenter] ${presenterId} upscale skipped: ${e?.message ?? e}`);
  }
  // Footage: the upscaled picture with the original speech (ESRGAN drops audio), H.264 25 fps.
  const dir = mkdtempSync(join(tmpdir(), "cw-aibase-"));
  const footageKey = `presenters/${p.user_id}/${presenterId}/footage-${randomUUID()}.mp4`;
  try {
    writeFileSync(join(dir, "raw.mp4"), raw);
    if (up) writeFileSync(join(dir, "up.mp4"), up);
    await run("ffmpeg", ["-v", "error", "-y", "-i", join(dir, up ? "up.mp4" : "raw.mp4"), "-i", join(dir, "raw.mp4"), "-map", "0:v:0", "-map", "1:a:0?",
      "-vf", "fps=25,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-ac", "1", "-shortest", join(dir, "f.mp4")]);
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: footageKey, Body: readFileSync(join(dir, "f.mp4")), ContentType: "video/mp4" }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  await sql`update presenters set footage_key = ${footageKey}, updated_at = now() where id = ${presenterId}`;
  await prepareLibrary({ ...p, footage_key: footageKey }, false);
}

async function libraryPrepare(presenterId) {
  const [p] = await sql`select * from presenters where id = ${presenterId}`;
  if (!p || p.kind !== "actor" || p.status !== "queued" || !p.footage_key || !p.release_ref) return;
  await sql`update presenters set status = 'preparing', updated_at = now() where id = ${presenterId}`;
  try {
    await prepareLibrary(p, true);
  } catch (e) {
    await sql`update presenters set status = 'failed', error = ${"Couldn't build this presenter — try again"}, updated_at = now() where id = ${presenterId}`;
    throw e;
  }
}

/** The presenter cache from the footage (no consent clip — see above), a thumbnail if asked, then ready. */
async function prepareLibrary(p, thumb) {
  const video = await stageFile(p.footage_key, "footage.mp4", "video/mp4");
  const st = await runPresenterJob("presenter-prepare-v1", { presenter_id: p.id, video });
  if (st.status !== "completed") {
    const reason = st.result?.user_error ?? "Couldn't build this presenter from the video";
    await sql`update presenters set status = 'failed', error = ${p.build_charge_id ? `${reason} (credits refunded)` : reason}, updated_at = now() where id = ${p.id}`;
    return;
  }
  let thumbKey = p.thumb_key;
  if (thumb) {
    const dir = mkdtempSync(join(tmpdir(), "cw-pthumb-"));
    try {
      writeFileSync(join(dir, "f.mp4"), await getBytes(p.footage_key));
      await run("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", join(dir, "f.mp4"), "-frames:v", "1", "-vf", "scale=-2:480", "-q:v", "3", join(dir, "t.jpg")]);
      const key = `presenters/${p.user_id}/${p.id}/thumb.jpg`;
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: readFileSync(join(dir, "t.jpg")), ContentType: "image/jpeg" }));
      thumbKey = key;
    } catch (e) {
      console.error(`[presenter] library ${p.id} thumbnail failed (presenter still built):`, e?.message ?? e);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const meta = { frames: st.result?.frames, width: st.result?.width, height: st.result?.height, missing: st.result?.missing };
  await sql`update presenters set status = 'ready', error = null, meta = ${sql.json(meta)}, thumb_key = ${thumbKey}, ready_at = now(), updated_at = now()
    where id = ${p.id} and status = 'preparing' and footage_key = ${p.footage_key}`;
  console.log(`[presenter] library ${p.kind} ${p.id} ready (${meta.frames} frames)`);
}

// Phase 2 — the presenter's own cloned voice: the voice consent clip is checked against the footage (code, sentence, face,
// voice match — presenter-consent-v1), then ~12 s of the footage's speech becomes the reference the voice service clones.
async function processVoice(presenterId) {
  const [p] = await sql`select * from presenters where id = ${presenterId}`;
  if (!p || p.status !== "ready" || p.voice_status !== "queued") return;
  const [consent] = await sql`select id, statement from presenter_consents where presenter_id = ${presenterId} and kind = 'voice' order by created_at desc limit 1`;
  if (!consent) throw new Error("no voice consent record");
  try {
    const video = await stageFile(p.footage_key, "footage.mp4", "video/mp4");
    const clip = await stageFile(p.voice_consent_key, "consent.mp4", "video/mp4");
    const st = await runPresenterJob("presenter-consent-v1", {
      presenter_id: presenterId, video, consent_clip: clip, consent_code: p.voice_consent_code, consent_statement: consent.statement,
    });
    const chk = st.result?.consent ?? null;
    if (chk) await sql`update presenter_consents set verified = ${!!chk.ok}, result = ${sql.json(chk)}, verified_at = ${chk.ok ? new Date() : null} where id = ${consent.id}`;
    if (st.status !== "completed" || !chk?.ok) {
      const reason = chk && !chk.ok ? chk.reason : "We couldn't check your voice — try again in a few minutes";
      await sql`update presenters set voice_status = 'failed', voice_error = ${reason}, updated_at = now() where id = ${presenterId}`;
      console.log(`[presenter] ${presenterId} voice failed: ${reason}`);
      return;
    }
    // Reference: 12 s of the footage's speech, from 1 s in (past any start-up silence), mono 24 kHz.
    const dir = mkdtempSync(join(tmpdir(), "cw-vref-"));
    const refKey = `presenters/${p.user_id}/${presenterId}/voice-ref.wav`;
    try {
      writeFileSync(join(dir, "f.mp4"), await getBytes(p.footage_key));
      await run("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-t", "12", "-i", join(dir, "f.mp4"), "-vn", "-ac", "1", "-ar", "24000", join(dir, "ref.wav")]);
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: refKey, Body: readFileSync(join(dir, "ref.wav")), ContentType: "audio/wav" }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const done = await sql`update presenters set voice_status = 'ready', voice_ref_key = ${refKey}, voice_error = null, voice_consent_code = null, updated_at = now()
      where id = ${presenterId} and voice_status = 'queued' and voice_consent_key = ${p.voice_consent_key} returning id`;
    console.log(`[presenter] ${presenterId} voice ${done.length ? "ready" : "changed meanwhile — not marked ready"} (voice match ${chk.voice_score})`);
  } catch (e) {
    await sql`update presenters set voice_status = 'failed', voice_error = ${"Something went wrong checking your voice — try again"}, updated_at = now() where id = ${presenterId}`;
    throw e;
  }
}

const presenterWorker = new Worker(
  PRESENTER_QUEUE,
  async (job) => {
    const staged = [];
    try {
      await stagedFiles.run(staged, () => processPresenter(job.data));
    } finally {
      for (const n of staged) await unstage(n);
    }
  },
  { connection, concurrency: 2, lockDuration: 5 * 60 * 1000 },
);
presenterWorker.on("failed", (job, err) => console.error(`[presenter] ${job?.data?.presenterId} ${job?.data?.action} failed:`, err?.message ?? err));
console.log(`[gen] presenter worker up (queue=${PRESENTER_QUEUE})`);

// Presenters left queued / preparing by a worker restart or a lost queue job never run again (every step only starts
// from "queued", and a re-run stalled job finds "preparing"): after 3 h (the longest build is ~20 min, the EchoMimic
// timeout 90 min) they're failed so the user can retry, and a photo / AI build's charge is settled — completed if the
// presenter did get built, else refunded. The app's deletePresenter uses the same 3 h.
async function sweepStuckPresenters() {
  const stuck = await sql`update presenters set status = 'failed', updated_at = now(),
      error = case when build_charge_id is not null then 'The build was interrupted — try again (credits refunded)' else 'The build was interrupted — try again' end
    where status in ('queued', 'preparing') and updated_at < now() - interval '3 hours' returning id`;
  for (const p of stuck) console.warn(`[presenter] ${p.id} stuck building > 3 h — marked failed`);
  const settled = await sql`update generation_jobs g set
      status = case when exists (select 1 from presenters p where p.build_charge_id = g.id and p.status = 'ready') then 'completed' else 'failed' end,
      error_message = case when exists (select 1 from presenters p where p.build_charge_id = g.id and p.status = 'ready') then null
        else 'Presenter build interrupted — refunded' end,
      updated_at = now()
    where g.job_type = 'presenter_build' and g.status = 'generating' and g.created_at < now() - interval '3 hours'
      and not exists (select 1 from presenters p where p.build_charge_id = g.id and p.status in ('queued', 'preparing')) returning g.id, g.status`;
  for (const g of settled) console.warn(`[presenter] build charge ${g.id} settled by the sweep → ${g.status}`);
}
const sweep = () => sweepStuckPresenters().catch((e) => console.error("[presenter] sweep failed:", e?.message ?? e));
void sweep();
setInterval(sweep, 10 * 60_000).unref();

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

// ─── Waltz AI Remix ─────────────────────────────────────────────────────────────────────────────
// Weave AI into a finished video (src/lib/remix-actions.ts): an AI LEAD-IN generated from the first
// frame and played in reverse, so it flows INTO the video's opening shot; AI MOMENTS that start on
// a chosen frame and replace a few seconds in place (same length, cuts stay on the beat); and an AI
// EXTENSION generated from the last frame. The song carries on under the AI parts: the source's
// position in its music track is found by matching the render's audio against the track.

// Image → AI clip on the AISERVER (same wrapper contract as processJob). null = job cancelled.
async function aiClipFromImage(png, { prompt, width, height, seconds, steps, workflow }, genJobId) {
  const fd = new FormData();
  fd.append("file", new Blob([png], { type: "image/png" }), "seed.png");
  const st = await fetch(`${AISERVER_URL}/inputs`, { method: "POST", headers: aiHeaders, body: fd });
  if (!st.ok) throw new Error(`stage /inputs ${st.status}: ${(await st.text()).slice(0, 200)}`);
  const sourceImage = (await st.json()).filename;
  const body = { workflow, inputs: {
    prompt, source_image: sourceImage, width, height, duration: seconds, length: framesForSeconds(seconds),
    motion: "balanced", seed: randomInt(0, 2 ** 32), negative_prompt: null, steps: steps ?? null,
  } };
  const sub = await fetch(`${AISERVER_URL}/jobs`, { method: "POST", headers: { ...aiHeaders, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!sub.ok) throw new Error(`/jobs ${sub.status}: ${(await sub.text()).slice(0, 200)}`);
  const providerJobId = (await sub.json()).job_id;
  const clock = providerClock(JOB_TIMEOUT_MS);
  let out = null;
  while (!clock.expired()) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (await wasCancelled(genJobId)) {
      await fetch(`${AISERVER_URL}/jobs/${providerJobId}/cancel`, { method: "POST", headers: aiHeaders }).catch(() => {});
      return null;
    }
    const pr = await fetch(`${AISERVER_URL}/jobs/${providerJobId}`, { headers: aiHeaders });
    if (!pr.ok) continue;
    const s = await pr.json();
    clock.observe(s.status);
    if (s.status === "completed") { out = s.outputs?.[0] ?? null; break; }
    if (s.status === "failed") throw new Error(`provider failed: ${s.error ?? "unknown"}`);
  }
  if (!out) throw new Error("AI clip timed out");
  const rel = out.subfolder ? `${out.subfolder}/${out.filename}` : out.filename;
  const dl = await fetch(`${AISERVER_URL}/outputs/${rel}`, { headers: aiHeaders });
  if (!dl.ok) throw new Error(`/outputs ${dl.status}`);
  return Buffer.from(await dl.arrayBuffer());
}

// AI working size for a frame shape (divisible by 16; same shapes the Waltz AI tab offers).
function aiDims(w, h) {
  const r = w / h;
  return Math.abs(r - 1) < 0.15 ? { w: 768, h: 768 } : r > 1 ? { w: 1280, h: 720 } : { w: 720, h: 1280 };
}

async function probeFile(p) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", p]);
  const j = JSON.parse(stdout);
  const v = (j.streams ?? []).find((s) => s.codec_type === "video") ?? {};
  const [fn, fd] = String(v.r_frame_rate ?? "30/1").split("/").map(Number);
  return { width: Number(v.width), height: Number(v.height), fps: fd ? fn / fd : 30,
    duration: Number(j.format?.duration) || 0, hasAudio: (j.streams ?? []).some((s) => s.codec_type === "audio") };
}

// Onset curve (8 ms hops) of an audio span, mean-removed — for aligning a render with its song.
async function onsetCurve(file, start, dur) {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", String(start), "-t", String(dur), "-i", file, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
    { maxBuffer: 1 << 26, encoding: "buffer" });
  const b = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, "binary");
  const n = Math.floor(b.length / 2), hop = 64, env = [];
  for (let i = 0; i + hop <= n; i += hop) { let s = 0; for (let k = 0; k < hop; k++) s += Math.abs(b.readInt16LE((i + k) * 2)); env.push(Math.log1p(s / hop)); }
  const on = env.map((e, i) => (i ? Math.max(0, e - env[i - 1]) : 0));
  const m = on.reduce((a, x) => a + x, 0) / (on.length || 1);
  return on.map((x) => x - m);
}
// Where in `music` the render's audio is playing: the music time at render t=0, or null.
async function musicOffsetOf(renderFile, musicFile, t = 1.0) {
  const win = 8, search = 20, hopSec = 64 / 8000;
  const a = await onsetCurve(renderFile, t, win);
  const m = await onsetCurve(musicFile, 0, t + win + search);
  if (a.length < 50 || m.length < a.length) return null;
  const na = Math.hypot(...a);
  let best = -1, bestLag = 0;
  const score = [];
  for (let lag = 0; lag + a.length <= m.length; lag++) {
    let dot = 0, nm = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * m[lag + i]; nm += m[lag + i] * m[lag + i]; }
    const c = dot / (na * Math.sqrt(nm) + 1e-9);
    score.push(c);
    if (c > best) { best = c; bestLag = lag; }
  }
  const second = Math.max(-1, ...score.filter((_, lag) => Math.abs(lag - bestLag) > 40));
  if (best < 0.5 || best - second < 0.1) return null; // no confident match (e.g. original audio dominates)
  return bestLag * hopSec - t;
}

async function processRemix(j, req, genJobId) {
  const src = req.source;
  await setStatus(genJobId, { status: "preparing", progress: 5, started_at: new Date() });
  const dir = mkdtempSync(join(tmpdir(), "cw-remix-"));
  try {
    const srcPath = join(dir, "src.mp4");
    writeFileSync(srcPath, await getBytes(src.key));
    const S = await probeFile(srcPath);
    if (!S.width || !S.duration) throw new Error("source video unreadable");
    const W = S.width - (S.width % 2), H = S.height - (S.height % 2), F = Math.round(S.fps * 1000) / 1000;
    const ai = aiDims(W, H);
    // Renders fade in from / out to black: seed from just inside the fades and trim them off.
    const isRender = src.kind === "render";
    const t0 = req.leadIn ? (isRender ? 0.6 : 0.05) : 0;
    const t1 = req.extend ? Math.max(t0 + 1, S.duration - (isRender ? 0.8 : 0.05)) : S.duration;
    const moments = (req.moments ?? []).filter((m) => m.at >= t0 && m.at + 0.5 < t1);

    const style = req.stylePhrase ? `, ${req.stylePhrase}` : "";
    const segs = [];
    if (req.leadIn) segs.push({ kind: "lead", at: t0, seconds: req.leadIn.seconds,
      prompt: `${req.leadIn.prompt || "the camera slowly pulls back, revealing the wider scene"}${style}` });
    for (const m of moments) segs.push({ kind: "moment", at: m.at, seconds: m.seconds,
      prompt: `${m.prompt || "the scene comes alive with vivid, natural motion"}${style}` });
    if (req.extend) segs.push({ kind: "ext", at: t1 - 1 / F, seconds: req.extend.seconds,
      prompt: `${req.extend.prompt || "the action continues naturally, the camera keeps moving forward"}${style}` });
    if (!segs.length) throw new Error("nothing to remix (moments fall outside the video)");

    // Seed frames (cropped to the AI working shape). A watermarked source has the logo burned in: erase
    // it first, or the i2v model redraws it and a warped ghost shows around the fresh logo.
    const b = src.watermarked ? wmBox(S.width, S.height) : null;
    const delogo = b ? `delogo=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h},` : "";
    for (const [i, g] of segs.entries()) {
      g.png = join(dir, `seed${i}.png`);
      await run("ffmpeg", ["-y", "-v", "error", "-ss", Math.max(0, g.at).toFixed(3), "-i", srcPath, "-frames:v", "1",
        "-vf", `${delogo}scale=${ai.w}:${ai.h}:force_original_aspect_ratio=increase,crop=${ai.w}:${ai.h}`, g.png]);
    }

    // Generate the AI parts, two at a time (one per GPU).
    await setStatus(genJobId, { status: "generating", progress: 15 });
    let done = 0;
    const pending = [...segs];
    const lanes = Array.from({ length: Math.min(2, pending.length) }, async () => {
      for (let g = pending.shift(); g; g = pending.shift()) {
        const bytes = await aiClipFromImage(readFileSync(g.png), { prompt: g.prompt, width: ai.w, height: ai.h, seconds: g.seconds, steps: req.steps, workflow: req.workflow }, genJobId);
        if (!bytes) { g.cancelled = true; return; }
        g.file = join(dir, `ai-${segs.indexOf(g)}.mp4`);
        writeFileSync(g.file, bytes);
        done++;
        await setStatus(genJobId, { progress: 15 + Math.round((done / segs.length) * 60) });
      }
    });
    await Promise.all(lanes);
    if (segs.some((g) => g.cancelled) || await wasCancelled(genJobId)) { console.log("[remix] cancelled", genJobId); return; }

    // Music continuity (renders with a known track).
    let musicPath = null, off = null;
    if (src.musicKey && S.hasAudio) {
      musicPath = join(dir, "music" + (src.musicKey.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp3"));
      writeFileSync(musicPath, await getBytes(src.musicKey));
      off = await musicOffsetOf(srcPath, musicPath).catch(() => null);
      if (off == null) musicPath = null;
      console.log(`[remix] ${genJobId} music offset ${off == null ? "not found (AI parts get silence)" : off.toFixed(3) + "s"}`);
    }

    // Compose: [lead-in] + [source with moments overlaid in place] + [extension] (worker/remix-compose.mjs:
    // re-encodes only the changed spans and stream-copies the rest; full re-encode as the fallback).
    await setStatus(genJobId, { status: "encoding", progress: 80 });
    const lead = segs.find((g) => g.kind === "lead"), ext = segs.find((g) => g.kind === "ext");
    const mom = segs.filter((g) => g.kind === "moment");
    const composeStart = Date.now();
    const { outPath, brandedPath, mode, encodedFrames, copiedFrames } = await composeRemix({
      dir, srcPath, S, t0, t1, lead, ext, moments: mom,
      music: musicPath ? { path: musicPath, off, dur: (await probeFile(musicPath)).duration || 0 } : null,
      watermark: !!req.watermark, srcWatermarked: !!src.watermarked,
    });
    console.log(`[remix] ${genJobId} composed (${mode}${mode === "splice" ? `: ${encodedFrames} frames encoded, ${copiedFrames} copied` : ""}) in ${Math.round((Date.now() - composeStart) / 1000)}s`);
    if (await wasCancelled(genJobId)) { console.log("[remix] cancelled before save", genJobId); return; }

    // Store (clean master + logo) and add the version.
    await setStatus(genJobId, { status: "uploading_output", progress: 90 });
    const composed = readFileSync(outPath);
    const [{ maxv }] = await sql`select coalesce(max(version_number),0)::int maxv from generation_versions where project_id = ${j.project_id}`;
    const n = (maxv ?? 0) + 1;
    const base = `generations/${j.project_id}/${genJobId}/${n}`;
    const put = (Key, Body) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body, ContentType: "video/mp4" }));
    const output_key = `${base}.mp4`;
    let clean_key = null;
    if (req.watermark) {
      await put(`${base}.clean.mp4`, composed);
      clean_key = `${base}.clean.mp4`;
      await put(output_key, readFileSync(brandedPath));
    } else {
      await put(output_key, composed);
    }
    const meta = await probeVideo(composed).catch(() => ({}));
    await insertVersion(j.project_id, {
      id: randomUUID(), generation_job_id: genJobId, project_id: j.project_id, scene_id: null,
      version_number: n, output_key, clean_key, duration_sec: meta.duration ?? null,
      settings: { remix: true, source: { kind: src.kind, id: src.id, projectId: src.projectId, label: src.label },
        leadIn: req.leadIn ?? null, moments: mom.map((g) => ({ at: g.at, seconds: g.seconds })), extend: req.extend ?? null,
        musicOffset: off, width: meta.width || null, height: meta.height || null, fps: meta.fps ?? null },
    });
    await setStatus(genJobId, { status: "completed", progress: 100, completed_at: new Date() });
    console.log(`[remix] ${genJobId} done → ${output_key} (${segs.length} AI parts, ${(meta.duration ?? 0).toFixed(1)}s)`);
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
  if (j.job_type === "remix") return processRemix(j, req, genJobId);
  if (!req.sourceKey) throw new Error("no sourceKey on enhancement job");
  const ai = req.engine === "ai" || req.engine === "restore";
  await setStatus(genJobId, { status: "enhancing", progress: 40, started_at: new Date() }); // UI: "Enhancing detail" (was "Building motion" for AI engines)

  const videoBytes = ai ? await aiEnhance(req, genJobId) : await ffmpegEnhance(req);
  if (await wasCancelled(genJobId)) { console.log("[enh] cancelled mid-run, result dropped", genJobId); return; }

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
  if (await wasCancelled(genJobId)) { console.log("[enh] storyboard cancelled mid-run, result dropped", genJobId); return; }
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

// WaltzDeck: media descriptions, storyboard planning, scene rewrites (worker/deck/jobs.mjs).
startDeckWorker({
  sql, getBytes, run, redisUrl: REDIS_URL,
  putBytes: (Key, Body, ContentType) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body, ContentType })),
  deleteKey: (Key) => s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key })),
});

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
