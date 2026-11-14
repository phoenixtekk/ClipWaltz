#!/usr/bin/env node
// One-time import of Social Publishing (publish.phoenixtekk.com) into ClipWaltz — plan
// docs/PREDIS_PARITY_AND_PUBLISH_MERGE_PLAN.md §4.2 / §5 / P4, ADR-0011.
//
//   node --env-file=.env.local scripts/migrate-social-publishing.mjs                 # DRY RUN (default): report only
//   node --env-file=.env.local scripts/migrate-social-publishing.mjs --apply         # copy rows + media, all HELD
//   node --env-file=.env.local scripts/migrate-social-publishing.mjs --activate      # cut-over (see below)
//
// Options:
//   --map sp@email=cw@email   map an SP account to a ClipWaltz account with a different address (repeatable). No
//                             account is ever created: an SP user with no ClipWaltz account is reported and skipped.
//   --skip-media              copy no media files (rows of media whose object is not in storage are then skipped)
//   --media-limit N           copy at most N media files this run (testing)
//   --report <file>           also write the JSON report there
//   --state <file>            --activate only: resume from a state file written by an earlier --activate
//
// Env: DATABASE_URL (ClipWaltz), SP_DATABASE_URL (Social Publishing; only READ, except by --activate),
//      SP_MEDIA_DIR (default /home/lacy/social-publishing-data/media), SP_ENV_FILE (default
//      /home/lacy/social-publishing/.env.local — read only for FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN),
//      SP_OWNER_EMAIL (default lacy@phoenixtekk.com — whose workspace gets the env-configured Facebook Page),
//      TOKEN_ENC_KEY (same key as the app; required for --apply / --activate), S3_ENDPOINT / S3_REGION / S3_BUCKET /
//      S3_ACCESS_KEY / S3_SECRET_KEY.
//
// What is copied (FK order; ids are preserved, every insert is ON CONFLICT DO NOTHING, so re-running is safe):
//   social_connection → social_connections (tokens re-encrypted with TOKEN_ENC_KEY; provider "podcast" skipped — P5)
//   post → social_posts, post_target → social_post_targets, media → social_media (+ file disk → MinIO
//   social/<workspace>/<id>), auto_post_rule → social_auto_rules, auto_post_preset → social_auto_presets,
//   snippet → social_snippets, ai_generation → social_ai_generations, and the app_setting keys ClipWaltz reads
//   (app:timezone, post:max_chars, mastodon_app:*) → app_settings "social:<key>".
//   Not copied: users/sessions/billing/invites (ClipWaltz accounts are used), funnels, podcast, research, shorts.
//
// DOUBLE-POST GUARD (plan R3). While SP is live, everything that could publish lands HELD in ClipWaltz:
// migration_hold = 'sp-import' on every imported connection (no token refresh — SP owns rotation), every auto rule,
// every post whose status is not 'published' and every destination whose status is not 'published'. The ClipWaltz
// sweep, retries, the publish-target job, publishPost and the Retry button all skip held rows (migration 0067).
//
// --activate (cut-over, run once, only when the owner says so). In this order:
//   (a) on SP, in one transaction: refuse if anything is mid-flight (a post publishing/rendering, a destination
//       pending/publishing); capture the state of what SP would still publish — active rules, scheduled/queued posts,
//       failed destinations with a retry — write it to a state file, then pause it on SP (rules inactive, those posts
//       to 'draft', retries cleared) and commit;
//   (b) on ClipWaltz, in one transaction: import anything new (held), re-sync every held row from SP's current data
//       with the captured pre-pause state laid over it (so nothing SP already published is released as unpublished),
//       re-copy connection tokens (SP may have refreshed them), mark rows deleted on SP 'sp-deleted' (they stay held
//       for good), then clear 'sp-import'.
//   If (b) fails, SP is already paused and ClipWaltz is still held: nothing publishes twice. Re-run with
//   --activate --state <file> to finish.
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

// ── Args / env ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const APPLY = flag("--apply");
const ACTIVATE = flag("--activate");
const SKIP_MEDIA = flag("--skip-media");
const MEDIA_LIMIT = opt("--media-limit") != null ? Math.max(0, Number(opt("--media-limit"))) : Infinity;
const REPORT_FILE = opt("--report");
const STATE_FILE = opt("--state");
const HOLD = "sp-import";
const HOLD_DELETED = "sp-deleted";

const emailMap = new Map();
argv.forEach((a, i) => {
  if (a === "--map") {
    const [from, to] = String(argv[i + 1] ?? "").split("=");
    if (!from || !to) die("--map needs sp@email=cw@email");
    emailMap.set(from.trim().toLowerCase(), to.trim().toLowerCase());
  }
});

const CW_URL = process.env.DATABASE_URL;
const SP_URL = process.env.SP_DATABASE_URL;
const MEDIA_DIR = process.env.SP_MEDIA_DIR || "/home/lacy/social-publishing-data/media";
const SP_ENV_FILE = process.env.SP_ENV_FILE || "/home/lacy/social-publishing/.env.local";
const OWNER_EMAIL = (process.env.SP_OWNER_EMAIL || "lacy@phoenixtekk.com").toLowerCase();

function die(msg) {
  console.error(`migrate-social-publishing: ${msg}`);
  process.exit(1);
}
if (!CW_URL) die("DATABASE_URL (ClipWaltz) is not set");
if (!SP_URL) die("SP_DATABASE_URL (Social Publishing) is not set");
const dbName = (u) => new URL(u).pathname.replace(/^\//, "");
const dbHost = (u) => new URL(u).host;
if (dbName(CW_URL) === dbName(SP_URL) && dbHost(CW_URL) === dbHost(SP_URL)) die("source and target are the same database");
if ((APPLY || ACTIVATE) && !process.env.TOKEN_ENC_KEY) die("TOKEN_ENC_KEY is required to write (tokens are encrypted at rest)");
if (APPLY && ACTIVATE) die("use --apply or --activate, not both");

const cw = postgres(CW_URL, { prepare: false, max: 4, onnotice: () => {} });
const sp = postgres(SP_URL, { prepare: false, max: 2, onnotice: () => {} });

// ── Token encryption: byte-for-byte the scheme of src/lib/cloud/crypto.ts ("enc1:iv:tag:data", AES-256-GCM) ────
function encryptToken(value) {
  if (value == null || value === "") return null;
  if (String(value).startsWith("enc1:")) return value;
  const k = createHash("sha256").update(process.env.TOKEN_ENC_KEY).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(String(value), "utf8"), c.final()]);
  return `enc1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

// ── Storage ───────────────────────────────────────────────────────────────────
let _s3;
function s3() {
  if (!_s3) {
    if (!process.env.S3_ENDPOINT || !process.env.S3_BUCKET) die("S3_ENDPOINT / S3_BUCKET not set (or pass --skip-media)");
    _s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? "", secretAccessKey: process.env.S3_SECRET_KEY ?? "" },
    });
  }
  return _s3;
}
const BUCKET = () => process.env.S3_BUCKET;
async function objectSize(key) {
  try {
    const h = await s3().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }));
    return Number(h.ContentLength ?? -1);
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return null;
    throw e;
  }
}
const mediaKey = (workspaceId, id) => `social/${workspaceId}/${id}`;
const SAFE_ID = /^[a-f0-9-]{36}$/i; // SP's own check in readMedia

// ── Helpers ───────────────────────────────────────────────────────────────────
const log = (...a) => console.log(...a);
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const json = (v) => (v == null ? null : cw.json(v));

function readSpEnvFacebook() {
  if (!existsSync(SP_ENV_FILE)) return { state: `SP env file not found (${SP_ENV_FILE})` };
  const vals = {};
  for (const line of readFileSync(SP_ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = /^(FACEBOOK_PAGE_ID|FACEBOOK_PAGE_ACCESS_TOKEN)=(.*)$/.exec(line); // commented-out lines do not match
    if (m) vals[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  if (!vals.FACEBOOK_PAGE_ID || !vals.FACEBOOK_PAGE_ACCESS_TOKEN)
    return { state: "not configured in the SP env file (no active FACEBOOK_PAGE_ID + FACEBOOK_PAGE_ACCESS_TOKEN lines)" };
  return { state: "configured", pageId: vals.FACEBOOK_PAGE_ID, token: vals.FACEBOOK_PAGE_ACCESS_TOKEN };
}

// ── Load SP + resolve owners ──────────────────────────────────────────────────
async function loadSp(db = sp) {
  const [users, conns, posts, targets, media, rules, presets, snippets, aigens, settings] = await Promise.all([
    db`select id, lower(email) as email from "user"`,
    db`select * from social_connection`,
    db`select * from post`,
    db`select * from post_target`,
    db`select * from media`,
    db`select * from auto_post_rule`,
    db`select * from auto_post_preset`,
    db`select * from snippet`,
    db`select * from ai_generation`,
    db`select key, value from app_setting where key in ('app:timezone','post:max_chars') or key like 'mastodon_app:%'`,
  ]);
  return { users, conns, posts, targets, media, rules, presets, snippets, aigens, settings };
}

async function resolveOwners(spUsers) {
  // SP user id → { userId, workspaceId } in ClipWaltz.
  const owners = new Map();
  const unmapped = [];
  for (const u of spUsers) {
    const email = emailMap.get(u.email) ?? u.email;
    const [cu] = await cw`select id from "user" where lower(email) = ${email} limit 1`;
    if (!cu) {
      unmapped.push({ spEmail: u.email, triedClipWaltzEmail: email, reason: "no ClipWaltz account" });
      continue;
    }
    const [ws] = await cw`select id from workspaces where owner_user_id = ${cu.id} and is_personal = true order by created_at limit 1`;
    if (!ws) {
      unmapped.push({ spEmail: u.email, triedClipWaltzEmail: email, reason: "ClipWaltz account has no personal workspace" });
      continue;
    }
    owners.set(u.id, { userId: cu.id, workspaceId: ws.id, spEmail: u.email, cwEmail: email });
  }
  return { owners, unmapped };
}

// ── Build target rows ─────────────────────────────────────────────────────────
function buildRows(src, owners, fbEnv, ownerSpUserId) {
  const skipped = { connections: [], posts: 0, targets: 0, media: 0, rules: 0, presets: 0, snippets: 0, aiGenerations: 0 };
  const own = (r) => owners.get(r.user_id);

  const connections = [];
  for (const c of src.conns) {
    const o = own(c);
    if (!o) { skipped.connections.push({ id: c.id, provider: c.provider, reason: "owner not mapped" }); continue; }
    if (c.provider === "podcast") { skipped.connections.push({ id: c.id, provider: c.provider, reason: "podcast is P5" }); continue; }
    connections.push({
      id: c.id, workspace_id: o.workspaceId, created_by: o.userId, provider: c.provider, label: c.label,
      access_token: c.access_token, refresh_token: c.refresh_token, // encrypted at write time
      expires_at: c.expires_at, external_id: c.external_id, display_name: c.display_name, scope: c.scope,
      ai_context: c.ai_context, paused: !!c.paused, migration_hold: HOLD, created_at: c.created_at, updated_at: c.updated_at,
    });
  }
  let fbEnvRow = null;
  if (fbEnv.state === "configured") {
    const o = owners.get(ownerSpUserId);
    if (o) {
      fbEnvRow = {
        id: `sp-env-facebook-${fbEnv.pageId}`, workspace_id: o.workspaceId, created_by: o.userId, provider: "facebook",
        label: "Facebook Page (from Social Publishing env)", access_token: fbEnv.token, refresh_token: null, expires_at: null,
        external_id: fbEnv.pageId, display_name: null, scope: null, ai_context: null, paused: false, migration_hold: HOLD,
        created_at: new Date(), updated_at: new Date(),
      };
      connections.push(fbEnvRow);
    } else fbEnv = { ...fbEnv, state: `configured, but the owner (${OWNER_EMAIL}) is not mapped — skipped` };
  }

  const targetsByPost = new Map();
  for (const t of src.targets) {
    if (!targetsByPost.has(t.post_id)) targetsByPost.set(t.post_id, []);
    targetsByPost.get(t.post_id).push(t);
  }

  const posts = [];
  const postWs = new Map();
  for (const p of src.posts) {
    const o = own(p);
    if (!o) { skipped.posts++; continue; }
    const ts = targetsByPost.get(p.id) ?? [];
    const held = p.status !== "published" || ts.some((t) => t.status !== "published");
    postWs.set(p.id, o.workspaceId);
    posts.push({
      id: p.id, workspace_id: o.workspaceId, created_by: o.userId, text: p.text ?? "", link: p.link, status: p.status,
      providers: p.providers ?? "", per_network: json(p.per_network), favorite: !!p.favorite, auto_image: !!p.auto_image,
      auto_video: !!p.auto_video, auto_gif: !!p.auto_gif, merge_media_id: p.merge_media_id, share_token: p.share_token,
      funnel_id: p.funnel_id, funnel_stage_id: p.funnel_stage_id, auto_post_rule_id: p.auto_post_rule_id,
      short_rule_id: p.short_rule_id ?? null, approval_status: "none", scheduled_at: p.scheduled_at,
      published_at: p.published_at, warnings: json(p.warnings), migration_hold: held ? HOLD : null,
      created_at: p.created_at, updated_at: p.updated_at,
    });
  }

  const targets = [];
  for (const t of src.targets) {
    if (!postWs.has(t.post_id)) { skipped.targets++; continue; }
    targets.push({
      id: t.id, post_id: t.post_id, provider: t.provider, connection_id: t.connection_id, label: t.label, status: t.status,
      external_id: t.external_id, url: t.url, error: t.error, attempts: t.attempts ?? 0, retry_at: t.retry_at,
      migration_hold: t.status !== "published" ? HOLD : null, created_at: t.created_at, updated_at: t.created_at,
    });
  }

  const media = [];
  for (const m of src.media) {
    const o = own(m);
    if (!o) { skipped.media++; continue; }
    media.push({
      id: m.id, workspace_id: o.workspaceId, created_by: o.userId, post_id: m.post_id && postWs.has(m.post_id) ? m.post_id : null,
      kind: m.kind, filename: m.filename, mime: m.mime, size: Number(m.size), storage_key: mediaKey(o.workspaceId, m.id),
      source: m.source || "upload", created_at: m.created_at,
    });
  }

  const rules = [];
  for (const r of src.rules) {
    const o = own(r);
    if (!o) { skipped.rules++; continue; }
    rules.push({
      id: r.id, workspace_id: o.workspaceId, created_by: o.userId, name: r.name, days_of_week: r.days_of_week,
      time_of_day: r.time_of_day, timezone: null, providers: r.providers ?? "", active: !!r.active, mode: r.mode,
      seed_prompt: r.seed_prompt ?? "", topics: r.topics ?? "", topic_cursor: r.topic_cursor ?? 0, links: r.links ?? "",
      link_cursor: r.link_cursor ?? 0, link_utm: !!r.link_utm, product_id: r.product_id, image_mode: r.image_mode ?? "none",
      video_mode: r.video_mode ?? "none", image_set: r.image_set ?? "", image_cursor: r.image_cursor ?? 0,
      review_first: !!r.review_first, next_run_at: r.next_run_at, last_run_at: r.last_run_at, migration_hold: HOLD,
      created_at: r.created_at,
    });
  }

  const presets = [];
  for (const r of src.presets) {
    const o = own(r);
    if (!o) { skipped.presets++; continue; }
    presets.push({
      id: r.id, workspace_id: o.workspaceId, created_by: o.userId, name: r.name, days_of_week: r.days_of_week,
      time_of_day: r.time_of_day, providers: r.providers ?? "", mode: r.mode, seed_prompt: r.seed_prompt ?? "",
      topics: r.topics ?? "", product_id: r.product_id, image_mode: r.image_mode ?? "none", video_mode: r.video_mode ?? "none",
      image_set: r.image_set ?? "", links: r.links ?? "", link_utm: !!r.link_utm, review_first: !!r.review_first,
      created_at: r.created_at, updated_at: r.updated_at,
    });
  }

  const snippets = [];
  for (const r of src.snippets) {
    const o = own(r);
    if (!o) { skipped.snippets++; continue; }
    snippets.push({ id: r.id, workspace_id: o.workspaceId, created_by: o.userId, name: r.name ?? "", text: r.text ?? "", created_at: r.created_at });
  }

  const aiGenerations = [];
  for (const r of src.aigens) {
    const o = own(r);
    if (!o) { skipped.aiGenerations++; continue; }
    aiGenerations.push({
      id: r.id, workspace_id: o.workspaceId, created_by: o.userId, mode: r.mode, length: r.length, input: r.input ?? "",
      output: r.output ?? "", favorite: !!r.favorite, tags: r.tags ?? "", created_at: r.created_at,
    });
  }

  const settings = src.settings.map((s) => ({ key: `social:${s.key}`, value: cw.json(s.value), updated_at: new Date() }));

  return { connections, posts, targets, media, rules, presets, snippets, aiGenerations, settings, skipped, fbEnv, fbEnvRow };
}

const TABLES = [
  ["connections", "social_connections"],
  ["posts", "social_posts"],
  ["targets", "social_post_targets"],
  ["media", "social_media"],
  ["rules", "social_auto_rules"],
  ["presets", "social_auto_presets"],
  ["snippets", "social_snippets"],
  ["aiGenerations", "social_ai_generations"],
];

async function existingIds(db, table, ids) {
  const have = new Set();
  for (const part of chunk(ids, 1000)) {
    const rows = await db`select id from ${db(table)} where id in ${db(part)}`;
    rows.forEach((r) => have.add(r.id));
  }
  return have;
}

async function insertRows(db, table, rows) {
  let inserted = 0;
  for (const part of chunk(rows, 200)) {
    const res = await db`insert into ${db(table)} ${db(part)} on conflict do nothing`;
    inserted += res.count;
  }
  return inserted;
}

// ── Media copy (disk → MinIO) ─────────────────────────────────────────────────
async function planMedia(rows) {
  const plan = { onDisk: 0, missingOnDisk: [], badId: [], bytes: 0 };
  for (const m of rows) {
    if (!SAFE_ID.test(m.id)) { plan.badId.push(m.id); continue; }
    const f = path.join(MEDIA_DIR, m.id);
    if (!existsSync(f)) { plan.missingOnDisk.push(m.id); continue; }
    plan.onDisk++;
    plan.bytes += statSync(f).size;
  }
  return plan;
}

async function copyMedia(rows) {
  const out = { uploaded: 0, alreadyInStorage: 0, missingOnDisk: [], failed: [], limited: 0, uploadedBytes: 0 };
  const ready = []; // rows whose object is in storage (row may be inserted)
  let budget = MEDIA_LIMIT;
  const queue = [...rows];
  async function one(m) {
    if (!SAFE_ID.test(m.id)) { out.failed.push({ id: m.id, error: "unsafe id" }); return; }
    const f = path.join(MEDIA_DIR, m.id);
    const have = await objectSize(m.storage_key);
    if (!existsSync(f)) {
      if (have != null) { out.alreadyInStorage++; ready.push(m); } else out.missingOnDisk.push(m.id);
      return;
    }
    const size = statSync(f).size;
    if (have === size) { out.alreadyInStorage++; ready.push(m); return; }
    if (SKIP_MEDIA || budget <= 0) { out.limited++; return; }
    budget--;
    try {
      await s3().send(new PutObjectCommand({
        Bucket: BUCKET(), Key: m.storage_key, Body: createReadStream(f), ContentLength: size, ContentType: m.mime,
      }));
      const check = await objectSize(m.storage_key);
      if (check !== size) throw new Error(`size after upload ${check} ≠ ${size}`);
      out.uploaded++;
      out.uploadedBytes += size;
      ready.push({ ...m, size });
    } catch (e) {
      out.failed.push({ id: m.id, error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) await one(queue.shift());
  });
  await Promise.all(workers);
  return { ...out, ready };
}

// ── Import (dry run or apply) ─────────────────────────────────────────────────
async function runImport({ apply, db = cw }) {
  const src = await loadSp();
  const { owners, unmapped } = await resolveOwners(src.users);
  const ownerSp = src.users.find((u) => u.email === OWNER_EMAIL);
  const rows = buildRows(src, owners, readSpEnvFacebook(), ownerSp?.id);
  const report = {
    mode: apply ? "apply" : "dry-run",
    at: new Date().toISOString(),
    source: { db: dbName(SP_URL), counts: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, v.length])) },
    target: { db: dbName(CW_URL) },
    users: { mapped: [...owners.values()].map((o) => ({ sp: o.spEmail, clipwaltz: o.cwEmail, workspaceId: o.workspaceId })), unmapped },
    facebookEnvPage: rows.fbEnv.state,
    skipped: rows.skipped,
    tables: {},
    held: {
      connections: rows.connections.length,
      rules: rows.rules.length,
      posts: rows.posts.filter((p) => p.migration_hold).length,
      targets: rows.targets.filter((t) => t.migration_hold).length,
    },
  };

  for (const [k, table] of TABLES) {
    const have = await existingIds(db, table, rows[k].map((r) => r.id));
    report.tables[table] = { candidates: rows[k].length, alreadyPresent: have.size, toInsert: rows[k].length - have.size };
  }
  const haveSettings = new Set(
    (await db`select key from app_settings where key in ${db(rows.settings.map((s) => s.key).concat(["-"]))}`).map((r) => r.key),
  );
  report.tables.app_settings = { candidates: rows.settings.length, alreadyPresent: haveSettings.size, toInsert: rows.settings.length - haveSettings.size };

  if (!apply) {
    report.media = SKIP_MEDIA ? "skipped (--skip-media)" : await planMedia(rows.media);
    return report;
  }

  // Media objects first (outside the transaction — uploads are idempotent by key + size).
  const mediaOut = await copyMedia(rows.media);
  report.media = { ...mediaOut, ready: mediaOut.ready.length };
  const mediaReady = new Set(mediaOut.ready.map((m) => m.id));

  const enc = rows.connections.map((c) => ({ ...c, access_token: encryptToken(c.access_token) ?? "", refresh_token: encryptToken(c.refresh_token) }));
  const inserted = {};
  // Inside --activate `db` is already a transaction: nest as a savepoint.
  const inTx = (fn) => (typeof db.begin === "function" ? db.begin(fn) : db.savepoint(fn));
  await inTx(async (tx) => {
    inserted.social_connections = await insertRows(tx, "social_connections", enc);
    inserted.social_posts = await insertRows(tx, "social_posts", rows.posts);
    inserted.social_post_targets = await insertRows(tx, "social_post_targets", rows.targets);
    inserted.social_media = await insertRows(tx, "social_media", rows.media.filter((m) => mediaReady.has(m.id)));
    inserted.social_auto_rules = await insertRows(tx, "social_auto_rules", rows.rules);
    inserted.social_auto_presets = await insertRows(tx, "social_auto_presets", rows.presets);
    inserted.social_snippets = await insertRows(tx, "social_snippets", rows.snippets);
    inserted.social_ai_generations = await insertRows(tx, "social_ai_generations", rows.aiGenerations);
    inserted.app_settings = await insertRows(tx, "app_settings", rows.settings);
  });
  for (const [t, n] of Object.entries(inserted)) report.tables[t].inserted = n;

  // Reconciliation: every candidate id must now be in ClipWaltz.
  report.reconciliation = {};
  for (const [k, table] of TABLES) {
    const ids = (k === "media" ? rows.media.filter((m) => mediaReady.has(m.id)) : rows[k]).map((r) => r.id);
    const have = await existingIds(db, table, ids);
    report.reconciliation[table] = { expected: ids.length, present: have.size, ok: have.size === ids.length };
  }
  report.reconciliation.social_media.notCopied = rows.media.length - mediaReady.size;
  const heldNow = await db`
    select (select count(*) from social_connections where migration_hold is not null)::int as connections,
           (select count(*) from social_auto_rules where migration_hold is not null)::int as rules,
           (select count(*) from social_posts where migration_hold is not null)::int as posts,
           (select count(*) from social_post_targets where migration_hold is not null)::int as targets`;
  report.heldInClipWaltz = heldNow[0];
  return report;
}

// ── Activate (cut-over) ───────────────────────────────────────────────────────
async function activate() {
  let state;
  if (STATE_FILE) {
    state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    log(`resuming from ${STATE_FILE} (SP was paused at ${state.pausedAt})`);
  } else {
    // (a) Pause on SP.
    const dir = path.resolve("migrate-sp-state");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `activate-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    state = await sp.begin(async (tx) => {
      await tx`lock table post, post_target, auto_post_rule in share row exclusive mode`;
      const inflight = await tx`
        select (select count(*) from post where status in ('publishing','rendering'))::int as posts,
               (select count(*) from post_target where status in ('pending','publishing'))::int as targets`;
      if (inflight[0].posts || inflight[0].targets)
        throw new Error(`SP has work in flight (${inflight[0].posts} posts publishing/rendering, ${inflight[0].targets} destinations pending/publishing) — wait a few minutes and retry`);
      const rules = await tx`select id, active, next_run_at from auto_post_rule where active = true`;
      const posts = await tx`select id, status, scheduled_at from post where status in ('scheduled','queued')`;
      const retries = await tx`select id, retry_at from post_target where status = 'failed' and retry_at is not null`;
      const s = { pausedAt: new Date().toISOString(), rules, posts, retries };
      writeFileSync(file, JSON.stringify(s, null, 2));
      if (rules.length) await tx`update auto_post_rule set active = false where id in ${tx(rules.map((r) => r.id))}`;
      if (posts.length) await tx`update post set status = 'draft', updated_at = now() where id in ${tx(posts.map((p) => p.id))}`;
      if (retries.length) await tx`update post_target set retry_at = null where id in ${tx(retries.map((t) => t.id))}`;
      return s;
    });
    log(`(a) SP paused: ${state.rules.length} rules, ${state.posts.length} scheduled/queued posts, ${state.retries.length} retries — state ${file}`);
  }

  // (b) Import + re-sync + release on ClipWaltz, in one transaction.
  const result = await cw.begin(async (tx) => {
    const imp = await runImport({ apply: true, db: tx });
    const src = await loadSp();
    const capPost = new Map(state.posts.map((p) => [p.id, p]));
    const capRule = new Map(state.rules.map((r) => [r.id, r]));
    const capRetry = new Map(state.retries.map((t) => [t.id, t]));
    const spPost = new Map(src.posts.map((p) => [p.id, p]));
    const spTarget = new Map(src.targets.map((t) => [t.id, t]));
    const spRule = new Map(src.rules.map((r) => [r.id, r]));
    const spConn = new Map(src.conns.map((c) => [c.id, c]));
    const n = { posts: 0, targets: 0, rules: 0, connections: 0, deletedOnSp: 0 };

    for (const p of await tx`select id from social_posts where migration_hold = ${HOLD}`) {
      const s = spPost.get(p.id);
      if (!s) { await tx`update social_posts set migration_hold = ${HOLD_DELETED} where id = ${p.id}`; n.deletedOnSp++; continue; }
      const c = capPost.get(p.id);
      await tx`update social_posts set status = ${c ? c.status : s.status}, scheduled_at = ${c ? c.scheduled_at : s.scheduled_at},
        published_at = ${s.published_at}, text = ${s.text ?? ""}, link = ${s.link}, providers = ${s.providers ?? ""},
        per_network = ${json(s.per_network)}, warnings = ${json(s.warnings)}, updated_at = now() where id = ${p.id}`;
      n.posts++;
    }
    for (const t of await tx`select id from social_post_targets where migration_hold = ${HOLD}`) {
      const s = spTarget.get(t.id);
      if (!s) { await tx`update social_post_targets set migration_hold = ${HOLD_DELETED} where id = ${t.id}`; n.deletedOnSp++; continue; }
      const c = capRetry.get(t.id);
      await tx`update social_post_targets set status = ${s.status}, external_id = ${s.external_id}, url = ${s.url}, error = ${s.error},
        attempts = ${s.attempts ?? 0}, retry_at = ${c ? c.retry_at : s.retry_at}, updated_at = now() where id = ${t.id}`;
      n.targets++;
    }
    for (const r of await tx`select id from social_auto_rules where migration_hold = ${HOLD}`) {
      const s = spRule.get(r.id);
      if (!s) { await tx`update social_auto_rules set migration_hold = ${HOLD_DELETED} where id = ${r.id}`; n.deletedOnSp++; continue; }
      const c = capRule.get(r.id);
      await tx`update social_auto_rules set active = ${c ? true : !!s.active}, next_run_at = ${c ? c.next_run_at : s.next_run_at},
        last_run_at = ${s.last_run_at}, topic_cursor = ${s.topic_cursor ?? 0}, link_cursor = ${s.link_cursor ?? 0},
        image_cursor = ${s.image_cursor ?? 0}, days_of_week = ${s.days_of_week}, time_of_day = ${s.time_of_day},
        providers = ${s.providers ?? ""}, mode = ${s.mode}, seed_prompt = ${s.seed_prompt ?? ""}, topics = ${s.topics ?? ""}
        where id = ${r.id}`;
      n.rules++;
    }
    for (const c of await tx`select id from social_connections where migration_hold = ${HOLD}`) {
      const s = spConn.get(c.id);
      if (!s) {
        if (String(c.id).startsWith("sp-env-facebook-")) { n.connections++; continue; } // env Page: no SP row
        await tx`update social_connections set migration_hold = ${HOLD_DELETED} where id = ${c.id}`; n.deletedOnSp++; continue;
      }
      await tx`update social_connections set access_token = ${encryptToken(s.access_token) ?? ""},
        refresh_token = ${encryptToken(s.refresh_token)}, expires_at = ${s.expires_at}, paused = ${!!s.paused},
        updated_at = now() where id = ${c.id}`;
      n.connections++;
    }
    const released = {};
    for (const t of ["social_connections", "social_auto_rules", "social_posts", "social_post_targets"]) {
      released[t] = (await tx`update ${tx(t)} set migration_hold = null where migration_hold = ${HOLD}`).count;
    }
    return { import: imp, resynced: n, released };
  });
  return { activate: true, spPaused: { rules: state.rules.length, posts: state.posts.length, retries: state.retries.length }, ...result };
}

// ── Main ──────────────────────────────────────────────────────────────────────
try {
  const report = ACTIVATE ? await activate() : await runImport({ apply: APPLY });
  const out = JSON.stringify(report, null, 2);
  if (REPORT_FILE) writeFileSync(REPORT_FILE, out);
  log(out);
  if (!APPLY && !ACTIVATE) log("\nDRY RUN — nothing written. Re-run with --apply to copy (everything that could publish lands held).");
} catch (e) {
  console.error("migrate-social-publishing failed:", e?.stack ?? e);
  process.exitCode = 1;
} finally {
  await cw.end({ timeout: 5 });
  await sp.end({ timeout: 5 });
}
