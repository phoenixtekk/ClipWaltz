#!/usr/bin/env node
// Waltz Image verification (plan G1 acceptance 1–3). Runs the SAME job code the generation worker runs
// (worker/image/job.mjs → ComfyUI on IMAGE_COMFYUI_URL) against a dev database + MinIO, without Redis.
//
//   node --env-file=.env.local scripts/verify-image-presets.mjs --email <test account> [--presets 1:1,4:5] [--fail]
//
// For each preset: a generation_jobs row (job_type 'image', 2 credits) + its image_design_images row in one design
// owned by the account's personal workspace → runImageJob → the stored PNG is read back and its pixel size compared
// with the preset. Then the compositor is checked: the same headline composited twice is byte-identical, a different
// headline changes the pixels, and no-text vs text differ only where the text is drawn.
// --fail: one job with a checkpoint the box doesn't have → must throw; it is then marked failed exactly as the worker's
// final-attempt handler does, and the account's spent credits must drop back (refund).
// Never touches production: refuses a DATABASE_URL that is not the dev database.
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const email = arg("--email");
if (!email) { console.error("--email <account> required"); process.exit(2); }
if (!/clipwaltz_dev/.test(process.env.DATABASE_URL ?? "")) { console.error("Refusing: DATABASE_URL is not the dev database."); process.exit(2); }

if (args.includes("--fail")) process.env.IMAGE_COMFYUI_CKPT = "does-not-exist.safetensors";
const { runImageJob, afterImageJobFailure } = await import("../worker/image/job.mjs");
const { IMAGE_FORMATS } = await import("../worker/image/presets.mjs");
const { composeImage, imageSize } = await import("../worker/image/compose.mjs");
const { loadImage, createCanvas } = await import("@napi-rs/canvas");

const sql = postgres(process.env.DATABASE_URL, { prepare: false, onnotice: () => {} });
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION ?? "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? "", secretAccessKey: process.env.S3_SECRET_KEY ?? "" },
});
const BUCKET = process.env.S3_BUCKET ?? "clipwaltz";
const putBytes = (Key, Body, ContentType) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body, ContentType }));
const getBytes = async (Key) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }))).Body.transformToByteArray());
const setStatus = async (id, fields) => { await sql`update generation_jobs set ${sql(fields)}, updated_at = now() where id = ${id}`; };
const wasCancelled = async (id) => ["cancelled", "retried"].includes((await sql`select status from generation_jobs where id = ${id}`)[0]?.status);
const spent = async (uid) => (await sql`select coalesce(sum(credits),0)::int n from generation_jobs where requested_by = ${uid}
  and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc' and status not in ('failed','cancelled','retried')`)[0].n;

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

const [u] = await sql`select id from "user" where email = ${email}`;
if (!u) { console.error("no such account"); process.exit(2); }
const [ws] = await sql`select id from workspaces where owner_user_id = ${u.id} and is_personal = true limit 1`;
if (!ws) { console.error("account has no personal workspace (sign in once first)"); process.exit(2); }

const designId = randomUUID();
await sql`insert into image_designs ${sql({ id: designId, workspace_id: ws.id, created_by: u.id, kind: "image", title: `Verify presets ${new Date().toISOString().slice(0, 16)}`,
  format: "1:1", data: sql.json({ brief: "", style: "photographic", layout: "ad-left", headline: "Spring sale: 30% off every handmade mug", subhead: "Glazed by hand in small batches.", cta: "Shop now", useBrand: true, imageId: null }) })}`;
console.log(`design ${designId} (workspace ${ws.id})`);

async function oneJob(fmt, brief) {
  const jobId = randomUUID(), imageId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`insert into generation_jobs ${tx({ id: jobId, credits: 2, project_id: null, workspace_id: ws.id, requested_by: u.id, job_type: "image", status: "queued",
      model_name: "flux-schnell", workflow_name: "comfy-image", prompt: brief,
      request_json: tx.json({ workflow: "comfy-image", brief, style: "photographic", format: fmt.key, width: fmt.width, height: fmt.height, enhance: true, designId, imageId }) })}`;
    await tx`insert into image_design_images ${tx({ id: imageId, design_id: designId, workspace_id: ws.id, source: "ai", generation_job_id: jobId, prompt: brief })}`;
  });
  const [j] = await sql`select * from generation_jobs where id = ${jobId}`;
  return { jobId, imageId, j };
}

if (args.includes("--fail")) {
  const before = await spent(u.id);
  const { jobId, j } = await oneJob(IMAGE_FORMATS[0], "A red bicycle against a white wall");
  const during = await spent(u.id);
  let threw = null;
  try { await runImageJob({ sql, putBytes, setStatus, wasCancelled }, j); } catch (e) { threw = e; }
  check("bad checkpoint → job throws", !!threw, threw?.message?.slice(0, 120));
  // Exactly what generation-worker.mjs markAttemptFailed does on the final attempt:
  await sql`update generation_jobs set status = 'failed', error_message = ${String(threw?.message ?? "").slice(0, 1000)}, failed_at = now(), updated_at = now()
    where id = ${jobId} and status not in ('cancelled', 'retried')`;
  await afterImageJobFailure(sql, jobId);
  const after = await spent(u.id);
  check("credits charged while queued", during === before + 2, `${before} → ${during}`);
  check("failed job refunded", after === before, `${during} → ${after}`);
  await sql.end();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

const want = (arg("--presets") ?? IMAGE_FORMATS.map((f) => f.key).join(",")).split(",");
let firstKey = null;
for (const fmt of IMAGE_FORMATS.filter((f) => want.includes(f.key))) {
  const t0 = Date.now();
  const { jobId, imageId, j } = await oneJob(fmt, "Handmade ceramic mugs on a sunny kitchen counter");
  try {
    const r = await runImageJob({ sql, putBytes, setStatus, wasCancelled }, j);
    const [row] = await sql`select storage_key from image_design_images where id = ${imageId}`;
    const stored = await getBytes(row.storage_key);
    const size = await imageSize(stored);
    const [job] = await sql`select status from generation_jobs where id = ${jobId}`;
    firstKey ??= row.storage_key;
    check(`${fmt.key} exact size`, size.width === fmt.width && size.height === fmt.height && job.status === "completed",
      `${size.width}×${size.height} (want ${fmt.width}×${fmt.height}), job ${job.status}, seed ${r?.seed}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    check(`${fmt.key} exact size`, false, e.message);
  }
}
if (firstKey) await sql`update image_designs set data = jsonb_set(data, '{imageId}', to_jsonb((select id from image_design_images where storage_key = ${firstKey}))) where id = ${designId}`;

// ── Compositor: pixel-exact, deterministic, re-composites without a GPU job ───────────────────────────────────────
if (firstKey) {
  const bg = await getBytes(firstKey);
  const brand = { primary: "#1d3557", secondary: "#f4a261", headingFont: "Montserrat", bodyFont: "Inter" };
  const base = { width: 1080, height: 1080, layout: "ad-left", background: bg, brand };
  const jobsBefore = (await sql`select count(*)::int n from generation_jobs where requested_by = ${u.id}`)[0].n;
  const a1 = await composeImage({ ...base, text: { headline: "Spring sale: 30% off", subhead: "This week only", cta: "Shop now" } });
  const a2 = await composeImage({ ...base, text: { headline: "Spring sale: 30% off", subhead: "This week only", cta: "Shop now" } });
  const b = await composeImage({ ...base, text: { headline: "Summer sale: 40% off", subhead: "This week only", cta: "Shop now" } });
  const jobsAfter = (await sql`select count(*)::int n from generation_jobs where requested_by = ${u.id}`)[0].n;
  check("same headline twice → identical bytes", Buffer.compare(a1.png, a2.png) === 0, `${a1.png.length} bytes`);
  const diff = await pixelDiff(a1.png, b.png);
  check("edited headline → pixels change only in the text area", diff.changed > 0 && diff.box.y1 < 1080 * 0.75 && diff.box.x1 < 1080 * 0.85,
    `${diff.changed} px changed in box x ${diff.box.x0}–${diff.box.x1}, y ${diff.box.y0}–${diff.box.y1}`);
  check("re-compositing created no generation job", jobsAfter === jobsBefore, `${jobsBefore} → ${jobsAfter}`);
}

async function pixelDiff(p1, p2) {
  const [i1, i2] = await Promise.all([loadImage(p1), loadImage(p2)]);
  const read = (img) => { const c = createCanvas(img.width, img.height); const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
  const d1 = read(i1), d2 = read(i2);
  let changed = 0; const box = { x0: Infinity, y0: Infinity, x1: -1, y1: -1 };
  for (let i = 0; i < d1.length; i += 4) {
    if (d1[i] !== d2[i] || d1[i + 1] !== d2[i + 1] || d1[i + 2] !== d2[i + 2]) {
      changed++; const p = i / 4, x = p % i1.width, y = Math.floor(p / i1.width);
      box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
    }
  }
  return { changed, box };
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed · design ${designId}`);
await sql.end();
process.exit(results.every((r) => r.ok) ? 0 : 1);
