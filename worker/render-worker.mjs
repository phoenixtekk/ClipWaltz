#!/usr/bin/env node
// ClipWaltz render worker.
// Claims a queued render, pulls the project's clips from MinIO, and assembles a music
// video with FFmpeg. Editor Phase 1 (aspect, Ken Burns, filters, fades, crossfade, title)
// PLUS smart editing: motion-based active-moment selection for videos (skip the dead/
// static parts), face/scene-aware re-ranking of those windows via the AI-box vision model
// (Ollama, best-effort), and beat-synced cuts aligned to the music (aubiotrack).
//
//   node --env-file=.env.worker worker/render-worker.mjs [--once]
//
// Prod host: the AI box. Needs DATABASE_URL (SSH tunnel to linuxg1:5432), S3_* for MinIO,
// ffmpeg/ffprobe, and aubiotrack (aubio-tools) for beat detection.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const run = promisify(execFile);
const ONCE = process.argv.includes("--once");
const POLL_MS = 5000;
const PER_IMAGE = 2;
const PER_VIDEO = 4;

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://192.168.166.169:9000",
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "",
  },
});
const BUCKET = process.env.S3_BUCKET ?? "clipwaltz";
const fwd = (p) => p.replace(/\\/g, "/");

// Face/scene-aware selection: score candidate frames with the AI-box vision model
// (Ollama). Empty OLLAMA_URL disables it → falls back to pure motion. (CLAUDE.md AI box.)
const OLLAMA_URL = (process.env.OLLAMA_URL ?? "").replace(/\/$/, "");
// Use a NON-reasoning vision model — reasoning ones (e.g. qwen3-vl) emit to a separate
// `thinking` field and leave `response` empty (CLAUDE.md). qwen2.5vl:7b scores cleanly.
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5vl:7b";
const VISION_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 20000);
const CAND_WINDOWS = 3; // top motion windows to re-rank by subject/faces

// "Video ready" email: the app (linuxg1) holds the SES creds, so the worker just pings it.
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");
const WORKER_CALLBACK_SECRET = process.env.WORKER_CALLBACK_SECRET ?? "";
async function notifyReady(renderId) {
  if (!APP_URL || !WORKER_CALLBACK_SECRET) return;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${APP_URL}/api/internal/render-ready`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-secret": WORKER_CALLBACK_SECRET },
      body: JSON.stringify({ renderId }),
      signal: ctrl.signal,
    });
    console.log(`[worker] notify render-ready ${renderId}: ${res.status}`);
  } catch (e) {
    console.log(`[worker] notify render-ready ${renderId} failed: ${e.message}`);
  } finally {
    clearTimeout(to);
  }
}

function dims(aspect) {
  return aspect === "16:9" ? [1920, 1080] : [1080, 1920];
}
function vfStatic(W, H) {
  return `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
}
function vfKenBurns(W, H, frames) {
  return (
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},scale=${W * 2}:${H * 2},` +
    `zoompan=z='min(zoom+0.0009,1.22)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=30,setsar=1`
  );
}
function colorFilter(style) {
  switch (style) {
    case "warm": return "eq=gamma_r=1.06:gamma_b=0.95:saturation=1.1";
    case "cool": return "eq=gamma_r=0.95:gamma_b=1.06:saturation=1.06";
    case "vivid": return "eq=saturation=1.35:contrast=1.08";
    case "bw": return "hue=s=0";
    case "vintage": return "curves=preset=vintage,eq=saturation=0.92";
    default: return null;
  }
}
// Atmospheric "lighting" looks, applied on top of the colour filter. Single-chain safe.
function lightFilter(fx) {
  switch (fx) {
    case "vignette": return "vignette=PI/4.5";
    case "glow": return "curves=preset=increase_contrast,eq=gamma_r=1.08:gamma_b=0.92:saturation=1.12,vignette=PI/6";
    case "grain": return "noise=alls=10:allf=t+u,vignette=PI/6";
    case "dreamy": return "gblur=sigma=1.6,eq=brightness=0.03:saturation=1.06";
    case "noir": return "hue=s=0,eq=contrast=1.2,vignette=PI/4";
    default: return null;
  }
}
function safeText(s) {
  return String(s || "").replace(/[^A-Za-z0-9 .,!?&#@()\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

async function download(key, file) {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  writeFileSync(file, Buffer.from(await out.Body.transformToByteArray()));
}
async function ffmpeg(args) {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 1024 * 1024 * 32 });
}
async function probe(file) {
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", file],
      { maxBuffer: 1024 * 1024 },
    );
    return parseFloat(String(stdout).trim()) || 0;
  } catch {
    return 0;
  }
}

// Per-second music energy curve, normalized 0..1 (loud → 1). [] if unavailable.
async function getEnergyCurve(musicFile) {
  try {
    const { stdout, stderr } = await run(
      "ffmpeg",
      ["-i", musicFile, "-af", "asetnsamples=n=44100,astats=metadata=1:reset=1,ametadata=print:file=-", "-f", "null", "-"],
      { maxBuffer: 1024 * 1024 * 16 },
    );
    const text = String(stdout) + String(stderr);
    const times = [...text.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
    const db = [...text.matchAll(/Overall\.RMS_level=(-?[\d.]+)/g)].map((m) => +m[1]);
    const n = Math.min(times.length, db.length);
    if (n < 2) return [];
    const vals = db.slice(0, n).filter((x) => Number.isFinite(x));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const curve = [];
    for (let i = 0; i < n; i++) {
      curve.push({ t: times[i], e: Number.isFinite(db[i]) ? Math.max(0, Math.min(1, (db[i] - min) / range)) : 0.5 });
    }
    return curve;
  } catch {
    return [];
  }
}

function energyAt(curve, t) {
  if (!curve.length) return 0.5;
  let best = curve[0];
  for (const c of curve) {
    if (Math.abs(c.t - t) < Math.abs(best.t - t)) best = c;
    if (c.t > t + 1) break;
  }
  return best.e;
}

// Count video streams in a file (Insta360 dual-fisheye = 2, single = 1).
async function probeVideoStreams(file) {
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-select_streams", "v", "-show_entries", "stream=index", "-of", "csv=p=0", file],
      { maxBuffer: 1024 * 1024 },
    );
    return String(stdout).trim().split(/\s+/).filter(Boolean).length;
  } catch {
    return 1;
  }
}

// Motion-driven yaw path (deg over time) for AutoReframe "follow": sample small equirect
// frames, track the busiest horizontal region, smooth + rate-limit into a pan. [] on failure.
async function computeYawPath(src, streams) {
  const W = 64, H = 32, FPS = 2;
  const hstack = streams >= 2 ? "[0:v:0][0:v:1]hstack=inputs=2," : "[0:v:0]";
  const proj = streams >= 2 ? "v360=dfisheye:e:ih_fov=200:iv_fov=200:roll=90" : "v360=fisheye:e:ih_fov=200:iv_fov=200";
  try {
    const { stdout } = await run(
      "ffmpeg",
      ["-i", src, "-filter_complex", `${hstack}${proj},scale=${W}:${H},format=gray,fps=${FPS}`, "-f", "rawvideo", "-"],
      { maxBuffer: 1024 * 1024 * 512, encoding: "buffer" },
    );
    const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, "binary");
    const frameSize = W * H;
    const nFrames = Math.floor(buf.length / frameSize);
    if (nFrames < 2) return [];
    const raw = [];
    for (let f = 1; f < nFrames; f++) {
      const off = f * frameSize;
      const prev = (f - 1) * frameSize;
      const col = new Array(W).fill(0);
      for (let y = 0; y < H; y++) {
        const row = off + y * W;
        const prow = prev + y * W;
        for (let x = 0; x < W; x++) col[x] += Math.abs(buf[row + x] - buf[prow + x]);
      }
      let peak = 0;
      for (let x = 1; x < W; x++) if (col[x] > col[peak]) peak = x; // argmax column
      raw.push({ t: f / FPS, yaw: (peak / W) * 360 - 180 });
    }
    // smooth (moving average) + rate-limit for a natural pan
    const out = [];
    const win = 4;
    const maxStep = 20 / FPS;
    for (let i = 0; i < raw.length; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - win); j <= Math.min(raw.length - 1, i + win); j++) { s += raw[j].yaw; c++; }
      let yaw = s / c;
      if (out.length) {
        const p = out[out.length - 1].yaw;
        yaw = Math.max(p - maxStep, Math.min(p + maxStep, yaw));
      }
      out.push({ t: raw[i].t, yaw });
    }
    return out;
  } catch {
    return [];
  }
}

// Reproject a library media file (Insta360 .insv/.lrv/.insp) to a flat clip/photo per its
// reframeMode (flat | follow | tiny) using ffmpeg v360. Convert once, reuse across projects.
async function convertMedia(m) {
  const dir = mkdtempSync(join(tmpdir(), "cw-conv-"));
  try {
    const inExt = (m.original_name?.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "") || "bin";
    const src = join(dir, `src.${inExt}`);
    await download(m.storage_key, src);
    const isPhoto = m.source_format === "insp" || m.kind === "photo";
    const streams = await probeVideoStreams(src);
    const mode = m.reframe_mode || "flat";
    const hstack = streams >= 2 ? "[0:v:0][0:v:1]hstack=inputs=2," : "[0:v:0]";
    const proj = streams >= 2 ? "dfisheye:ih_fov=200:iv_fov=200:roll=90" : "fisheye:ih_fov=200:iv_fov=200";

    let vf;
    if (mode === "tiny") {
      vf = `${hstack}v360=${proj.replace(":", ":ball:")}:w=1080:h=1080`; // little-planet
    } else if (mode === "follow" && !isPhoto) {
      const path = await computeYawPath(src, streams);
      if (path.length) {
        const cmds = path.map((p) => `${p.t.toFixed(2)} v360@rf yaw ${p.yaw.toFixed(1)};`).join("\n");
        writeFileSync(join(dir, "cmds.txt"), cmds);
        // Two-stage: level the equirect first (roll only levels at yaw=0), then reframe by yaw.
        const level = `v360=${proj.replace(":", ":e:")}`; // e.g. dfisheye:e:...:roll=90
        vf = `${hstack}${level},sendcmd=f=${fwd(join(dir, "cmds.txt"))},v360@rf=input=e:output=flat:h_fov=110:v_fov=100:w=1920:h=1080`;
      }
    }
    if (!vf) vf = `${hstack}v360=${proj.replace(":", ":flat:")}:h_fov=110:v_fov=100:w=1920:h=1080`;

    let outKey;
    if (isPhoto) {
      const out = join(dir, "flat.jpg");
      await ffmpeg(["-i", src, "-filter_complex", `${vf},format=yuvj420p`, "-frames:v", "1", "-q:v", "3", out]);
      outKey = `media/${m.id}-flat.jpg`;
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: outKey, Body: readFileSync(out), ContentType: "image/jpeg" }));
      await sql`update media set converted_key=${outKey}, conversion_state='ready', kind='photo' where id=${m.id}`;
      await sql`update assets set converted_key=${outKey}, conversion_state='ready', kind='photo' where media_id=${m.id}`;
    } else {
      const out = join(dir, "flat.mp4");
      await ffmpeg([
        "-i", src,
        "-filter_complex", `${vf},format=yuv420p[v]`,
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        out,
      ]);
      outKey = `media/${m.id}-flat.mp4`;
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: outKey, Body: readFileSync(out), ContentType: "video/mp4" }));
      await sql`update media set converted_key=${outKey}, conversion_state='ready', kind='video' where id=${m.id}`;
      await sql`update assets set converted_key=${outKey}, conversion_state='ready', kind='video' where media_id=${m.id}`;
    }
    console.log(`[worker] converted 360 media ${m.id} (${streams} lens, ${mode}) → ${outKey}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function claimConversion() {
  const rows = await sql`
    update media set conversion_state='converting'
    where id = (select id from media where conversion_state='pending'
                order by created_at asc limit 1 for update skip locked)
    returning *`;
  return rows[0] ?? null;
}
async function convTick() {
  const m = await claimConversion();
  if (!m) return false;
  try {
    await convertMedia(m);
  } catch (e) {
    console.error(`[worker] convert media ${m.id} FAILED:`, e.message);
    await sql`update media set conversion_state='failed' where id=${m.id}`;
    await sql`update assets set conversion_state='failed' where media_id=${m.id}`;
  }
  return true;
}

// Beat timestamps (seconds) from aubiotrack; [] if unavailable.
async function getBeats(musicFile) {
  try {
    const { stdout } = await run("aubiotrack", ["-i", musicFile], { maxBuffer: 1024 * 1024 * 8 });
    return String(stdout)
      .split(/\s+/)
      .map((x) => parseFloat(x))
      .filter((x) => Number.isFinite(x));
  } catch {
    return [];
  }
}

// Generate a YouTube-style description via the AI-box text model. null on failure.
const OLLAMA_TEXT_MODEL = process.env.OLLAMA_TEXT_MODEL ?? "qwen3.8:27b";
async function generateDescription({ title, musicTitle, clips, lengthSec, aspect }) {
  if (!OLLAMA_URL) return null;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 60000);
  try {
    const prompt =
      `Write a YouTube video description for a short ${aspect} montage video made with ClipWaltz` +
      `${lengthSec ? ` (about ${lengthSec}s)` : ""}. Title: "${title}". ` +
      `Soundtrack: "${musicTitle || "original audio"}". It has ${clips} clips. ` +
      `Write an engaging 2-3 sentence description, then a blank line, then a single line of 5-8 relevant hashtags, ` +
      `then a final line "Made with ClipWaltz". Plain text only — no markdown, no preamble.`;
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_TEXT_MODEL, prompt, stream: false, options: { num_predict: 500, temperature: 0.7 } }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const j = await res.json();
    const text = String(j.response || "").trim();
    return text.length > 10 ? text.slice(0, 5000) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

// Extract one JPEG frame at `at` seconds (for vision scoring).
async function extractFrame(src, at, out) {
  await ffmpeg(["-ss", String(Math.max(0, at)), "-i", src, "-frames:v", "1", "-vf", "scale=384:-1", "-q:v", "4", out]);
}

// Score a frame 0..1 as a highlight (clear people/faces, focus, lighting, subject) via the
// AI-box vision model. Returns null on any failure so callers fall back to motion.
async function visionScore(imgPath) {
  if (!OLLAMA_URL) return null;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS);
  try {
    const b64 = readFileSync(imgPath).toString("base64");
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt:
          'Rate this video frame as a highlight thumbnail from 0 to 1. Prefer frames with clearly ' +
          'visible people or faces, sharp focus, good lighting and an obvious subject; penalize blurry, ' +
          'dark, empty or transitional frames. Respond ONLY as JSON: {"score": <0..1>, "faces": <int>}.',
        images: [b64],
        stream: false,
        format: "json",
        options: { num_predict: 256, temperature: 0 },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const j = await res.json();
    const parsed = JSON.parse(j.response || "{}");
    let sc = Number(parsed.score);
    if (!Number.isFinite(sc)) return null;
    sc = Math.max(0, Math.min(1, sc));
    const faces = Number(parsed.faces) || 0;
    return Math.min(1, sc + (faces > 0 ? 0.1 : 0)); // nudge toward frames with faces
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

// Pick the best `need`-second window of a video. Motion frame-diff finds active windows
// (skips dead/static/black parts); when vision is enabled, the top motion windows are
// re-ranked by subject/faces so the cut lands on a moment with people, not just movement.
async function pickWindow(src, need, srcDur) {
  if (!need || srcDur <= need + 0.3) return 0;
  try {
    const { stdout } = await run(
      "ffmpeg",
      ["-i", src, "-vf", "fps=4,scale=160:-1,tblend=all_mode=difference,signalstats,metadata=print:file=-", "-an", "-f", "null", "-"],
      { maxBuffer: 1024 * 1024 * 32 },
    );
    const times = [...String(stdout).matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
    const ys = [...String(stdout).matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1]);
    const n = Math.min(times.length, ys.length);
    if (n < 4) return 0;
    const win = Math.max(1, Math.round(need * 4)); // 4 fps samples

    const windows = [];
    for (let i = 0; i + win <= n; i++) {
      if (times[i] > srcDur - need) break;
      let sum = 0;
      for (let j = i; j < i + win; j++) sum += ys[j];
      windows.push({ t: times[i], sum });
    }
    if (windows.length === 0) return 0;
    windows.sort((a, b) => b.sum - a.sum);
    const motionBest = Math.max(0, Math.min(windows[0].t, srcDur - need));
    const maxSum = windows[0].sum || 1;

    // Vision re-rank: score the midpoint frame of the top distinct motion windows.
    if (OLLAMA_URL && windows.length > 1) {
      const cands = [];
      for (const w of windows) {
        if (cands.length >= CAND_WINDOWS) break;
        if (cands.every((c) => Math.abs(c.t - w.t) >= need)) cands.push(w);
      }
      let best = motionBest;
      let bestScore = -1;
      let scored = false;
      for (let k = 0; k < cands.length; k++) {
        const c = cands[k];
        const fp = `${src}.cand${k}.jpg`;
        let vs = null;
        try {
          await extractFrame(src, Math.min(srcDur - 0.1, c.t + need / 2), fp);
          vs = await visionScore(fp);
        } catch {
          vs = null;
        }
        if (vs != null) {
          scored = true;
          const combined = 0.5 * (c.sum / maxSum) + 0.5 * vs;
          if (combined > bestScore) {
            bestScore = combined;
            best = Math.max(0, Math.min(c.t, srcDur - need));
          }
        }
      }
      if (scored) {
        console.log(`[worker] scene-aware window ${best.toFixed(1)}s (motion-only was ${motionBest.toFixed(1)}s)`);
        return best;
      }
    }
    return motionBest;
  } catch {
    return 0;
  }
}

// Beats per cut from energy: louder → faster cuts, calmer → longer holds.
function waltzSpan(e) {
  return e >= 0.66 ? 2 : e >= 0.33 ? 3 : 4;
}

// Build the ordered timeline: [{asset, dur, offset}]. Beat-synced when possible.
async function buildTimeline(assets, beats, lengthSec, beatSync, smartCut, srcDurs, waltzToMusic, curve) {
  const slots = [];
  let musicOffset = 0;
  const cap = lengthSec > 0 ? lengthSec : Infinity;

  // "Waltz to the Music": energy-aware, beat-snapped cadence that ends on a beat.
  if (waltzToMusic && beats.length > 5) {
    musicOffset = beats[0];
    let bi = 0;
    let total = 0;
    for (const asset of assets) {
      if (bi >= beats.length - 1) break;
      const span = waltzSpan(energyAt(curve, beats[bi]));
      let endIdx = Math.min(bi + span, beats.length - 1);
      let dur = beats[endIdx] - beats[bi];
      if (dur < 0.4 && bi + 1 < beats.length) {
        endIdx = bi + 1;
        dur = beats[endIdx] - beats[bi];
      }
      if (total + dur > cap) break; // stop on a whole beat span → ending lands on a beat
      slots.push({ asset, dur });
      total += dur;
      bi = endIdx;
      if (total >= cap) break;
    }
  }

  if (slots.length === 0 && beatSync && beats.length > 5) {
    const iv = [];
    for (let i = 1; i < beats.length; i++) iv.push(beats[i] - beats[i - 1]);
    iv.sort((a, b) => a - b);
    const bi = iv[Math.floor(iv.length / 2)] || 0.5;
    const bpc = Math.max(1, Math.round(2.2 / bi)); // ~2.2s per clip, snapped to whole beats
    musicOffset = beats[0];
    let total = 0;
    for (let a = 0; a < assets.length; a++) {
      const startBeat = beats[a * bpc];
      const endBeat = beats[(a + 1) * bpc];
      if (startBeat == null || endBeat == null) break;
      let dur = endBeat - startBeat;
      if (total + dur > cap) {
        dur = cap - total;
        if (dur < 0.4) break;
      }
      slots.push({ asset: assets[a], dur });
      total += dur;
      if (total >= cap) break;
    }
  }

  // Fallback / no-music: fixed cadence capped to length.
  if (slots.length === 0) {
    let total = 0;
    for (const a of assets) {
      const remaining = cap - total;
      if (remaining <= 0) break;
      const full = a.kind === "video" ? PER_VIDEO : PER_IMAGE;
      const dur = Math.min(full, remaining);
      slots.push({ asset: a, dur });
      total += dur;
    }
  }

  // Fill toward the target length. When there isn't enough content to reach `cap` (e.g. one
  // short clip), keep adding segments by cycling the assets and — for videos — walking DIFFERENT
  // windows across the clip (tiling), so a single video becomes a montage of its own moments.
  let total = slots.reduce((s, x) => s + x.dur, 0);
  if (cap !== Infinity && assets.length > 0 && total < cap - 0.4) {
    const fillDur = Math.max(1.5, Math.min(4, slots.length ? total / slots.length : PER_VIDEO));
    const MAX_SLOTS = 400;
    const vcur = new Map(); // per-video tiling cursor (window index)
    let i = 0;
    while (total < cap - 0.4 && slots.length < MAX_SLOTS) {
      const a = assets[i % assets.length];
      i++;
      let dur = Math.min(fillDur, cap - total);
      if (dur < 0.4) break;
      let offset = 0;
      if (a.kind === "video") {
        const D = srcDurs.get(a.storage_key) ?? 0;
        if (D > dur) {
          const nWin = Math.max(1, Math.floor(D / dur));
          const w = vcur.get(a.storage_key) ?? 0;
          offset = Math.min(D - dur, w * dur);
          vcur.set(a.storage_key, (w + 1) % nWin);
        }
      }
      slots.push({ asset: a, dur, offset }); // offset preset → skipped by the resolver below
      total += dur;
    }
  }

  // Resolve active-moment offsets for video slots that don't already have a (tiled) offset.
  for (const s of slots) {
    if (s.offset !== undefined) continue;
    if (s.asset.kind === "video" && smartCut) {
      s.offset = await pickWindow(s.asset._src, s.dur, srcDurs.get(s.asset.storage_key) ?? 0);
    } else {
      s.offset = 0;
    }
  }
  return { slots, musicOffset };
}

// --- Text + emoji overlays (second pass) ------------------------------------
function emojiCodepoints(str) {
  const cps = [];
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c !== 0xfe0f) cps.push(c.toString(16)); // Twemoji drops the FE0F variation selector
  }
  return cps;
}
async function fetchTwemoji(char, dest) {
  const name = emojiCodepoints(char).join("-");
  if (!name) return false;
  const urls = [
    `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${name}.png`,
    `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${name}.png`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}
function nearestBeat(t, beats) {
  if (!beats.length) return t;
  let best = beats[0];
  for (const b of beats) if (Math.abs(b - t) < Math.abs(best - t)) best = b;
  return best;
}
function overlayTiming(o, beats, totalDur) {
  let start = o.start != null ? o.start : 0;
  if (o.beatSnap) start = nearestBeat(start, beats);
  const end = o.end != null ? o.end : totalDur;
  return { ts: Math.max(0, start).toFixed(2), te: Math.max(start + 0.1, end).toFixed(2) };
}
function textDraw(o, H, beats, totalDur) {
  const { ts, te } = overlayTiming(o, beats, totalDur);
  const fs = Math.round(o.size * H);
  const color = `0x${String(o.color).replace("#", "")}`;
  const baseX = `w*${o.x}-tw/2`;
  const x = o.anim === "slide" ? `(${baseX})+(1-min(1,max(0,(t-${ts})/0.5)))*w*0.25` : baseX;
  const p = [`text='${safeText(o.content)}'`, `fontcolor=${color}`, `fontsize=${fs}`];
  if (o.box) p.push("box=1", "boxcolor=black@0.45", "boxborderw=10");
  p.push(`x='${x}'`, `y='h*${o.y}-th/2'`, `enable='between(t,${ts},${te})'`);
  if (o.anim === "fade") p.push(`alpha='min(1,max(0,(t-${ts})/0.4))'`);
  else if (o.anim === "pop") p.push(`alpha='min(1,max(0,(t-${ts})/0.15))'`);
  return `drawtext=${p.join(":")}`;
}

async function applyOverlays(dir, inFile, overlays, W, H, beats, totalDur) {
  const texts = overlays.filter((o) => o.type === "text");
  const emojis = [];
  let ei = 0;
  for (const o of overlays) {
    if (o.type !== "emoji") continue;
    const f = join(dir, `emoji${ei}.png`);
    if (await fetchTwemoji(o.content, f)) emojis.push({ o, file: f });
    ei++;
  }
  if (texts.length === 0 && emojis.length === 0) return inFile;

  const args = ["-i", fwd(inFile)];
  for (const e of emojis) args.push("-i", fwd(e.file));

  let label = "[0:v]";
  let fc = "";
  let n = 0;
  for (const o of texts) {
    fc += `${label}${textDraw(o, H, beats, totalDur)}[o${n}];`;
    label = `[o${n}]`;
    n++;
  }
  emojis.forEach((e, i) => {
    const inIdx = 1 + i;
    const { ts, te } = overlayTiming(e.o, beats, totalDur);
    const h = Math.round(e.o.size * H);
    const fade = e.o.anim === "none" ? "" : `,fade=t=in:st=${ts}:d=0.4:alpha=1`;
    fc += `[${inIdx}:v]scale=-1:${h},format=rgba${fade}[e${n}];`;
    fc += `${label}[e${n}]overlay=x='W*${e.o.x}-w/2':y='H*${e.o.y}-h/2':enable='between(t,${ts},${te})'[o${n}];`;
    label = `[o${n}]`;
    n++;
  });

  const out = join(dir, "overlaid.mp4");
  args.push(
    "-filter_complex",
    fc.replace(/;$/, ""),
    "-map",
    label,
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    fwd(out),
  );
  await ffmpeg(args);
  return out;
}

async function assemble(dir, assets, music, watermark, lengthSec, aspect, style) {
  const [W, H] = dims(aspect);
  const V = vfStatic(W, H);

  // Download sources first (need durations for smart windowing + timeline).
  const srcDurs = new Map();
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    const srcKey = a.converted_key ?? a.storage_key; // reprojected flat clip for 360 sources
    const ext = a.converted_key ? "mp4" : (a.original_name?.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "") || "bin";
    a._src = join(dir, `src${i}.${ext}`);
    await download(srcKey, a._src);
    if (a.kind === "video") srcDurs.set(a.storage_key, await probe(a._src));
  }

  let musicFile = null;
  let beats = [];
  let energyCurve = [];
  if (music) {
    const mext = (music.storage_key.split(".").pop() ?? "mp3").replace(/[^a-z0-9]/gi, "") || "mp3";
    musicFile = join(dir, `music.${mext}`);
    await download(music.storage_key, musicFile);
    if (style.beatSync || style.waltzToMusic) beats = await getBeats(musicFile);
    if (style.waltzToMusic) energyCurve = await getEnergyCurve(musicFile);
  }

  const { slots, musicOffset } = await buildTimeline(
    assets,
    beats,
    lengthSec,
    style.beatSync,
    style.smartCut,
    srcDurs,
    style.waltzToMusic,
    energyCurve,
  );
  if (slots.length === 0) throw new Error("no clips in timeline");

  // Build one normalized segment per slot.
  const segments = [];
  const durations = [];
  for (let i = 0; i < slots.length; i++) {
    const { asset: a, dur, offset } = slots[i];
    const seg = join(dir, `seg${i}.mp4`);
    const enc = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", seg];
    let cmd;
    if (a.kind === "video") {
      cmd = ["-ss", offset.toFixed(3), "-t", dur.toFixed(3), "-i", a._src, "-vf", V, ...enc];
    } else if (style.motion) {
      cmd = ["-i", a._src, "-vf", vfKenBurns(W, H, Math.max(1, Math.round(dur * 30))), "-frames:v", String(Math.max(1, Math.round(dur * 30))), ...enc];
    } else {
      cmd = ["-loop", "1", "-t", dur.toFixed(3), "-i", a._src, "-vf", V, ...enc];
    }
    await ffmpeg(cmd);
    segments.push(seg);
    durations.push(await probe(seg));
  }

  const listFile = join(dir, "concat.txt");
  writeFileSync(listFile, segments.map((s) => `file '${fwd(s)}'`).join("\n"));

  const out = join(dir, "out.mp4");
  const total = durations.reduce((s, d) => s + (d || PER_IMAGE), 0);
  const minDur = Math.min(...durations.map((d) => d || PER_IMAGE));
  const T = Math.max(0.2, Math.min(0.4, minDur * 0.35));
  const wantCross = style.transition === "crossfade" && segments.length > 1;
  const WM =
    "drawtext=text='ClipWaltz':fontcolor=white@0.85:fontsize=44:x=w-tw-32:y=h-th-44:box=1:boxcolor=black@0.35:boxborderw=12";
  const titleT = safeText(style.titleText);

  function post(useTitle, useWatermark, outDur) {
    const parts = [];
    const cf = colorFilter(style.styleFilter);
    if (cf) parts.push(cf);
    const lf = lightFilter(style.lightFx);
    if (lf) parts.push(lf);
    if (useTitle && titleT) {
      const fs = Math.round(H * 0.055);
      parts.push(
        `drawtext=text='${titleT}':fontcolor=white:fontsize=${fs}:x=(w-tw)/2:y=${Math.round(H * 0.12)}:` +
          `box=1:boxcolor=black@0.4:boxborderw=16:enable='between(t,0.2,3.0)':` +
          `alpha='if(lt(t,0.6),(t-0.2)/0.4,if(gt(t,2.6),(3.0-t)/0.4,1))'`,
      );
    }
    if (useWatermark) parts.push(WM);
    if (style.fades) parts.push("fade=t=in:st=0:d=0.5");
    if (style.fadeOut && outDur > 1.6) parts.push(`fade=t=out:st=${(outDur - 0.7).toFixed(2)}:d=0.7`);
    return parts.length ? parts.join(",") : "null";
  }

  async function render(useTitle, useWatermark, forceCut) {
    const cross = wantCross && !forceCut;
    const finalDur = cross ? total - (segments.length - 1) * T : total;
    const outDur = lengthSec > 0 ? Math.min(finalDur, lengthSec) : finalDur;
    const pf = post(useTitle, useWatermark, outDur);
    const args = [];
    let musicIdx;
    let fc;
    if (cross) {
      for (const s of segments) args.push("-i", fwd(s));
      let label = "[0:v]";
      let acc = durations[0] || PER_IMAGE;
      let chain = "";
      for (let j = 1; j < segments.length; j++) {
        chain += `${label}[${j}:v]xfade=transition=fade:duration=${T.toFixed(3)}:offset=${(acc - T).toFixed(3)}[vx${j}];`;
        label = `[vx${j}]`;
        acc = acc + (durations[j] || PER_IMAGE) - T;
      }
      fc = `${chain}${label}${pf}[vout]`;
      musicIdx = segments.length;
    } else {
      args.push("-f", "concat", "-safe", "0", "-i", fwd(listFile));
      fc = `[0:v]${pf}[vout]`;
      musicIdx = 1;
    }
    if (musicFile) args.push("-ss", musicOffset.toFixed(3), "-stream_loop", "-1", "-i", fwd(musicFile));
    args.push("-filter_complex", fc, "-map", "[vout]");
    if (musicFile) args.push("-map", `${musicIdx}:a:0`, "-shortest");
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p");
    if (musicFile) args.push("-c:a", "aac", "-b:a", "192k");
    if (lengthSec > 0) args.push("-t", String(lengthSec));
    args.push(fwd(out));
    await ffmpeg(args);
  }

  try {
    await render(true, watermark, false);
  } catch (e) {
    console.warn("[worker] styled render failed, retrying simplified:", e.message);
    await render(false, false, true);
  }

  // Overlay pass (text + emoji) — best-effort; falls back to the base render on failure.
  const overlays = Array.isArray(style.overlays) ? style.overlays : [];
  if (overlays.length > 0) {
    try {
      const totalDur = await probe(out);
      const finalFile = await applyOverlays(dir, out, overlays, W, H, beats, totalDur || lengthSec);
      console.log(`[worker] applied ${overlays.length} overlay(s)`);
      return finalFile;
    } catch (e) {
      console.warn("[worker] overlay pass failed, using base render:", e.message);
    }
  }
  return out;
}

async function processRender(r) {
  const started = Date.now();
  const [project] = await sql`select * from projects where id = ${r.project_id}`;
  const assets = await sql`
    select * from assets
    where project_id = ${r.project_id} and upload_state = 'uploaded'
      and (source_format is null or conversion_state = 'ready')
    order by order_index asc, created_at asc`;
  if (assets.length === 0) throw new Error("no uploaded assets");

  let music = null;
  if (project?.music_track_id) {
    [music] = await sql`select * from music_tracks where id = ${project.music_track_id} and active = true`;
  }
  if (!music) {
    [music] = await sql`select * from music_tracks where active = true order by created_at asc limit 1`;
  }
  const lengthSec = project?.length_sec ?? 30;
  const aspect = r.aspect ?? project?.aspect ?? "9:16";
  const style = {
    titleText: project?.title_text ?? null,
    styleFilter: project?.style_filter ?? "none",
    lightFx: project?.light_fx ?? "none",
    transition: project?.transition ?? "cut",
    motion: project?.motion ?? true,
    fades: project?.fades ?? true,
    fadeOut: project?.fade_out ?? true,
    smartCut: project?.smart_cut ?? true,
    beatSync: project?.beat_sync ?? true,
    waltzToMusic: project?.waltz_to_music ?? false,
    overlays: Array.isArray(project?.overlays) ? project.overlays : [],
  };

  const dir = mkdtempSync(join(tmpdir(), "cw-render-"));
  try {
    console.log(
      `[worker] render ${r.id}: ${assets.length} clips${music ? ` + ${music.title}` : ""}, ${lengthSec}s ${aspect} ` +
        `${style.transition}${style.smartCut ? " +smart" : ""}${style.beatSync ? " +beat" : ""}${style.waltzToMusic ? " +waltz" : ""} ${style.styleFilter}`,
    );
    const outFile = await assemble(dir, assets, music ?? null, r.watermark, lengthSec, aspect, style);
    const key = `renders/${r.project_id}/${r.id}.mp4`;
    await s3.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: readFileSync(outFile), ContentType: "video/mp4" }),
    );
    const secs = Math.round((Date.now() - started) / 1000);
    await sql`update renders set status='done', output_key=${key}, cpu_seconds=${secs}, completed_at=now() where id=${r.id}`;
    await sql`update projects set status='ready', updated_at=now() where id=${r.project_id}`;
    console.log(`[worker] render ${r.id} done in ${secs}s → ${key}`);
    // YouTube description (best-effort) when the project opted in.
    if (project?.describe) {
      const desc = await generateDescription({
        title: project?.title_text || project?.title || "My ClipWaltz video",
        musicTitle: music?.title ?? null,
        clips: assets.length,
        lengthSec,
        aspect,
      });
      if (desc) {
        await sql`update renders set description=${desc} where id=${r.id}`;
        console.log(`[worker] render ${r.id} description generated (${desc.length} chars)`);
      }
    }
    // Licensing ledger: snapshot the music license for this render (best-effort).
    if (music) {
      const licenseType =
        music.provider === "pixabay" ? "Pixabay Content License" : `${music.provider} license`;
      await sql`
        insert into render_licenses
          (id, render_id, user_id, project_id, provider, provider_track_id, track_title, artist, license_type, license_ref, clearance_status)
        values (${randomUUID()}, ${r.id}, ${project?.owner_id ?? null}, ${r.project_id},
          ${music.provider ?? "pixabay"}, ${music.provider_track_id ?? null}, ${music.title ?? null},
          ${music.artist ?? null}, ${licenseType}, ${music.license_ref ?? null}, 'n/a')
      `.catch((e) => console.log(`[worker] ledger insert failed: ${e.message}`));
    }
    await notifyReady(r.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function claimOne() {
  const rows = await sql`
    update renders set status='rendering'
    where id = (select id from renders where status='queued' order by created_at asc limit 1 for update skip locked)
    returning *`;
  return rows[0] ?? null;
}
async function tick() {
  const r = await claimOne();
  if (!r) return false;
  try {
    await processRender(r);
  } catch (e) {
    console.error(`[worker] render ${r.id} FAILED:`, e.message);
    await sql`update renders set status='failed' where id=${r.id}`;
    await sql`update projects set status='failed', updated_at=now() where id=${r.project_id}`;
  }
  return true;
}
// Diagnostic: `--selftest <video> [needSec]` runs window selection (motion + vision) on a
// file and prints the chosen offset, without touching the DB. Used to verify scene-aware cuts.
async function selftest() {
  const i = process.argv.indexOf("--selftest");
  const src = process.argv[i + 1];
  const need = Number(process.argv[i + 2]) || 3;
  if (!src) {
    console.error("usage: --selftest <video> [needSec]");
    process.exit(2);
  }
  const dur = await probe(src);
  console.log(`[selftest] ${src} dur=${dur.toFixed(1)}s need=${need}s vision=${OLLAMA_URL ? OLLAMA_MODEL : "off"}`);
  const off = await pickWindow(src, need, dur);
  console.log(`[selftest] chosen offset = ${off.toFixed(2)}s`);
  await sql.end();
}

// Diagnostic: `--waltztest <music> [lengthSec] [nClips]` prints the energy-aware, beat-snapped
// timeline (durations) for a track, without touching the DB. Verifies Waltz to the Music.
async function waltztest() {
  const i = process.argv.indexOf("--waltztest");
  const music = process.argv[i + 1];
  const lengthSec = Number(process.argv[i + 2]) || 30;
  const nClips = Number(process.argv[i + 3]) || 12;
  if (!music) {
    console.error("usage: --waltztest <music> [lengthSec] [nClips]");
    process.exit(2);
  }
  const beats = await getBeats(music);
  const curve = await getEnergyCurve(music);
  const es = curve.map((c) => c.e);
  console.log(`[waltztest] beats=${beats.length} energyWindows=${curve.length} energy[min/max]=${es.length ? Math.min(...es).toFixed(2) + "/" + Math.max(...es).toFixed(2) : "n/a"}`);
  const assets = Array.from({ length: nClips }, (_, k) => ({ kind: "photo", storage_key: `x${k}` }));
  const { slots, musicOffset } = await buildTimeline(assets, beats, lengthSec, true, false, new Map(), true, curve);
  const durs = slots.map((s) => +s.dur.toFixed(2));
  const total = durs.reduce((a, b) => a + b, 0);
  console.log(`[waltztest] musicOffset=${musicOffset.toFixed(2)}s clips=${slots.length} total=${total.toFixed(2)}s durations=[${durs.join(", ")}]`);
  await sql.end();
}

// Diagnostic: `--overlaytest` renders a 4s clip with a sample text + emoji overlay to
// /tmp/overlaid.mp4, verifying Twemoji fetch + the overlay filtergraph. No DB.
async function overlaytest() {
  const dir = mkdtempSync(join(tmpdir(), "cw-ovl-"));
  const base = join(dir, "base.mp4");
  await ffmpeg(["-f", "lavfi", "-i", "testsrc=size=1080x1920:duration=4", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", base]);
  const overlays = [
    { type: "text", content: "Italy 2026", x: 0.5, y: 0.18, size: 0.08, color: "#ffffff", box: true, start: null, end: null, anim: "fade", beatSnap: false },
    { type: "emoji", content: "🎉", x: 0.8, y: 0.8, size: 0.18, color: "#fff", box: false, start: null, end: null, anim: "pop", beatSnap: false },
  ];
  const outFile = await applyOverlays(dir, base, overlays, 1080, 1920, [], 4);
  const dur = await probe(outFile);
  console.log(`[overlaytest] out=${outFile} dur=${dur.toFixed(2)}s (${outFile !== base ? "overlays applied" : "no overlays"})`);
  await sql.end();
}

// Diagnostic: `--convtest <insv>` reprojects a 360 file to /tmp/convtest.mp4 (no DB).
async function convtest() {
  const i = process.argv.indexOf("--convtest");
  const src = process.argv[i + 1];
  if (!src) { console.error("usage: --convtest <insv>"); process.exit(2); }
  const streams = await probeVideoStreams(src);
  const proj =
    streams >= 2
      ? "[0:v:0][0:v:1]hstack=inputs=2,v360=dfisheye:flat:ih_fov=200:iv_fov=200:h_fov=110:v_fov=100:roll=90:w=1920:h=1080"
      : "[0:v:0]v360=fisheye:flat:ih_fov=200:iv_fov=200:h_fov=110:v_fov=100:w=1920:h=1080";
  const out = "/tmp/convtest.mp4";
  await ffmpeg(["-i", src, "-filter_complex", `${proj},format=yuv420p[v]`, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", out]);
  console.log(`[convtest] ${streams} lens → ${out} dur=${(await probe(out)).toFixed(2)}s`);
  await sql.end();
}

// Diagnostic: `--followtest <insv> [seconds]` computes the auto-follow yaw path and renders
// a short follow-reframed clip to /tmp/followtest.mp4 (no DB).
async function followtest() {
  const i = process.argv.indexOf("--followtest");
  const src = process.argv[i + 1];
  const secs = Number(process.argv[i + 2]) || 20;
  if (!src) { console.error("usage: --followtest <insv> [seconds]"); process.exit(2); }
  const streams = await probeVideoStreams(src);
  const path = await computeYawPath(src, streams);
  const yaws = path.map((p) => p.yaw);
  console.log(`[followtest] streams=${streams} path=${path.length} yaw[min/max]=${yaws.length ? Math.min(...yaws).toFixed(0) + "/" + Math.max(...yaws).toFixed(0) : "n/a"}`);
  const dir = mkdtempSync(join(tmpdir(), "cw-ft-"));
  const cmds = path.filter((p) => p.t <= secs).map((p) => `${p.t.toFixed(2)} v360@rf yaw ${p.yaw.toFixed(1)};`).join("\n");
  writeFileSync(join(dir, "cmds.txt"), cmds);
  const hstack = streams >= 2 ? "[0:v:0][0:v:1]hstack=inputs=2," : "[0:v:0]";
  const level = streams >= 2 ? "v360=dfisheye:e:ih_fov=200:iv_fov=200:roll=90" : "v360=fisheye:e:ih_fov=200:iv_fov=200";
  const out = "/tmp/followtest.mp4";
  await ffmpeg(["-t", String(secs), "-i", src, "-filter_complex", `${hstack}${level},sendcmd=f=${fwd(join(dir, "cmds.txt"))},v360@rf=input=e:output=flat:h_fov=110:v_fov=100:w=1280:h=720,format=yuv420p[v]`, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", out]);
  console.log(`[followtest] → ${out} dur=${(await probe(out)).toFixed(1)}s`);
  rmSync(dir, { recursive: true, force: true });
  await sql.end();
}

async function main() {
  if (process.argv.includes("--followtest")) return followtest();
  if (process.argv.includes("--selftest")) return selftest();
  if (process.argv.includes("--waltztest")) return waltztest();
  if (process.argv.includes("--overlaytest")) return overlaytest();
  if (process.argv.includes("--convtest")) return convtest();
  console.log(`[worker] ClipWaltz render worker starting (${ONCE ? "once" : "loop"})`);
  if (ONCE) {
    const did = await tick();
    if (!did) console.log("[worker] no queued renders");
    await sql.end();
    return;
  }
  for (;;) {
    let worked = false;
    try {
      worked = await tick();
      if (!worked) worked = await convTick(); // 360 reprojection queue
    } catch (e) {
      console.error("[worker] tick error:", e.message);
    }
    if (!worked) await new Promise((res) => setTimeout(res, POLL_MS));
  }
}
main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
