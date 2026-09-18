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

// Build the ordered timeline: [{asset, dur, offset}]. Beat-synced when possible.
async function buildTimeline(assets, beats, lengthSec, beatSync, smartCut, srcDurs) {
  const slots = [];
  let musicOffset = 0;
  const cap = lengthSec > 0 ? lengthSec : Infinity;

  if (beatSync && beats.length > 5) {
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

  // Resolve active-moment offsets for video slots.
  for (const s of slots) {
    if (s.asset.kind === "video" && smartCut) {
      s.offset = await pickWindow(s.asset._src, s.dur, srcDurs.get(s.asset.storage_key) ?? 0);
    } else {
      s.offset = 0;
    }
  }
  return { slots, musicOffset };
}

async function assemble(dir, assets, music, watermark, lengthSec, aspect, style) {
  const [W, H] = dims(aspect);
  const V = vfStatic(W, H);

  // Download sources first (need durations for smart windowing + timeline).
  const srcDurs = new Map();
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    const ext = (a.original_name?.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "") || "bin";
    a._src = join(dir, `src${i}.${ext}`);
    await download(a.storage_key, a._src);
    if (a.kind === "video") srcDurs.set(a.storage_key, await probe(a._src));
  }

  let musicFile = null;
  let beats = [];
  if (music) {
    const mext = (music.storage_key.split(".").pop() ?? "mp3").replace(/[^a-z0-9]/gi, "") || "mp3";
    musicFile = join(dir, `music.${mext}`);
    await download(music.storage_key, musicFile);
    if (style.beatSync) beats = await getBeats(musicFile);
  }

  const { slots, musicOffset } = await buildTimeline(
    assets,
    beats,
    lengthSec,
    style.beatSync,
    style.smartCut,
    srcDurs,
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
    if (useTitle && titleT) {
      const fs = Math.round(H * 0.055);
      parts.push(
        `drawtext=text='${titleT}':fontcolor=white:fontsize=${fs}:x=(w-tw)/2:y=${Math.round(H * 0.12)}:` +
          `box=1:boxcolor=black@0.4:boxborderw=16:enable='between(t,0.2,3.0)':` +
          `alpha='if(lt(t,0.6),(t-0.2)/0.4,if(gt(t,2.6),(3.0-t)/0.4,1))'`,
      );
    }
    if (useWatermark) parts.push(WM);
    if (style.fades) {
      parts.push("fade=t=in:st=0:d=0.5");
      if (outDur > 1.6) parts.push(`fade=t=out:st=${(outDur - 0.7).toFixed(2)}:d=0.7`);
    }
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
  return out;
}

async function processRender(r) {
  const started = Date.now();
  const [project] = await sql`select * from projects where id = ${r.project_id}`;
  const assets = await sql`
    select * from assets
    where project_id = ${r.project_id} and upload_state = 'uploaded'
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
    transition: project?.transition ?? "cut",
    motion: project?.motion ?? true,
    fades: project?.fades ?? true,
    smartCut: project?.smart_cut ?? true,
    beatSync: project?.beat_sync ?? true,
  };

  const dir = mkdtempSync(join(tmpdir(), "cw-render-"));
  try {
    console.log(
      `[worker] render ${r.id}: ${assets.length} clips${music ? ` + ${music.title}` : ""}, ${lengthSec}s ${aspect} ` +
        `${style.transition}${style.smartCut ? " +smart" : ""}${style.beatSync ? " +beat" : ""} ${style.styleFilter}`,
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

async function main() {
  if (process.argv.includes("--selftest")) return selftest();
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
