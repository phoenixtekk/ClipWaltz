#!/usr/bin/env node
// ClipWaltz render worker.
// Claims a queued render, pulls the project's clips from MinIO, assembles a 9:16
// music video with FFmpeg, uploads the result, and updates the DB.
//
// Run from the project root (reuses its node_modules):
//   node --env-file=.env.local worker/render-worker.mjs --once   # process one job then exit
//   node --env-file=.env.local worker/render-worker.mjs          # loop
//
// Prod host: the AI box (32-core, FFmpeg). Needs DATABASE_URL reachable (SSH tunnel
// to linuxg1:5432) and the S3_* env for MinIO.
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
const V = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30";

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

async function assemble(dir, assets, music, watermark, lengthSec) {
  const segments = [];
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    const ext = (a.original_name?.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "") || "bin";
    const src = join(dir, `src${i}.${ext}`);
    await download(a.storage_key, src);
    const seg = join(dir, `seg${i}.mp4`);
    const base =
      a.kind === "video"
        ? ["-t", String(PER_VIDEO), "-i", src]
        : ["-loop", "1", "-t", String(PER_IMAGE), "-i", src];
    await ffmpeg([
      ...base, "-vf", V, "-an", "-c:v", "libx264", "-preset", "veryfast",
      "-crf", "20", "-pix_fmt", "yuv420p", seg,
    ]);
    segments.push(seg);
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
  const wm =
    "drawtext=text='ClipWaltz':fontcolor=white@0.85:fontsize=44:x=w-tw-32:y=h-th-44:box=1:boxcolor=black@0.35:boxborderw=12";

  async function finalRender(useWatermark) {
    const args = ["-f", "concat", "-safe", "0", "-i", fwd(listFile)];
    if (musicFile) args.push("-stream_loop", "-1", "-i", fwd(musicFile));
    if (useWatermark) args.push("-vf", wm);
    if (musicFile) args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest");
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p");
    if (musicFile) args.push("-c:a", "aac", "-b:a", "192k");
    if (lengthSec > 0) args.push("-t", String(lengthSec)); // cap to project length
    args.push(fwd(out));
    await ffmpeg(args);
  }

  try {
    await finalRender(watermark);
  } catch (e) {
    if (watermark) {
      // drawtext can fail if no fonts are available — fall back to no watermark.
      console.warn("[worker] watermark render failed, retrying without:", e.message);
      await finalRender(false);
    } else {
      throw e;
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
    order by order_index asc, created_at asc`;
  if (assets.length === 0) throw new Error("no uploaded assets");

  // Prefer the project's chosen track; else the first active track; else silent.
  let music = null;
  if (project?.music_track_id) {
    [music] = await sql`select * from music_tracks where id = ${project.music_track_id} and active = true`;
  }
  if (!music) {
    [music] = await sql`select * from music_tracks where active = true order by created_at asc limit 1`;
  }
  const lengthSec = project?.length_sec ?? 30;

  const dir = mkdtempSync(join(tmpdir(), "cw-render-"));
  try {
    console.log(
      `[worker] render ${r.id}: ${assets.length} clips${music ? ` + ${music.title}` : " (no music)"}, ${lengthSec}s`,
    );
    const out = await assemble(dir, assets, music ?? null, r.watermark, lengthSec);
    const key = `renders/${r.project_id}/${r.id}.mp4`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: readFileSync(out),
        ContentType: "video/mp4",
      }),
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
  // loop
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
