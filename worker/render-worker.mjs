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
import { mkdtempSync, writeFileSync, readFileSync, rmSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import postgres from "postgres";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const run = promisify(execFile);
const ONCE = process.argv.includes("--once");
const POLL_MS = 5000;
const PER_IMAGE = 2;
const PER_VIDEO = 4;
// Max segments fed to a single xfade filtergraph. A single graph over ALL segments makes
// ffmpeg buffer decoded frames for every not-yet-reached input (offsets stagger to the full
// runtime) — a 78-clip render peaked at ~78 GB and was OOM-killed. We crossfade in bounded
// chunks of this many segments instead; tune with XFADE_CHUNK if the box has more/less RAM.
const XFADE_CHUNK = Math.max(2, Number(process.env.XFADE_CHUNK ?? 10));

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
  // Stream straight to disk — never buffer the whole object. Multi-GB clips overflow
  // Buffer/ArrayBuffer (max 2^31-1 bytes) and throw "length out of range".
  const body = out.Body;
  const readable = body instanceof Readable ? body : Readable.fromWeb(body);
  await pipeline(readable, createWriteStream(file));
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

// Auto-level a 360 sphere. "Up" (sky / main light) is the brightest hemisphere, so the
// brightness²-weighted mean direction over the equirect approximates true up. Returns the
// v360 rotation ({yaw:φ, pitch:-β}) that brings that direction to the zenith — verified to
// null the tilt on real Insta360 footage. null → caller falls back to the fixed base roll.
async function estimateLevel(src, streams, srcDur) {
  const W = 320, H = 160;
  const hstack = streams >= 2 ? "[0:v:0][0:v:1]hstack=inputs=2," : "[0:v:0]";
  const proj = streams >= 2 ? "v360=dfisheye:e:ih_fov=200:iv_fov=200" : "v360=fisheye:e:ih_fov=200:iv_fov=200";
  const dur = srcDur > 0 ? srcDur : 8;
  const fracs = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85];
  const acc = new Float64Array(W * H);
  let cnt = 0;
  for (const fr of fracs) {
    try {
      const { stdout } = await run(
        "ffmpeg",
        ["-ss", String(Math.max(0, fr * dur)), "-i", src, "-frames:v", "1", "-filter_complex", `${hstack}${proj},scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"],
        { maxBuffer: 1024 * 1024 * 8, encoding: "buffer" },
      );
      const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, "binary");
      if (buf.length < W * H) continue;
      for (let i = 0; i < W * H; i++) acc[i] += buf[i];
      cnt++;
    } catch { /* skip this sample */ }
  }
  if (!cnt) return null;
  let Ux = 0, Uy = 0, Uz = 0;
  for (let y = 0; y < H; y++) {
    const elev = Math.PI / 2 - (y + 0.5) * (Math.PI / H);
    const ce = Math.cos(elev), se = Math.sin(elev);
    for (let x = 0; x < W; x++) {
      const az = (x + 0.5) * (2 * Math.PI / W) - Math.PI;
      const b = acc[y * W + x] / cnt / 255;
      const w = b * b * ce; // brightness² emphasizes sky/light; cos(elev) = equirect area weight
      Ux += w * ce * Math.cos(az); Uy += w * ce * Math.sin(az); Uz += w * se;
    }
  }
  const norm = Math.hypot(Ux, Uy, Uz);
  if (!(norm > 1e-6)) return null;
  Uz /= norm; Uy /= norm; Ux /= norm;
  const beta = (Math.acos(Math.max(-1, Math.min(1, Uz))) * 180) / Math.PI;
  const phi = (Math.atan2(Uy, Ux) * 180) / Math.PI;
  return { yaw: phi, pitch: -beta, beta };
}

// v360 filter that reprojects the source to a LEVELED equirect. Uses the estimated horizon
// when available; otherwise the legacy fixed base roll so behaviour never regresses.
function levelEquirect(streams, lvl) {
  const base = streams >= 2 ? "dfisheye" : "fisheye";
  const rot = lvl ? `:yaw=${lvl.yaw.toFixed(2)}:pitch=${lvl.pitch.toFixed(2)}` : ":roll=90";
  return `v360=${base}:e:ih_fov=200:iv_fov=200${rot}`;
}

// Motion-driven yaw path (deg over time) for AutoReframe "follow": sample small equirect
// frames, track the busiest horizontal region, smooth + rate-limit into a pan. [] on failure.
// `level` is the leveled-equirect filter so yaw values match the reframe stage's frame.
async function computeYawPath(src, streams, level) {
  const W = 64, H = 32, FPS = 2;
  const hstack = streams >= 2 ? "[0:v:0][0:v:1]hstack=inputs=2," : "[0:v:0]";
  const proj = level || (streams >= 2 ? "v360=dfisheye:e:ih_fov=200:iv_fov=200:roll=90" : "v360=fisheye:e:ih_fov=200:iv_fov=200");
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
    // Auto-level the sphere (horizon upright) instead of a fixed roll, then reframe in a 2nd
    // stage. Leveling and view-direction are different rotations, so keep them separate.
    const dur = await probe(src);
    const lvl = await estimateLevel(src, streams, dur);
    const level = levelEquirect(streams, lvl);
    console.log(`[worker] 360 level ${lvl ? `yaw=${lvl.yaw.toFixed(1)} pitch=${lvl.pitch.toFixed(1)} (tilt ${lvl.beta.toFixed(0)}°)` : "estimate failed → base roll=90"}`);

    let vf;
    if (mode === "tiny") {
      vf = `${hstack}${level},v360=e:ball:w=1080:h=1080`; // little-planet
    } else if (mode === "follow" && !isPhoto) {
      const path = await computeYawPath(src, streams, level);
      if (path.length) {
        const cmds = path.map((p) => `${p.t.toFixed(2)} v360@rf yaw ${p.yaw.toFixed(1)};`).join("\n");
        writeFileSync(join(dir, "cmds.txt"), cmds);
        vf = `${hstack}${level},sendcmd=f=${fwd(join(dir, "cmds.txt"))},v360@rf=input=e:output=flat:h_fov=110:v_fov=100:w=1920:h=1080`;
      }
    }
    if (!vf) vf = `${hstack}${level},v360=e:flat:h_fov=110:v_fov=100:w=1920:h=1080`;

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

// Ready-to-post video description. The AI writes ONLY the video-specific top block (an opening
// description + the three "In this video:" bullets) from the actual footage, guided by the
// project's post_topic; everything below is the project's channel template (post_template), used
// verbatim. Both fall back to these built-in defaults when a project hasn't set them, so existing
// projects keep their current output. Stored on the render for the Copy button.
const DEFAULT_POST_TOPIC = "jet ski / personal watercraft (PWC)";
const DEFAULT_POST_TEMPLATE = `If you enjoy jet skiing, personal watercraft, racing, riding, repairs, events, or just being out on the water, subscribe and follow the journey.
---

ABOUT THE CHANNEL
This channel follows my real-world experience with jet skis and personal watercraft — from recreational riding and group rides to races, events, repairs, upgrades, testing, road trips, mistakes, and everything that happens along the way.

I've accumulated years of footage, and I'm now documenting and sharing the journey — including older footage, current rides, lessons learned, and what comes next.

The goal is simple: share the experience, support the PWC community, connect with other riders, and hopefully encourage more people to get involved in the sport.
---

WHAT YOU'LL SEE HERE
• Jet ski and PWC riding
• Race and event footage
• Lake and river adventures
• Group rides
• Repairs and maintenance
• Modifications and upgrades
• Equipment and gear
• Behind-the-scenes footage
• Lessons learned from owning and riding PWCs
• Older footage from the archive
• New adventures as they happen
---

CONNECT WITH US
Ride with us. Race with us. Share your experience.

If you're a rider, racer, PWC enthusiast, manufacturer, shop, event organizer, or just someone interested in the sport, leave a comment and connect with us.

Have a location, event, product, jet ski, modification, or story you think we should feature? Let us know.
---

DISCLAIMER
The activities shown on this channel may involve inherent risks. Always ride responsibly, wear appropriate safety equipment, follow local laws and waterway regulations, and operate within your experience and ability level.

#JetSki #PWC #PersonalWatercraft #JetSkiLife #PWCLife #JetSkiRiding #WaterSports #JetSkiAdventure #PWCCommunity #JetSkiCommunity #LakeLife #RidePWC`;

function assemblePost(description, bullets, template) {
  const b = [bullets[0], bullets[1], bullets[2]].map((x) => String(x || "").trim());
  const head = `${String(description || "").trim()}\n\nIn this video:\n• ${b[0]}\n• ${b[1]}\n• ${b[2]}`;
  const suffix = (template ?? DEFAULT_POST_TEMPLATE).trim();
  return suffix ? `${head}\n\n${suffix}` : head;
}

// Build the full post: sample frames from the finished video, have the vision model write the
// video-specific block from what it actually sees (steered by `topic`), then append the project's
// channel `template`. Always returns a complete post (falls back to a generic block) so the Copy
// button is never empty. `topic`/`template` come from the project; empty → built-in defaults.
async function generatePostContent(videoFile, title, topic, template) {
  const subject = (topic ?? "").trim() || DEFAULT_POST_TOPIC;
  const generic = assemblePost(
    `${title ? `${title}. ` : ""}A new ${subject} video.`,
    [`A look at this ${subject} video`, "The moments and highlights captured here", "What viewers should watch for"],
    template,
  );
  if (!OLLAMA_URL) return generic;
  const dir = mkdtempSync(join(tmpdir(), "cw-post-"));
  try {
    const dur = await probe(videoFile);
    const images = [];
    for (const f of [0.12, 0.38, 0.62, 0.88]) {
      const fp = join(dir, `p${images.length}.jpg`);
      try {
        await extractFrame(videoFile, Math.max(0, f * (dur || 1)), fp);
        images.push(readFileSync(fp).toString("base64"));
      } catch { /* skip frame */ }
    }
    if (!images.length) return generic;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 60000);
    try {
      const prompt =
        `These frames are from a ${subject} video${title ? ` titled "${title}"` : ""}. ` +
        `Write a first-person YouTube description for it. Respond ONLY as JSON: ` +
        `{"description":"2-3 engaging first-person sentences about this specific video",` +
        `"bullets":["what happened and where","what makes this moment interesting","what viewers should watch for"]}. ` +
        `Be specific to what you actually see in the frames. Plain text values, no markdown.`;
      const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt, images, stream: false, format: "json", options: { num_predict: 500, temperature: 0.6 } }),
        signal: ctrl.signal,
      });
      if (!res.ok) return generic;
      const j = await res.json();
      const parsed = JSON.parse(j.response || "{}");
      const desc = String(parsed.description || "").trim();
      const bullets = Array.isArray(parsed.bullets) ? parsed.bullets.map((x) => String(x).trim()).filter(Boolean) : [];
      if (desc.length < 8 || bullets.length < 3) return generic;
      return assemblePost(desc, bullets, template).slice(0, 8000);
    } finally {
      clearTimeout(to);
    }
  } catch {
    return generic;
  } finally {
    rmSync(dir, { recursive: true, force: true });
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

const RANK_MOTION_CANDS = 12; // top motion windows fed into the vision re-rank
const RANK_EVEN = 8; // evenly-spaced probes so vision catches subjects motion misses (or over-scores water)
const RANK_VISION_MAX = 16; // cap vision calls per clip (bounds render time on long sources)

// Rank a video's best `need`-second windows, best-first and non-overlapping. Motion frame-diff
// finds candidate windows across the WHOLE clip; a broad candidate set (top motion + evenly
// spaced) is then re-scored by the vision model so windows with people/faces/action beat empty
// scenery or choppy-water frames (which read as high motion but make dull footage). Falls back
// to motion-only when vision is off. Returns up to `k` offsets ([0] when the clip is too short).
async function rankWindows(src, need, srcDur, k = 1) {
  if (!need || srcDur <= need + 0.3) return [0];
  try {
    const { stdout } = await run(
      "ffmpeg",
      ["-i", src, "-vf", "fps=4,scale=160:-1,tblend=all_mode=difference,signalstats,metadata=print:file=-", "-an", "-f", "null", "-"],
      { maxBuffer: 1024 * 1024 * 64 },
    );
    const times = [...String(stdout).matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
    const ys = [...String(stdout).matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1]);
    const n = Math.min(times.length, ys.length);
    if (n < 4) return [0];
    const win = Math.max(1, Math.round(need * 4)); // 4 fps samples

    const windows = [];
    for (let i = 0; i + win <= n; i++) {
      if (times[i] > srcDur - need) break;
      let sum = 0;
      for (let j = i; j < i + win; j++) sum += ys[j];
      windows.push({ t: times[i], sum });
    }
    if (windows.length === 0) return [0];
    const byMotion = [...windows].sort((a, b) => b.sum - a.sum);
    const maxSum = byMotion[0].sum || 1;
    const motionNorm = (t) => {
      let best = 0, bd = Infinity;
      for (const w of windows) { const d = Math.abs(w.t - t); if (d < bd) { bd = d; best = w.sum; } }
      return best / maxSum;
    };
    const clamp = (t) => Math.max(0, Math.min(srcDur - need, t));

    // Candidate windows: top motion + evenly spaced across the whole clip, deduped by `need`.
    const cand = [];
    const addDistinct = (t) => { t = clamp(t); if (cand.every((c) => Math.abs(c - t) >= need)) cand.push(t); };
    byMotion.slice(0, RANK_MOTION_CANDS).forEach((w) => addDistinct(w.t));
    const span = Math.max(0, srcDur - need);
    for (let i = 0; i < RANK_EVEN; i++) addDistinct((RANK_EVEN === 1 ? 0 : i / (RANK_EVEN - 1)) * span);

    // Score candidates. Vision (people/faces/subject) dominates; motion breaks ties and ranks
    // any windows the vision pass didn't reach (kept below scored ones).
    let scored;
    if (OLLAMA_URL) {
      const list = cand.slice(0, RANK_VISION_MAX);
      const rest = cand.slice(RANK_VISION_MAX);
      scored = [];
      let anyVision = false;
      for (let idx = 0; idx < list.length; idx++) {
        const t = list[idx];
        const fp = `${src}.rk${idx}.jpg`;
        let vs = null;
        try { await extractFrame(src, Math.min(srcDur - 0.1, t + need / 2), fp); vs = await visionScore(fp); } catch { vs = null; }
        try { rmSync(fp, { force: true }); } catch { /* ignore */ }
        if (vs != null) anyVision = true;
        const m = motionNorm(t);
        scored.push({ t, score: vs != null ? 0.7 * vs + 0.3 * m : 0.4 * m });
      }
      for (const t of rest) scored.push({ t, score: 0.4 * motionNorm(t) });
      if (!anyVision) scored = cand.map((t) => ({ t, score: motionNorm(t) }));
    } else {
      scored = cand.map((t) => ({ t, score: motionNorm(t) }));
    }
    scored.sort((a, b) => b.score - a.score);

    const picked = [];
    for (const s of scored) {
      if (picked.every((p) => Math.abs(p - s.t) >= need)) picked.push(s.t);
      if (picked.length >= k) break;
    }
    if (picked.length && OLLAMA_URL) {
      console.log(`[worker] ranked ${picked.length} window(s), best ${picked[0].toFixed(1)}s (motion-only best ${clamp(byMotion[0].t).toFixed(1)}s)`);
    }
    return picked.length ? picked : [clamp(byMotion[0].t)];
  } catch {
    return [0];
  }
}

// Best single `need`-second window (thin wrapper over rankWindows; used by --selftest).
async function pickWindow(src, need, srcDur) {
  const r = await rankWindows(src, need, srcDur, 1);
  return r[0] ?? 0;
}

// Beats per cut from energy: louder → faster cuts, calmer → longer holds.
function waltzSpan(e) {
  return e >= 0.66 ? 2 : e >= 0.33 ? 3 : 4;
}

// Build the ordered timeline: [{asset, dur, offset}]. Beat-synced when possible.
async function buildTimeline(assets, beats, lengthSec, beatSync, smartCut, srcDurs, waltzToMusic, curve, loopToFill, maxFootage) {
  const slots = [];
  let musicOffset = 0;
  const cap = lengthSec > 0 ? lengthSec : Infinity;

  // "Max footage": build the LONGEST coherent video the footage supports — every video at its
  // full length, every image a slot — laid end to end, never repeating. Bounded by a soft ceiling
  // so a huge upload can't produce a runaway render. Runs first so the beat/waltz/fill branches
  // below (all guarded by slots.length === 0) are skipped. lengthSec is passed as 0 for this mode,
  // so `cap` is Infinity and neither auto-loop nor the fill-to-target block engages.
  const MAX_FOOTAGE_CEIL = 600; // 10 minutes
  if (maxFootage) {
    let total = 0;
    for (const a of assets) {
      if (total >= MAX_FOOTAGE_CEIL) break;
      const full = a.kind === "video" ? (srcDurs.get(a.storage_key) ?? PER_VIDEO) : PER_IMAGE;
      const dur = Math.min(full, MAX_FOOTAGE_CEIL - total);
      if (dur < 0.3) break;
      slots.push({ asset: a, dur, offset: 0 });
      total += dur;
    }
    musicOffset = beats.length ? beats[0] : 0;
    if (slots.length) console.log(`[worker] max-footage: ${slots.length} clips → ${total.toFixed(0)}s`);
  }

  // Auto-loop: if the user didn't force looping but the footage is SHORT and can't fill the
  // chosen length on its own, repeat it to reach the target (rather than a stub video). The
  // "short" guard (≤ AUTO_LOOP_MAX_FOOTAGE) means a genuinely long clip is NOT silently looped —
  // it just fills to its own length, as before.
  const AUTO_LOOP_MAX_FOOTAGE = 150; // seconds — only auto-loop clearly-short footage
  const footageSec = assets.reduce(
    (s, a) => s + (srcDurs.get(a.storage_key) ?? (a.kind === "video" ? PER_VIDEO : PER_IMAGE)),
    0,
  );
  const autoLoop =
    !loopToFill && cap !== Infinity && footageSec > 0 && footageSec < cap - 0.5 && footageSec <= AUTO_LOOP_MAX_FOOTAGE;
  const effLoop = loopToFill || autoLoop;
  if (autoLoop) console.log(`[worker] auto-loop: ${footageSec.toFixed(0)}s footage → filling ${cap}s target`);

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

  // Rank each video's best moments ONCE (motion + vision), so both the montage fill and the
  // normal slots draw from a best-first queue of DISTINCT windows — landing cuts on people/
  // action rather than the first seconds of a long clip. Cached per source; short clips → [0].
  const RANK_NEED = 3; // nominal window length (s) used only for ranking granularity
  const RANK_MAX = 24; // most distinct windows to keep per video
  const ranked = new Map(); // storage_key -> number[] (offsets, best-first)
  if (smartCut) {
    for (const a of assets) {
      if (a.kind === "video" && a._src && !ranked.has(a.storage_key)) {
        const list = await rankWindows(a._src, RANK_NEED, srcDurs.get(a.storage_key) ?? 0, RANK_MAX);
        ranked.set(a.storage_key, list && list.length ? list : [0]);
      }
    }
  }
  const rankIdx = new Map(); // storage_key -> next window index
  const QSEG = 2.5; // nominal window size (s) for building the full-coverage queue
  const queues = new Map(); // storage_key -> ordered offsets that cover the WHOLE clip
  // Ordered window queue for a video. Looping (short clip → long target): walk the whole clip in
  // TIME order (best window as the opener) so every part is used and repeats evenly — fixes the
  // "only the first bit gets looped" problem. Not looping (long clip → short montage): best
  // moments first, then broader coverage.
  const windowQueue = (a) => {
    const cached = queues.get(a.storage_key);
    if (cached) return cached;
    const D = srcDurs.get(a.storage_key) ?? 0;
    const nWin = Math.max(1, Math.floor(D / QSEG));
    const timeWins = Array.from({ length: nWin }, (_, k) => k * QSEG); // 0 … end, in order
    const rankedList = ranked.get(a.storage_key) || [];
    let order;
    if (effLoop) {
      const best = rankedList.length ? rankedList[0] : 0;
      order = [best, ...timeWins.filter((t) => Math.abs(t - best) >= QSEG)];
    } else {
      order = [...rankedList];
      for (const t of timeWins) if (order.every((o) => Math.abs(o - t) >= QSEG)) order.push(t);
    }
    const q = order.length ? order : [0];
    queues.set(a.storage_key, q);
    return q;
  };
  const nextOffset = (a, dur) => {
    const q = windowQueue(a);
    const D = srcDurs.get(a.storage_key) ?? 0;
    const i = rankIdx.get(a.storage_key) ?? 0;
    rankIdx.set(a.storage_key, i + 1);
    return Math.max(0, Math.min(q[i % q.length], Math.max(0, D - dur)));
  };

  // Fill toward the target length with a HARD CAP of MAX_APP appearances per source clip, so the
  // same image/video is never shown more than twice — even in loop-to-fill mode. Each extra video
  // appearance draws a DIFFERENT window (montage of distinct moments), and photos aren't repeated
  // past the cap. Any void left after the cap is filled by stretching (below), not more repeats.
  const MAX_APP = 2;
  const appear = new Map(); // asset.id -> times it appears so far (incl. the initial slots above)
  for (const s of slots) appear.set(s.asset.id, (appear.get(s.asset.id) ?? 0) + 1);
  let total = slots.reduce((s, x) => s + x.dur, 0);
  if (cap !== Infinity && assets.length > 0 && total < cap - 0.4) {
    const fillDur = Math.max(1.5, Math.min(4, slots.length ? total / slots.length : PER_VIDEO));
    const MAX_SLOTS = 400;
    const vUsed = new Map(); // per-video fill windows used (for non-smart tiling offsets)
    let i = 0;
    let skips = 0;
    while (total < cap - 0.4 && slots.length < MAX_SLOTS) {
      const a = assets[i % assets.length];
      i++;
      if ((appear.get(a.id) ?? 0) >= MAX_APP) {
        if (++skips >= assets.length) break; // every clip has hit the 2× cap → stop repeating
        continue;
      }
      let dur = Math.min(fillDur, cap - total);
      if (dur < 0.4) break;
      let offset; // undefined → resolver assigns a ranked window; set here only for non-smart tiling
      if (a.kind === "video") {
        const D = srcDurs.get(a.storage_key) ?? 0;
        const nWin = Math.max(1, Math.floor(D / dur));
        const used = vUsed.get(a.storage_key) ?? 0;
        if (!smartCut) offset = Math.min(Math.max(0, D - dur), (used % nWin) * dur);
        vUsed.set(a.storage_key, used + 1);
      } else {
        offset = 0;
      }
      appear.set(a.id, (appear.get(a.id) ?? 0) + 1);
      skips = 0;
      slots.push({ asset: a, dur, offset });
      total += dur;
    }
  }

  // Resolve offsets: smart video slots pull the next best window (ranked, then sequential); others 0.
  for (const s of slots) {
    if (s.offset !== undefined) continue;
    s.offset = s.asset.kind === "video" && smartCut ? nextOffset(s.asset, s.dur) : 0;
  }

  // Stretch to absorb any leftover void (target not reachable within the 2× cap) — rather than
  // repeating a clip a 3rd time. Hold IMAGES longer first (up to MAX_IMG_HOLD), then lengthen VIDEO
  // slots to use MORE of their own footage (bounded by each clip's remaining length from its
  // offset). Distributes evenly in small rounds so no single slot balloons. If it still can't fill,
  // the video is simply a bit shorter than the target — better than showing something 3+ times.
  if (cap !== Infinity && total < cap - 0.4 && slots.length > 0) {
    const MAX_IMG_HOLD = 12;
    const grow = (eligible, maxFor) => {
      let guard = 0;
      while (total < cap - 0.4 && guard++ < 4000) {
        const room = eligible.filter((s) => s.dur < maxFor(s) - 0.05);
        if (room.length === 0) break;
        const step = Math.max(0.05, Math.min((cap - total) / room.length, 0.5));
        for (const s of room) {
          const add = Math.min(step, maxFor(s) - s.dur, cap - total);
          if (add <= 0) continue;
          s.dur += add;
          total += add;
          if (total >= cap - 0.4) break;
        }
      }
    };
    grow(slots.filter((s) => s.asset.kind !== "video"), () => MAX_IMG_HOLD);
    if (total < cap - 0.4) {
      grow(
        slots.filter((s) => s.asset.kind === "video"),
        (s) => Math.max(s.dur, (srcDurs.get(s.asset.storage_key) ?? 0) - s.offset),
      );
    }
    console.log(`[worker] fill: capped at ${MAX_APP}× per clip; stretched to ${total.toFixed(0)}s / ${cap}s target`);
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

// Crossfade many segments without OOM. Rather than one xfade filtergraph over all N inputs
// (which buffers frames for every staggered input → ~78 GB on a big render), xfade in bounded
// chunks of `chunkSize` (peak memory ~ chunkSize decoders), then hard-concat the chunk files.
// Every within-chunk transition still crossfades; only the few chunk seams are hard cuts.
// Returns { files, listFile, total } for the caller's concat + music + post pipeline.
async function crossfadeChunks(dir, segments, durations, T, chunkSize = XFADE_CHUNK) {
  const K = Math.max(2, chunkSize);
  const files = [];
  for (let start = 0; start < segments.length; start += K) {
    const grp = segments.slice(start, start + K);
    const gdur = durations.slice(start, start + K);
    if (grp.length === 1) {
      files.push(grp[0]); // lone trailing segment — nothing to crossfade it with
      continue;
    }
    const chunk = join(dir, `xchunk${start}.mp4`);
    const a = [];
    for (const s of grp) a.push("-i", fwd(s));
    let label = "[0:v]";
    let acc = gdur[0] || PER_IMAGE;
    let chain = "";
    for (let j = 1; j < grp.length; j++) {
      chain += `${label}[${j}:v]xfade=transition=fade:duration=${T.toFixed(3)}:offset=${(acc - T).toFixed(3)}[cx${j}];`;
      label = `[cx${j}]`;
      acc = acc + (gdur[j] || PER_IMAGE) - T;
    }
    a.push(
      "-filter_complex", `${chain}${label}null[v]`, "-map", "[v]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", fwd(chunk),
    );
    await ffmpeg(a);
    files.push(chunk);
  }
  let total = 0;
  for (const f of files) total += (await probe(f)) || 0;
  const listFile = join(dir, "xchunks.txt");
  writeFileSync(listFile, files.map((s) => `file '${fwd(s)}'`).join("\n"));
  return { files, listFile, total };
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
    style.loopToFill,
    style.maxFootage,
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
    // Crossfade path: pre-build bounded, chunked crossfaded files (no OOM), then run the
    // SAME concat + music + post pipeline as the cut path over those files.
    let srcList = listFile;
    let effTotal = total;
    if (cross) {
      const cc = await crossfadeChunks(dir, segments, durations, T);
      srcList = cc.listFile;
      effTotal = cc.total || total;
    }
    const outDur = lengthSec > 0 ? Math.min(effTotal, lengthSec) : effTotal;
    const pf = post(useTitle, useWatermark, outDur);
    const args = ["-f", "concat", "-safe", "0", "-i", fwd(srcList)];
    const musicIdx = 1;
    if (musicFile) args.push("-ss", musicOffset.toFixed(3), "-stream_loop", "-1", "-i", fwd(musicFile));
    // Audio fades out with the picture at the very end (matches the video fade-out) so the music
    // never hard-cuts — gated on the same `fadeOut` setting as the visual fade for a clean ending.
    const aFade = style.fadeOut && !!musicFile && outDur > 1.6;
    let fc = `[0:v]${pf}[vout]`;
    if (aFade) fc += `;[${musicIdx}:a]afade=t=out:st=${(outDur - 0.7).toFixed(2)}:d=0.7[aout]`;
    args.push("-filter_complex", fc, "-map", "[vout]");
    if (musicFile) args.push("-map", aFade ? "[aout]" : `${musicIdx}:a:0`, "-shortest");
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
  // Max-footage mode ignores the length cap → pass length 0 so buildTimeline runs uncapped.
  const maxFootage = project?.max_footage ?? false;
  const lengthSec = maxFootage ? 0 : (project?.length_sec ?? 30);
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
    loopToFill: project?.loop_to_fill ?? false,
    maxFootage,
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
    // Ready-to-post description (best-effort) when the project opted in. Generated BEFORE marking
    // 'done' and folded into the same update, so it's present the moment the client sees "ready".
    let postText = null;
    if (project?.describe) {
      postText = await generatePostContent(
        outFile,
        project?.title_text || project?.title || "",
        project?.post_topic ?? null,
        project?.post_template ?? null,
      ).catch(() => null);
      if (postText) console.log(`[worker] render ${r.id} post text generated (${postText.length} chars)`);
    }
    const secs = Math.round((Date.now() - started) / 1000);
    await sql`update renders set status='done', output_key=${key}, cpu_seconds=${secs}, completed_at=now(), description=${postText} where id=${r.id}`;
    await sql`update projects set status='ready', updated_at=now() where id=${r.project_id}`;
    console.log(`[worker] render ${r.id} done in ${secs}s → ${key}`);
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

// Crash recovery. A hard crash (OOM/SIGKILL/deploy restart) skips the tick() catch that marks a
// render 'failed', so it's orphaned in 'rendering' forever — and claimOne() only picks up 'queued',
// so it never retries and the user's spinner never stops. This worker is the ONLY writer of the
// 'rendering' status, so at startup any row still 'rendering' is an orphan from a previous run.
// Fail them (+ their projects) so the UI shows "try again". (A multi-worker deployment would need
// a per-render heartbeat/lease instead of a blanket startup sweep.)
async function reapStaleRenders() {
  const rows = await sql`update renders set status='failed' where status='rendering' returning id, project_id`;
  if (rows.length === 0) return;
  for (const row of rows) {
    await sql`update projects set status='failed', updated_at=now() where id=${row.project_id}`.catch(() => {});
  }
  console.log(`[worker] reaped ${rows.length} orphaned render(s) stuck in 'rendering': ${rows.map((r) => r.id).join(", ")}`);
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
  const { slots, musicOffset } = await buildTimeline(assets, beats, lengthSec, true, false, new Map(), true, curve, true);
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
  const hstack = streams >= 2 ? "[0:v:0][0:v:1]hstack=inputs=2," : "[0:v:0]";
  const lvl = await estimateLevel(src, streams, await probe(src));
  const level = levelEquirect(streams, lvl);
  console.log(`[convtest] level ${lvl ? `yaw=${lvl.yaw.toFixed(1)} pitch=${lvl.pitch.toFixed(1)} tilt=${lvl.beta.toFixed(0)}°` : "failed → roll=90"}`);
  const proj = `${hstack}${level},v360=e:flat:h_fov=110:v_fov=100:w=1920:h=1080`;
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
  const hstack = streams >= 2 ? "[0:v:0][0:v:1]hstack=inputs=2," : "[0:v:0]";
  const lvl = await estimateLevel(src, streams, await probe(src));
  const level = levelEquirect(streams, lvl);
  const path = await computeYawPath(src, streams, level);
  const yaws = path.map((p) => p.yaw);
  console.log(`[followtest] streams=${streams} level=${lvl ? `${lvl.yaw.toFixed(1)}/${lvl.pitch.toFixed(1)}` : "roll90"} path=${path.length} yaw[min/max]=${yaws.length ? Math.min(...yaws).toFixed(0) + "/" + Math.max(...yaws).toFixed(0) : "n/a"}`);
  const dir = mkdtempSync(join(tmpdir(), "cw-ft-"));
  const cmds = path.filter((p) => p.t <= secs).map((p) => `${p.t.toFixed(2)} v360@rf yaw ${p.yaw.toFixed(1)};`).join("\n");
  writeFileSync(join(dir, "cmds.txt"), cmds);
  const out = "/tmp/followtest.mp4";
  await ffmpeg(["-t", String(secs), "-i", src, "-filter_complex", `${hstack}${level},sendcmd=f=${fwd(join(dir, "cmds.txt"))},v360@rf=input=e:output=flat:h_fov=110:v_fov=100:w=1280:h=720,format=yuv420p[v]`, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", out]);
  console.log(`[followtest] → ${out} dur=${(await probe(out)).toFixed(1)}s`);
  rmSync(dir, { recursive: true, force: true });
  await sql.end();
}

// Diagnostic: `--ranktest <video> [need] [k]` ranks a clip's best moments (motion + vision)
// and stitches a montage of them to /tmp/ranktest.mp4 (no DB). Verifies best-moment selection.
async function ranktest() {
  const i = process.argv.indexOf("--ranktest");
  const src = process.argv[i + 1];
  const need = Number(process.argv[i + 2]) || 4;
  const k = Number(process.argv[i + 3]) || 7;
  if (!src) { console.error("usage: --ranktest <video> [need] [k]"); process.exit(2); }
  const dur = await probe(src);
  const offs = await rankWindows(src, need, dur, k);
  console.log(`[ranktest] dur=${dur.toFixed(1)}s need=${need}s vision=${OLLAMA_URL ? OLLAMA_MODEL : "off"}`);
  console.log(`[ranktest] ranked offsets: ${offs.map((o) => o.toFixed(1)).join(", ")}`);
  const dir = mkdtempSync(join(tmpdir(), "cw-rank-"));
  const parts = [];
  for (let j = 0; j < offs.length; j++) {
    const p = join(dir, `p${j}.mp4`);
    await ffmpeg(["-ss", String(offs[j]), "-i", src, "-t", String(need), "-vf", "scale=640:-2,fps=30", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", p]);
    parts.push(p);
  }
  const listFile = join(dir, "list.txt");
  writeFileSync(listFile, parts.map((p) => `file '${p}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "/tmp/ranktest.mp4"]);
  console.log(`[ranktest] → /tmp/ranktest.mp4 (${offs.length} clips)`);
  rmSync(dir, { recursive: true, force: true });
  await sql.end();
}

// Diagnostic: `--filltest <video> <lengthSec> [loop]` builds the real timeline for one clip and
// prints slot count, total, and a coverage histogram (how offsets spread across the clip) — so we
// can confirm the whole clip is used, not just the start. No DB, no render.
async function filltest() {
  const i = process.argv.indexOf("--filltest");
  const src = process.argv[i + 1];
  const lengthSec = Number(process.argv[i + 2]) || 60;
  const forceLoop = process.argv[i + 3] === "loop";
  if (!src) { console.error("usage: --filltest <video> <lengthSec> [loop]"); process.exit(2); }
  const dur = await probe(src);
  const asset = { id: "a1", storage_key: "k1", kind: "video", _src: src };
  const srcDurs = new Map([["k1", dur]]);
  const { slots } = await buildTimeline([asset], [], lengthSec, false, true, srcDurs, false, [], forceLoop);
  const total = slots.reduce((s, x) => s + x.dur, 0);
  const B = 10;
  const hist = new Array(B).fill(0);
  for (const s of slots) hist[Math.min(B - 1, Math.floor((s.offset / Math.max(1, dur)) * B))]++;
  console.log(`[filltest] clip=${dur.toFixed(0)}s target=${lengthSec}s loop=${forceLoop} → ${slots.length} slots, total=${total.toFixed(0)}s`);
  console.log(`[filltest] offset spread over clip (deciles 0→end): ${hist.join(" ")}`);
  console.log(`[filltest] offsets: ${slots.map((s) => s.offset.toFixed(0)).join(",")}`);
  await sql.end();
}

// Diagnostic: `--posttest <video> [title] [topic] [template]` builds the full ready-to-post
// description from a video (vision block steered by topic + channel template) and prints it. No DB.
async function posttest() {
  const i = process.argv.indexOf("--posttest");
  const src = process.argv[i + 1];
  const title = process.argv[i + 2] || "";
  const topic = process.argv[i + 3] || null;
  const template = process.argv[i + 4] || null;
  if (!src) { console.error("usage: --posttest <video> [title] [topic] [template]"); process.exit(2); }
  const post = await generatePostContent(src, title, topic, template);
  console.log("=== POST CONTENT ===\n" + post + "\n=== END ===");
  await sql.end();
}

// Diagnostic: `--xfadetest [N] [chunkSize]` builds N synthetic 2s segments, runs the chunked
// crossfade, concats the chunks, and prints chunk count + duration vs. expected. Verifies the
// OOM-safe crossfade path end-to-end without the DB. Memory is bounded by construction (each
// ffmpeg sees at most `chunkSize` inputs).
async function xfadetest() {
  const i = process.argv.indexOf("--xfadetest");
  const N = Number(process.argv[i + 1]) || 20;
  const K = Number(process.argv[i + 2]) || XFADE_CHUNK;
  const dir = mkdtempSync(join(tmpdir(), "cw-xf-"));
  try {
    const segs = [];
    const durs = [];
    for (let k = 0; k < N; k++) {
      const s = join(dir, `s${k}.mp4`);
      await ffmpeg(["-f", "lavfi", "-i", "testsrc=size=640x360:duration=2:rate=30", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", fwd(s)]);
      segs.push(s);
      durs.push(2);
    }
    const T = 0.3;
    const cc = await crossfadeChunks(dir, segs, durs, T, K);
    const out = join(dir, "xout.mp4");
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", fwd(cc.listFile), "-c", "copy", fwd(out)]);
    const dur = await probe(out);
    const crossfades = N - cc.files.length; // one lost per chunk seam
    const expected = N * 2 - crossfades * T;
    console.log(`[xfadetest] N=${N} chunkSize=${K} → chunks=${cc.files.length} out=${dur.toFixed(2)}s expected≈${expected.toFixed(2)}s`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await sql.end();
  }
}

// Diagnostic: `--captest [nVideos] [nImages] [lengthSec]` builds a synthetic project and prints
// the max times any single clip appears (must be ≤ 2) + how close the fill got to the target.
// Pure slot math (no ffmpeg/DB) — verifies the ≤2×-appearances cap and the stretch-to-fill.
async function captest() {
  const i = process.argv.indexOf("--captest");
  const nV = Number(process.argv[i + 1]) || 5;
  const nI = Number(process.argv[i + 2]) || 5;
  const lengthSec = Number(process.argv[i + 3]) || 300;
  const vLen = Number(process.argv[i + 4]) || 20;
  const assets = [];
  const srcDurs = new Map();
  for (let k = 0; k < nV; k++) { const key = "v" + k; assets.push({ id: "v" + k, storage_key: key, kind: "video" }); srcDurs.set(key, vLen); }
  for (let k = 0; k < nI; k++) assets.push({ id: "i" + k, storage_key: "i" + k, kind: "photo" });
  const { slots } = await buildTimeline(assets, [], lengthSec, false, false, srcDurs, false, [], false, false);
  const total = slots.reduce((s, x) => s + x.dur, 0);
  const counts = new Map();
  for (const s of slots) counts.set(s.asset.id, (counts.get(s.asset.id) ?? 0) + 1);
  const vals = [...counts.values()];
  const over2 = [...counts.entries()].filter(([, c]) => c > 2).map(([id]) => id);
  console.log(`[captest] ${nV} videos(${vLen}s) + ${nI} images, target ${lengthSec}s → ${slots.length} slots, total ${total.toFixed(0)}s`);
  console.log(`[captest] max appearances of any clip = ${Math.max(...vals)} (cap is 2); clips over 2× = ${over2.length ? over2.join(",") : "NONE"}`);
  await sql.end();
}

async function main() {
  if (process.argv.includes("--captest")) return captest();
  if (process.argv.includes("--xfadetest")) return xfadetest();
  if (process.argv.includes("--followtest")) return followtest();
  if (process.argv.includes("--selftest")) return selftest();
  if (process.argv.includes("--posttest")) return posttest();
  if (process.argv.includes("--filltest")) return filltest();
  if (process.argv.includes("--ranktest")) return ranktest();
  if (process.argv.includes("--waltztest")) return waltztest();
  if (process.argv.includes("--overlaytest")) return overlaytest();
  if (process.argv.includes("--convtest")) return convtest();
  console.log(`[worker] ClipWaltz render worker starting (${ONCE ? "once" : "loop"})`);
  if (ONCE) {
    // Don't reap in --once (a manual one-shot could nuke a render the loop service is running).
    const did = await tick();
    if (!did) console.log("[worker] no queued renders");
    await sql.end();
    return;
  }
  await reapStaleRenders().catch((e) => console.error("[worker] reap error:", e.message));
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
