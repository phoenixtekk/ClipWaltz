#!/usr/bin/env node
// Seed the ClipWaltz music catalog: upload bed files to MinIO + insert music_tracks rows.
// Idempotent. Usage: node --env-file=.env.local scripts/seed-music.mjs <dir-with-m4a-files>
//
// NOTE: the generated beds are PLACEHOLDERS (license_ref=PLACEHOLDER-DO-NOT-SHIP).
// Replace with real licensed royalty-free tracks before launch.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const dir = process.argv[2];
if (!dir) throw new Error("pass the music dir as an argument");

const TRACKS = [
  { id: "t-sunlit", title: "Sunlit", artist: "ClipWaltz", mood: "upbeat", bpm: 120, file: "sunlit.m4a" },
  { id: "t-drift", title: "Drift", artist: "ClipWaltz", mood: "chill", bpm: 90, file: "drift.m4a" },
  { id: "t-goldenhour", title: "Golden Hour", artist: "ClipWaltz", mood: "cinematic", bpm: 100, file: "goldenhour.m4a" },
];

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

for (const t of TRACKS) {
  const key = `music/${t.id}.m4a`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: readFileSync(join(dir, t.file)),
      ContentType: "audio/mp4",
    }),
  );
  await sql`
    insert into music_tracks (id, title, artist, license_ref, bpm, mood, duration_sec, storage_key, active)
    values (${t.id}, ${t.title}, ${t.artist}, ${"PLACEHOLDER-DO-NOT-SHIP"}, ${t.bpm}, ${t.mood}, ${40}, ${key}, ${true})
    on conflict (id) do update set title=excluded.title, storage_key=excluded.storage_key, bpm=excluded.bpm, mood=excluded.mood, active=true`;
  console.log(`seeded ${t.id} (${t.mood}, ${t.bpm} BPM) → ${key}`);
}

const rows = await sql`select count(*)::int as n from music_tracks where active=true`;
console.log(`music_tracks active: ${rows[0].n}`);
await sql.end();
