#!/usr/bin/env node
// ClipWaltz render worker.
// Claims a queued render, pulls the project's clips from MinIO, assembles a music
// video with FFmpeg (Editor Phase 1: aspect, Ken Burns, color filters, fades,
// crossfade transitions, title overlay, watermark), uploads it, and updates the DB.
//
//   node --env-file=.env.local worker/render-worker.mjs --once   # one job then exit
//   node --env-file=.env.local worker/render-worker.mjs          # loop
//
// Prod host: the AI box (FFmpeg). Needs DATABASE_URL (SSH tunnel to linuxg1:5432)
// and the S3_* env for MinIO.
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
const PER_IMAGE = 2; // seconds per photo
const PER_VIDEO = 4; // max seconds per video clip

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

// --- canvas + look helpers ------------------------------------------------
function dims(aspect) {
  return aspect === "16:9" ? [1920, 1080] : [1080, 1920];
}
// Static fit-and-pad to the canvas.
function vfStatic(W, H) {
  return `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
}
// Ken Burns slow zoom on a still (single image input, no -loop; caps at `frames`).
function vfKenBurns(W, H, frames) {
  return (
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
    `scale=${W * 2}:${H * 2},` +
    `zoompan=z='min(zoom+0.0009,1.22)':d=${frames}:` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=30,setsar=1`
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
// Keep only drawtext-safe characters (avoids escaping pitfalls).
function safeText(s) {
  return String(s || "")
    .replace(/[^A-Za-z0-9 .,!?&#@()\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

async function download(key, file) {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const bytes = await out.Body.transformToByteArray();
  writeFileSync(file, Buffer.from(bytes));
}

async function ffmpeg(args) {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    maxBuffer: 1024 * 1024 * 32,
  });
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

async function assemble(dir, assets, music, watermark, lengthSec, aspect, style) {
  const [W, H] = dims(aspect);
  const V = vfStatic(W, H);
  const frames = Math.round(PER_IMAGE * 30);
  const segments = [];
  const durations = [];

  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    const ext = (a.original_name?.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "") || "bin";
    const src = join(dir, `src${i}.${ext}`);
    await download(a.storage_key, src);
    const seg = join(dir, `seg${i}.mp4`);
    const enc = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", seg];
    let cmd;
    if (a.kind === "video") {
      cmd = ["-t", String(PER_VIDEO), "-i", src, "-vf", V, ...enc];
    } else if (style.motion) {
      cmd = ["-i", src, "-vf", vfKenBurns(W, H, frames), "-frames:v", String(frames), ...enc];
    } else {
      cmd = ["-loop", "1", "-t", String(PER_IMAGE), "-i", src, "-vf", V, ...enc];
    }
    await ffmpeg(cmd);
    segments.push(seg);
    durations.push(await probe(seg));
  }

  const listFile = join(dir, "concat.txt");
  writeFileSync(listFile, segments.map((s) => `file '${fwd(s)}'`).join("\n"));

  let musicFile = null;
  if (music) {
    const mext = (music.storage_key.split(".").pop() ?? "mp3").replace(/[^a-z0-9]/gi, "") || "mp3";
    musicFile = join(dir, `music.${mext}`);
    await download(music.storage_key, musicFile);
  }

  const out = join(dir, "out.mp4");
  const total = durations.reduce((s, d) => s + (d || PER_IMAGE), 0);
  const minDur = Math.min(...durations.map((d) => d || PER_IMAGE));
  const T = Math.max(0.2, Math.min(0.5, minDur * 0.4)); // crossfade duration
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
        const off = (acc - T).toFixed(3);
        chain += `${label}[${j}:v]xfade=transition=fade:duration=${T.toFixed(3)}:offset=${off}[vx${j}];`;
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
    if (musicFile) args.push("-stream_loop", "-1", "-i", fwd(musicFile));
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
    // drawtext (fonts) or xfade can fail on some inputs — fall back to a plain cut.
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
  };

  const dir = mkdtempSync(join(tmpdir(), "cw-render-"));
  try {
    console.log(
      `[worker] render ${r.id}: ${assets.length} clips${music ? ` + ${music.title}` : " (no music)"}, ` +
        `${lengthSec}s, ${aspect}, ${style.transition}${style.motion ? " +motion" : ""} ${style.styleFilter}`,
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

async function main() {
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
