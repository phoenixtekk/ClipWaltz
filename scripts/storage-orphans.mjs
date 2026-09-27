#!/usr/bin/env node
// Find (and optionally delete) MinIO objects left behind by deleted projects: everything under
// projects/<id>/, renders/<id>/, generations/<id>/ and exports/<id>/ whose project row no longer
// exists, plus library `media` rows uploaded into such a project that no clip uses any more (and
// their media/<id>-flat.* conversions). An object any DB row still references is ALWAYS kept — the
// media library shares one upload between projects. Dry run by default; nothing is deleted without
// --apply. Needs DATABASE_URL + S3_* (the worker's .env.worker has both):
//   node --env-file=.env.worker scripts/storage-orphans.mjs                 # report only
//   node --env-file=.env.worker scripts/storage-orphans.mjs --project <id>  # one project id only
//   node --env-file=.env.worker scripts/storage-orphans.mjs --apply         # delete
import postgres from "postgres";
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const onlyProject = args.includes("--project") ? args[args.indexOf("--project") + 1] : null;
const verbose = args.includes("--verbose");
const force = args.includes("--force");
if (args.includes("--project") && !onlyProject) { console.error("--project needs an id"); process.exit(1); }
for (const v of ["DATABASE_URL", "S3_ACCESS_KEY", "S3_SECRET_KEY"]) {
  if (!process.env[v]) { console.error(`${v} not set (run with --env-file=.env.worker)`); process.exit(1); }
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const BUCKET = process.env.S3_BUCKET ?? "clipwaltz";
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://192.168.166.169:9000",
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
});
const PREFIXES = ["projects", "renders", "generations", "exports"];

/** Objects (key + size) under a prefix. */
async function list(prefix) {
  const out = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: Number(o.Size ?? 0) });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Keys from `keys` that any row still references (same tables as src/lib/project-storage.ts). */
async function referenced(keys) {
  const out = new Set();
  for (let i = 0; i < keys.length; i += 500) {
    const k = keys.slice(i, i + 500);
    const rows = await sql`
      select storage_key k from assets where storage_key in ${sql(k)}
      union select converted_key from assets where converted_key in ${sql(k)}
      union select storage_key from media where storage_key in ${sql(k)}
      union select converted_key from media where converted_key in ${sql(k)}
      union select output_key from renders where output_key in ${sql(k)}
      union select output_key from generation_versions where output_key in ${sql(k)}
      union select clean_key from generation_versions where clean_key in ${sql(k)}
      union select thumbnail_key from generation_versions where thumbnail_key in ${sql(k)}
      union select output_key from export_jobs where output_key in ${sql(k)}
      union select storage_key from music_tracks where storage_key in ${sql(k)}
      union select thumbnail_key from templates where thumbnail_key in ${sql(k)}`;
    for (const r of rows) out.add(r.k);
  }
  return out;
}

const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

try {
  const existing = new Set((await sql`select id from projects`).map((r) => r.id));

  // 1) Orphan media rows: uploaded into a now-missing project, used by no clip. Deleting them first
  //    (on --apply) releases their objects for step 2.
  const mediaRows = await sql`
    select m.id, m.storage_key, m.converted_key from media m
    where m.storage_key like 'projects/%'
      and not exists (select 1 from assets a where a.media_id = m.id)`;
  const orphanMedia = mediaRows.filter((m) => {
    const pid = m.storage_key.split("/")[1];
    return !existing.has(pid) && (!onlyProject || pid === onlyProject);
  });

  // 2) Objects under per-project prefixes whose project is gone.
  const report = {};
  const candidates = []; // { key, size }
  const seen = new Set(); // every project id with objects in the bucket
  for (const p of PREFIXES) {
    const objs = await list(onlyProject ? `${p}/${onlyProject}/` : `${p}/`);
    const e = (report[p] = { projectsGone: new Set(), objects: 0, bytes: 0 });
    for (const o of objs) {
      const pid = o.key.split("/")[1];
      if (pid) seen.add(pid);
      if (!pid || existing.has(pid)) continue;
      e.projectsGone.add(pid);
      e.objects++;
      e.bytes += o.size;
      candidates.push(o);
    }
  }
  // Conversions of orphan media live under media/, not a project prefix.
  const convKeys = orphanMedia.map((m) => m.converted_key).filter(Boolean);

  // Keys still referenced by a row that is NOT one of the orphan media rows we'd delete.
  const orphanMediaKeys = new Set(orphanMedia.flatMap((m) => [m.storage_key, m.converted_key]).filter(Boolean));
  const allKeys = [...new Set([...candidates.map((c) => c.key), ...convKeys])];
  const refs = await referenced(allKeys);
  const stillShared = new Set([...refs].filter((k) => !orphanMediaKeys.has(k)));
  // An orphan-media key also referenced by some OTHER row (e.g. an asset without media_id) stays.
  if (orphanMediaKeys.size) {
    const others = await sql`
      select storage_key k from assets where storage_key in ${sql([...orphanMediaKeys])}
      union select converted_key from assets where converted_key in ${sql([...orphanMediaKeys])}
      union select storage_key from media where storage_key in ${sql([...orphanMediaKeys])}
        and id not in ${sql(orphanMedia.map((m) => m.id))}
      union select converted_key from media where converted_key in ${sql([...orphanMediaKeys])}
        and id not in ${sql(orphanMedia.map((m) => m.id))}`;
    for (const r of others) stillShared.add(r.k);
  }
  const sizeOf = new Map(candidates.map((c) => [c.key, c.size]));
  const doomed = allKeys.filter((k) => !stillShared.has(k));

  console.log(`${apply ? "APPLY" : "DRY RUN"} — bucket ${BUCKET}${onlyProject ? `, project ${onlyProject}` : ""}`);
  for (const [p, e] of Object.entries(report)) {
    console.log(`  ${p}/: ${e.projectsGone.size} deleted-project prefixes, ${e.objects} objects, ${mb(e.bytes)}`);
  }
  console.log(`  orphan media rows: ${orphanMedia.length} (+${convKeys.length} conversions under media/)`);
  console.log(`  kept (still referenced by a live row): ${allKeys.length - doomed.length}`);
  console.log(`  to delete: ${doomed.length} objects, ${mb(doomed.reduce((s, k) => s + (sizeOf.get(k) ?? 0), 0))} (conversion sizes not counted)`);
  if (verbose) for (const k of doomed) console.log(`    ${k}`);

  // Wrong-DB guard: pointed at a DB that doesn't hold this bucket's projects (e.g. dev vs the shared prod
  // bucket), nearly every prefix looks deleted. Refuse a bucket-wide apply that would wipe most of it.
  const gone = new Set(Object.values(report).flatMap((e) => [...e.projectsGone]));
  if (apply && !onlyProject && seen.size >= 10 && gone.size > seen.size / 2 && !force) {
    console.error(`REFUSING: ${gone.size} of ${seen.size} project ids in the bucket are missing from this DB — wrong DATABASE_URL? (--force overrides)`);
    process.exitCode = 1;
  } else if (!apply) {
    console.log("Nothing deleted. Re-run with --apply to delete.");
  } else {
    if (orphanMedia.length) {
      await sql`delete from media where id in ${sql(orphanMedia.map((m) => m.id))}
        and not exists (select 1 from assets a where a.media_id = media.id)`;
    }
    let ok = 0, failed = 0;
    for (let i = 0; i < doomed.length; i += 8) {
      await Promise.all(doomed.slice(i, i + 8).map(async (k) => {
        try { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k })); ok++; }
        catch (e) { failed++; console.error(`  delete ${k} failed: ${e.message}`); }
      }));
    }
    console.log(`Deleted ${orphanMedia.length} media rows, ${ok} objects (${failed} failed).`);
  }
} finally {
  await sql.end();
}
