#!/usr/bin/env node
// Seed / update the ClipWaltz music catalog from a manifest: upload each bed file to
// MinIO and upsert its music_tracks row. Idempotent.
//
//   node --env-file=.env.local scripts/seed-music.mjs <manifest.json> <media-dir> [--allow-placeholder]
//
// The manifest carries the REAL per-track licence reference (proof the track is safe to
// post). Tracks whose licenseRef is missing or still a PLACEHOLDER are refused unless you
// pass --allow-placeholder (dev only) — that guard is what keeps unlicensed beds from
// reaching the live catalog. See MUSIC_CATALOG.md for sourcing + the go-live checklist.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const args = process.argv.slice(2);
const allowPlaceholder = args.includes("--allow-placeholder");
const [manifestPath, dir] = args.filter((a) => !a.startsWith("--"));
if (!manifestPath || !dir) {
  throw new Error("usage: seed-music.mjs <manifest.json> <media-dir> [--allow-placeholder]");
}

const PLACEHOLDER = "PLACEHOLDER-DO-NOT-SHIP";
const isPlaceholder = (ref) => !ref || ref.trim() === "" || ref.includes(PLACEHOLDER);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const tracks = Array.isArray(manifest.tracks) ? manifest.tracks : [];
if (tracks.length === 0) throw new Error("manifest has no tracks[]");

const bad = tracks.filter((t) => isPlaceholder(t.licenseRef));
if (bad.length && !allowPlaceholder) {
  throw new Error(
    `refusing to seed ${bad.length} track(s) with a placeholder/empty licenseRef: ` +
      `${bad.map((t) => t.id).join(", ")}. Add a real licence reference in the manifest, ` +
      `or pass --allow-placeholder for local dev only.`,
  );
}

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

for (const t of tracks) {
  const ext = (t.file.split(".").pop() ?? "m4a").toLowerCase();
  const contentType = ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/mp4" : "audio/mpeg";
  const key = `music/${t.id}.${ext}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: readFileSync(join(dir, t.file)),
      ContentType: contentType,
    }),
  );
  const active = t.active !== false;
  await sql`
    insert into music_tracks (id, title, artist, license_ref, bpm, mood, duration_sec, storage_key, active)
    values (${t.id}, ${t.title}, ${t.artist ?? null}, ${t.licenseRef}, ${t.bpm ?? null},
            ${t.mood ?? null}, ${t.durationSec ?? null}, ${key}, ${active})
    on conflict (id) do update set
      title=excluded.title, artist=excluded.artist, license_ref=excluded.license_ref,
      bpm=excluded.bpm, mood=excluded.mood, duration_sec=excluded.duration_sec,
      storage_key=excluded.storage_key, active=excluded.active`;
  console.log(
    `seeded ${t.id} — ${t.title}${t.mood ? ` (${t.mood})` : ""}${t.bpm ? ` ${t.bpm} BPM` : ""} → ${key}` +
      `${isPlaceholder(t.licenseRef) ? "  ⚠ PLACEHOLDER LICENCE" : ""}`,
  );
}

const [{ n }] = await sql`select count(*)::int as n from music_tracks where active=true`;
const [{ p }] = await sql`
  select count(*)::int as p from music_tracks where active=true and license_ref like ${"%" + PLACEHOLDER + "%"}`;
console.log(`music_tracks active: ${n}${p ? `  (⚠ ${p} still on a placeholder licence — do not ship)` : ""}`);
await sql.end();
