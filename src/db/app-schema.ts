import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  unique,
  jsonb,
  index,
  uniqueIndex,
  bigint,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth-schema";

// ClipWaltz domain tables (MVP). Field names are camelCase; with the snake_case-cased
// Drizzle client the DB columns become snake_case automatically.

// Music catalog. Sourced through the ClipWaltz Music Provider Layer (see lib/music/providers):
// `provider` identifies the source (pixabay | epidemic | soundstripe | artlist | upload | ai),
// `premium` marks partner/premium catalogs, `providerTrackId` is the id in that provider's system.
export const musicTracks = pgTable("music_tracks", {
  id: text().primaryKey(),
  // null = shared catalog track; set = a user's personal uploaded MP3 (only they see/use it).
  ownerId: text().references(() => user.id, { onDelete: "cascade" }),
  title: text().notNull(),
  artist: text(),
  licenseRef: text(), // catalog / license reference — proves "safe to post"
  bpm: integer(),
  mood: text(), // e.g. upbeat, chill, cinematic
  durationSec: real(),
  storageKey: text().notNull(), // MinIO object key
  provider: text().notNull().default("pixabay"), // source provider id
  providerTrackId: text(), // id within the provider's catalog
  premium: boolean().notNull().default(false), // partner/premium vs included
  active: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A user's favourite tracks (music panel → "My Music").
export const musicFavorites = pgTable(
  "music_favorites",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    trackId: text()
      .notNull()
      .references(() => musicTracks.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.trackId)],
);

// A user's video project.
export const projects = pgTable("projects", {
  id: text().primaryKey(),
  ownerId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // ADR-0004 workspace layer. Nullable during rollout; backfilled to each owner's default
  // personal workspace, then enforced. ownerId is retained (existing owner-scoped queries).
  workspaceId: text().references(() => workspaces.id, { onDelete: "cascade" }),
  title: text().notNull().default("Untitled project"),
  description: text(), // optional project description (CW-MVP-010)
  // AI template the project was started from (CW-MVP-151); pre-fills the Generate tab.
  aiTemplateId: text(),
  template: text().notNull().default("surprise"), // trip | event | birthday | surprise
  aspect: text().notNull().default("9:16"), // 9:16 only at MVP
  lengthSec: integer().notNull().default(30),
  status: text().notNull().default("draft"), // draft | rendering | ready | failed
  musicTrackId: text().references(() => musicTracks.id),
  // Editor Phase 1 styling (applied by the render worker).
  titleText: text(), // optional title/caption overlay
  styleFilter: text().notNull().default("none"), // none|warm|cool|vivid|bw|vintage
  lightFx: text().notNull().default("none"), // none|vignette|glow|grain|dreamy|noir (atmosphere)
  transition: text().notNull().default("cut"), // cut | crossfade
  motion: boolean().notNull().default(true), // Ken Burns zoom/pan on photos
  fades: boolean().notNull().default(true), // fade IN at the start
  fadeOut: boolean().notNull().default(true), // fade OUT to black at the end
  smartCut: boolean().notNull().default(true), // pick the most active window of each video
  beatSync: boolean().notNull().default(true), // time cuts to the music's beats
  waltzToMusic: boolean().notNull().default(false), // energy-aware beat-driven editing
  describe: boolean().notNull().default(false), // generate a YouTube description on render
  // Per-project "ready-to-post" text config (used when `describe` is on). `postTopic` is a short
  // subject hint that steers the vision model (e.g. "European travel vlog", "home cooking");
  // `postTemplate` is the fixed channel boilerplate appended verbatim after the AI-written block.
  // NULL on either → the worker falls back to its built-in defaults (see DEFAULT_POST_* there).
  postTopic: text(),
  postTemplate: text(),
  loopToFill: boolean().notNull().default(false), // repeat footage to reach the target length
  // "Max footage": ignore the lengthSec cap and build the longest coherent video the footage
  // supports (each video its full length, each image a slot), bounded by a soft ceiling in the
  // worker. Inverse of loopToFill — never repeats. When true the worker treats length as 0.
  maxFootage: boolean().notNull().default(false),
  // Audio: keep each clip's ORIGINAL sound (`originalAudio`) and mix it with the in-app music at
  // adjustable levels (`musicVolume`/`originalVolume`, 0–1.5; null → worker default). With original
  // audio on, transitions render as cuts (crossfade would drift the audio).
  originalAudio: boolean().notNull().default(false),
  musicVolume: real(),
  originalVolume: real(),
  // Projects-page organisation: a free-text folder name (null = Uncategorized) + free-form tags.
  category: text(),
  tags: jsonb(), // string[] — searchable/filterable labels; null = none
  overlays: jsonb(), // text + emoji overlays (see lib/overlays.ts); null = none
  // WaltzDeck (06_ClipWaltz_WaltzDeck_Feature_Spec.md): "autowaltz" = media → music video (default);
  // "deck" = brief + per-item notes → AI storyboard (deck_scenes) → ad / slideshow / presentation.
  kind: text().notNull().default("autowaltz"),
  deck: jsonb(), // DeckBrief (src/lib/deck/types.ts): mode, prompt, cta, textMode, plan status…; null unless kind=deck
  brandKitId: text(), // brand_kits.id applied to renders (no FK: brand_kits is declared later in this file)
  // Cloud storage destinations for this project's videos (string[] of provider ids; [] = don't save);
  // null = follow the owner's rules / default (src/lib/cloud/routing.ts).
  cloudTargets: jsonb(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Saved Format + Style + overlays presets. A snapshot of a project's look that can be applied
// to any project in one click. Scope:
//   • ownerId set, isGlobal false → a personal preset owned by that user.
//   • isDefault true → auto-applied to that owner's newly-created projects.
//   • isGlobal true (ownerId null) → an admin-published preset visible to everyone (ties to the
//     admin content area). Built-in "starter" presets live in code (lib/presets.ts), not here.
export const presets = pgTable("presets", {
  id: text().primaryKey(),
  ownerId: text().references(() => user.id, { onDelete: "cascade" }), // null = global/admin preset
  name: text().notNull(),
  isDefault: boolean().notNull().default(false), // owner's new projects start from this
  isGlobal: boolean().notNull().default(false), // admin-published to all users
  // snapshot — mirrors the project style/format fields
  aspect: text().notNull().default("9:16"),
  lengthSec: integer().notNull().default(30),
  maxFootage: boolean().notNull().default(false),
  styleFilter: text().notNull().default("none"),
  lightFx: text().notNull().default("none"),
  transition: text().notNull().default("cut"),
  motion: boolean().notNull().default(true),
  fades: boolean().notNull().default(true),
  fadeOut: boolean().notNull().default(true),
  smartCut: boolean().notNull().default(true),
  beatSync: boolean().notNull().default(true),
  waltzToMusic: boolean().notNull().default(false),
  loopToFill: boolean().notNull().default(false),
  overlays: jsonb(), // snapshotted overlays (null = none)
  createdBy: text(), // admin user id for global presets
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Admin-authored in-app content: promos, feature announcements, contest banners, cross-promo.
// Rendered on the dashboard (banner + cards) and optionally the community page. Targetable by
// audience (all | free | paid) and schedulable (startsAt/endsAt). A lightweight marketing engine.
export const announcements = pgTable("announcements", {
  id: text().primaryKey(),
  title: text().notNull(),
  body: text(), // short supporting copy
  imageUrl: text(), // optional hero/thumbnail
  ctaLabel: text(), // e.g. "Upgrade to Pro"
  ctaUrl: text(), // where the CTA points
  placement: text().notNull().default("dashboard_card"), // dashboard_banner | dashboard_card | community
  audience: text().notNull().default("all"), // all | free | paid
  accent: text().notNull().default("violet"), // brand accent: violet | blue | magenta | coral
  active: boolean().notNull().default(true),
  startsAt: timestamp({ withTimezone: true }), // null = live now
  endsAt: timestamp({ withTimezone: true }), // null = no end
  createdBy: text().notNull(), // admin user id
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// User-level media library: a file lives once and can be reused across projects.
// It is the source of truth for the library view (import date, usage, download) and
// carries the 360 conversion result so a 360 file is converted once and reused.
export const media = pgTable("media", {
  id: text().primaryKey(),
  ownerId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  kind: text().notNull(), // photo | video
  originalName: text(),
  storageKey: text().notNull(), // MinIO object key of the original file
  convertedKey: text(), // flat mp4/jpg for 360 sources
  sourceFormat: text(), // insv | lrv | insp | null
  conversionState: text().notNull().default("ready"), // ready | pending | converting | failed
  // Worker claims that ended in a crash (bumped on claim, zeroed on any clean finish or give-up).
  // reapStaleConversions() fails the file once this hits the cap so a crash-looping file stops.
  conversionAttempts: integer().notNull().default(0),
  conversionWorker: text(), // lease holder while 'converting' (render worker id)
  conversionHeartbeatAt: timestamp({ withTimezone: true }),
  reframeMode: text().notNull().default("follow"), // 360 reframe: flat | follow (default: track the action) | tiny
  // Insta360 split recordings: the other lens of this clip ("…_00_N" front ↔ "…_10_N" rear). The front
  // media holds the stitched 360 conversion; the rear is hidden where both are in a project.
  pairMediaId: text(),
  driveFileId: text(), // Google Drive file id once backed up (null = not backed up)
  driveBackedAt: timestamp({ withTimezone: true }),
  sizeBytes: integer(),
  durationSec: real(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(), // imported at
  lastUsedAt: timestamp({ withTimezone: true }),
});

// Uploaded source media (photos + videos) for a project. Now a placement that references
// a library `media` row (mediaId); deleting it removes the clip from the project, not the file.
export const assets = pgTable("assets", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  mediaId: text().references(() => media.id, { onDelete: "cascade" }),
  // ADR-0004 workspace layer (nullable during rollout; backfilled from the parent project).
  workspaceId: text().references(() => workspaces.id, { onDelete: "cascade" }),
  storageKey: text().notNull(), // MinIO object key
  kind: text().notNull(), // photo | video
  originalName: text(),
  // 360 / Insta360 ingest: original format + async reprojection to a usable flat clip.
  sourceFormat: text(), // null for normal uploads; insv | lrv | insp for 360 files
  conversionState: text().notNull().default("ready"), // ready | pending | converting | failed
  convertedKey: text(), // MinIO key of the flat mp4/jpg once reprojected
  durationSec: real(),
  // Manual per-clip screen time (seconds). null = auto (beat/fill decides). When set, the worker
  // holds this clip for exactly this long (photos: any; videos: clamped to the source length).
  durationOverride: real(),
  // Per-video trim: render only the [trimStart, trimEnd] portion of the source (seconds). null =
  // use the whole clip / auto window. Takes precedence over smart-cut windowing + durationOverride.
  trimStart: real(),
  trimEnd: real(),
  // Hidden from the timeline + renders: the rear lens of a stitched Insta360 pair whose front clip is in
  // the same project (the front shows the full 360). See worker convertMedia.
  hidden: boolean().notNull().default(false),
  // User rotation (degrees clockwise: 0/90/180/270), applied ON TOP of the file's own rotation flag.
  // For phone clips whose flag is wrong (recording started pointing at the ground → sideways).
  rotation: integer().notNull().default(0),
  // WaltzDeck: the user's per-item prompt ("hero shot — say it's organic") and what the vision model
  // saw in it (subject, text, mood, best moments) — inputs to the storyboard planner.
  note: text(),
  aiDescription: jsonb(),
  tags: jsonb(), // string[] — user labels for filtering clips (CW-MVP-024); null = none
  // Free-tier retention: when the owner was emailed that this upload is deleted in ~24 h.
  retentionNoticeAt: timestamp({ withTimezone: true }),
  width: integer(),
  height: integer(),
  qualityScore: real(), // blur/brightness heuristic for smart trim/selection
  orderIndex: integer().notNull().default(0),
  uploadState: text().notNull().default("pending"), // pending | uploading | uploaded | failed
  // Retention: free-tier sources auto-delete after 7 days unless vaulted (paid "Project Vault").
  vaulted: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A render job / output for a project.
export const renders = pgTable("renders", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  version: integer().notNull().default(1),
  aspect: text().notNull().default("9:16"),
  status: text().notNull().default("queued"), // queued | rendering | done | failed
  outputKey: text(), // MinIO object key of the finished video
  watermark: boolean().notNull().default(true), // free tier = watermark
  cpuSeconds: real(), // instrumentation → cost-per-render: worker wall-clock seconds (success AND failure)
  costCents: integer(),
  startedAt: timestamp({ withTimezone: true }), // worker claimed it → queue wait = startedAt − createdAt
  errorMessage: text(), // why a failed render failed (beta reliability metrics)
  visibility: text().notNull().default("private"), // private | unlisted | public (community feed)
  settings: jsonb(), // snapshot of the effective Format+Style settings at render time (audit + "what changed")
  // WaltzDeck campaign variant (phase 4): the pack it belongs to + { code, label, hookId, ctaId, lengthSec, ctaText }.
  // Its storyboard snapshot is settings.deckVariant (the worker renders that instead of the project's scenes).
  campaignId: text(),
  variant: jsonb(),
  description: text(), // AI-generated YouTube description (when project.describe is on)
  sharedAt: timestamp({ withTimezone: true }),
  // "Save to" picked at render time (string[] of provider ids; [] = don't save); null = project setting / rules.
  cloudTargets: jsonb(),
  // Queue + lease (multi-worker): claim order is priority desc, then created_at (paid plans first — pro 20, plus 10,
  // free 0, set at createRender). The claiming worker writes worker_id and refreshes heartbeat_at every ~20 s; a
  // 'rendering' row whose heartbeat is older than the lease timeout is an orphan (worker died) and gets failed.
  priority: integer().notNull().default(0),
  workerId: text(),
  heartbeatAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp({ withTimezone: true }),
});

// Licensing ledger: a per-render snapshot of the music license so we can always answer
// "what license did this video use?" — populated when a render completes. Clearance fields
// (safelist/YouTube codes) fill in once a premium provider adapter is wired.
export const renderLicenses = pgTable("render_licenses", {
  id: text().primaryKey(),
  renderId: text()
    .notNull()
    .references(() => renders.id, { onDelete: "cascade" }),
  userId: text().references(() => user.id, { onDelete: "set null" }),
  projectId: text(),
  provider: text().notNull(), // pixabay | epidemic | soundstripe | artlist | upload | ai
  providerTrackId: text(),
  trackTitle: text(),
  artist: text(),
  licenseType: text(), // e.g. "Pixabay Content License", "Epidemic Sound Commercial"
  licenseRef: text(), // catalog/license reference
  clearanceStatus: text().notNull().default("n/a"), // n/a | pending | cleared | failed
  clearanceRef: text(), // safelist / YouTube clearance id (provider-dependent)
  licensedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp({ withTimezone: true }),
});

// Connected cloud accounts (Google, Microsoft) for photo/drive import — OAuth tokens.
export const oauthAccounts = pgTable("oauth_accounts", {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: text().notNull(), // google | microsoft | dropbox
  accessToken: text(),
  refreshToken: text(),
  expiresAt: timestamp({ withTimezone: true }),
  scope: text(),
  // Cloud storage (account → Cloud storage): who it's connected as, whether finished videos are saved there
  // automatically, how folders are laid out (category | project | flat), and the last save problem to show.
  // Tokens written since 0049 are AES-GCM encrypted ("enc1:" prefix, src/lib/cloud/crypto.ts); older rows are plaintext.
  accountLabel: text(),
  autoSave: boolean().notNull().default(false),
  folderLayout: text().notNull().default("category"),
  lastError: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Where a user's finished videos are saved: default destinations + ordered rules (first match wins). No row = the
// connections with auto_save on are the default (behaviour before 0051). See src/lib/cloud/routing.ts.
export const cloudPrefs = pgTable("cloud_prefs", {
  userId: text().primaryKey().references(() => user.id, { onDelete: "cascade" }),
  defaultTargets: jsonb().notNull().default([]), // CloudProviderId[]
  rules: jsonb().notNull().default([]), // CloudRule[]
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A finished video saved to a user's connected cloud storage (one row per render × provider × user). Queued by the
// render-ready hook (auto-save) or "Save to…"; processed in the app process (src/lib/cloud/saves.ts).
export const cloudSaves = pgTable(
  "cloud_saves",
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => user.id, { onDelete: "cascade" }),
    renderId: text().notNull().references(() => renders.id, { onDelete: "cascade" }),
    provider: text().notNull(), // google_drive | onedrive | dropbox
    status: text().notNull().default("queued"), // queued | uploading | done | failed
    remoteId: text(),
    remoteUrl: text(),
    remotePath: text(), // folder path + file name as saved, for display
    bytes: bigint({ mode: "number" }),
    attempts: integer().notNull().default(0),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex("cloud_saves_render_provider_user").on(t.renderId, t.provider, t.userId), index("cloud_saves_user").on(t.userId)],
);

// Community-feed likes on shared renders.
export const renderLikes = pgTable("render_likes", {
  id: text().primaryKey(),
  renderId: text()
    .notNull()
    .references(() => renders.id, { onDelete: "cascade" }),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Comments on a shared render (community — per-video conversation).
export const renderComments = pgTable("render_comments", {
  id: text().primaryKey(),
  renderId: text()
    .notNull()
    .references(() => renders.id, { onDelete: "cascade" }),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  body: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Global community chat room (lightweight — polled, no realtime infra).
export const chatMessages = pgTable("chat_messages", {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  body: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Monthly Theme Challenge contests. Likes on entered renders = votes; the admin
// closes a contest and the likes-leader is auto-granted Pro (see contest-actions).
export const contests = pgTable("contests", {
  id: text().primaryKey(),
  theme: text().notNull(),
  description: text(),
  status: text().notNull().default("active"), // active | closed
  winnerRenderId: text(), // set on close
  winnerUserId: text(), // set on close
  createdBy: text().notNull(), // admin user id
  startsAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A public render entered into a contest. One entry per render per contest.
export const contestEntries = pgTable(
  "contest_entries",
  {
    id: text().primaryKey(),
    contestId: text()
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    renderId: text()
      .notNull()
      .references(() => renders.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.contestId, t.renderId)],
);

// Admin-issued comp access invites. When an invited email signs up, the grant is
// redeemed into a subscriptions row (see auth-server databaseHooks + lib/tier).
export const invites = pgTable("invites", {
  id: text().primaryKey(),
  email: text().notNull(),
  tier: text().notNull(), // plus | pro
  expiresAt: timestamp({ withTimezone: true }), // null = lifetime
  note: text(),
  createdBy: text().notNull(), // admin user id
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  redeemedAt: timestamp({ withTimezone: true }),
  redeemedUserId: text(),
});

// Admin-issued AI credit grants (2026-09-30): extra credits on top of the plan's monthly allowance, for the UTC month
// the grant was made in — they expire at the monthly reset like the allowance (src/lib/credits-server.ts). Revoking
// deletes the row.
export const creditGrants = pgTable(
  "credit_grants",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    amount: integer().notNull(), // > 0
    note: text(), // reason, shown to the admin and to the user on Billing
    grantedBy: text().notNull(), // admin user id
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credit_grants_user_idx").on(t.userId, t.createdAt)],
);

// Stripe-backed subscription state (direct Stripe — see billing module).
export const subscriptions = pgTable("subscriptions", {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  tier: text().notNull().default("free"), // free | plus | pro
  status: text().notNull().default("active"), // active | past_due | canceled
  stripeCustomerId: text(),
  stripeSubscriptionId: text(),
  currentPeriodEnd: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Web Push subscriptions for render-complete notifications. One row per browser/device
// that opted in ("Notify me even when ClipWaltz is closed"). The render-ready callback
// sends a push to every subscription the owner has; expired ones (410/404) are pruned
// on send. `endpoint` is the browser's push service URL and is unique per subscription.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  endpoint: text().notNull().unique(),
  p256dh: text().notNull(), // client public key (base64url)
  auth: text().notNull(), // client auth secret (base64url)
  userAgent: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Server-side project categories (folders) for the projects board. Per-owner, ordered, optional
// colour. `projects.category` holds the category NAME (kept in sync on rename/delete), so cards
// join by name and legacy free-text categories still work.
export const projectCategories = pgTable(
  "project_categories",
  {
    id: text().primaryKey(),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text(), // hex like #7c3aed, optional
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.ownerId, t.name)],
);

// Auto-Batch Studio: a server-side pipeline that turns folders of media into rendered videos
// unattended. The batch worker (AI box) scans `inboxPath`, renders each group with `settings`,
// writes the MP4 + description to `outputPath`, and moves consumed sources to `donePath`. Paces by
// `scheduleMinutes` and auto-stops (status='done') when the inbox is empty. Paths are absolute on
// the worker host (owner-trusted). See worker `batchTick` + `finalizeBatchItem`.
export const batchJobs = pgTable(
  "batch_jobs",
  {
    id: text().primaryKey(),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull(),
    inboxPath: text().notNull(),
    outputPath: text().notNull(),
    donePath: text().notNull(),
    grouping: text().notNull().default("subfolder"), // subfolder | whole | file
    settings: jsonb(), // render settings snapshot (aspect, lengthSec, styleFilter, music, …)
    scheduleMinutes: integer().notNull().default(0), // 0 = as fast as possible; else min gap between items
    status: text().notNull().default("active"), // active | paused | done
    lastRunAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.ownerId, t.name)],
);

// One rendered item within a batch (a subfolder/file group). Links the created project + render and
// records where the output landed.
export const batchItems = pgTable("batch_items", {
  id: text().primaryKey(),
  batchId: text()
    .notNull()
    .references(() => batchJobs.id, { onDelete: "cascade" }),
  sourceName: text().notNull(), // relative name of the consumed subfolder/file
  projectId: text(),
  renderId: text(),
  status: text().notNull().default("queued"), // queued | rendering | done | failed
  outputFile: text(),
  error: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp({ withTimezone: true }),
});

// ============================================================================
// AI VIDEO GENERATION (Phase 1 foundation) — coexists with the assembler above.
// See 01_ClipWaltz_Technical_Architecture.md §5/§6/§8 and docs/architecture/DECISIONS.md.
// These tables are ADDITIVE; the music-video pipeline (projects/assets/renders) is untouched.
// ============================================================================

// Multi-tenant container (ADR-0004). Every user gets a default personal workspace; projects and
// assets are scoped to a workspace. `ownerUserId` is the creator/owner; membership + roles live
// in workspaceMembers.
export const workspaces = pgTable("workspaces", {
  id: text().primaryKey(),
  name: text().notNull().default("My Workspace"),
  ownerUserId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  plan: text().notNull().default("free"), // free | plus | pro
  isPersonal: boolean().notNull().default(true), // the auto-created per-user default workspace
  // G9 approval workflow (P6): when true, a post may only be published once an approver has approved it — enforced in
  // publishPost and the scheduler, whatever the composer sent.
  socialRequireApproval: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Workspace membership + role. Authorization for generation resources checks this.
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text().notNull().default("editor"), // owner | admin | editor | viewer
    // Social Publishing (ADR-0011, D9): the one extra capability on top of the role model. An approver may
    // approve/reject posts awaiting approval. Owners and admins approve by role; this flag grants it to an editor.
    socialApprover: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.workspaceId, t.userId)],
);

// Pending invitation to join a workspace. Only a SHA-256 of the token is stored; the raw token
// travels once, in the emailed link. Single-use (acceptedAt), revocable, time-limited.
export const workspaceInvites = pgTable("workspace_invites", {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  email: text().notNull(), // lower-cased
  role: text().notNull().default("editor"), // admin | editor | viewer (never owner)
  tokenHash: text().notNull().unique(),
  invitedBy: text().references(() => user.id, { onDelete: "set null" }),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  acceptedAt: timestamp({ withTimezone: true }),
  acceptedBy: text().references(() => user.id, { onDelete: "set null" }),
  revokedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Global admin settings (key → JSON value). E.g. "watermark_paid_plans": true = paid plans are
// watermarked too (admin toggle on /admin).
export const appSettings = pgTable("app_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Outside AI models for writing & planning (worker/deck/llm.mjs). Admin settings per provider live in app_settings
// "llm_providers"; these hold each user's own API keys (AES-GCM, src/lib/cloud/crypto.ts) and their model choice.
export const userAiKeys = pgTable(
  "user_ai_keys",
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => user.id, { onDelete: "cascade" }),
    provider: text().notNull(), // anthropic | openai | deepseek | gemini
    keyEnc: text().notNull(),
    keyLast4: text().notNull(),
    model: text(), // null = the admin's default model for this provider
    lastError: text(),
    lastErrorAt: timestamp({ withTimezone: true }),
    lastUsedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_ai_keys_user_provider").on(t.userId, t.provider)],
);

// ClipWaltz Connector (public/connector/clipwaltz-connector.mjs): a program on the user's own computer that runs AI jobs on
// their local Ollama. It pairs with a one-time code, then pulls jobs over outbound HTTPS (works behind any router).
export const connectors = pgTable(
  "connectors",
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull(),
    tokenHash: text().notNull(), // sha256 of the bearer token; the token itself is shown to the program once
    platform: text(),
    version: text(),
    models: jsonb().notNull().default([]), // Ollama models the computer reported (names)
    gpu: jsonb(), // Connector v0.2: { name, vramMb, driver } of the computer's NVIDIA GPU (null = none / not reported)
    comfy: jsonb(), // Connector v0.2: { ok, version, error, ready: [template ids it can run], missing: { templateId: [...] } }
    model: text(), // the model the user picked for writing on this computer
    lastSeenAt: timestamp({ withTimezone: true }),
    lastError: text(),
    lastErrorAt: timestamp({ withTimezone: true }),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("connectors_token_hash").on(t.tokenHash), index("connectors_user").on(t.userId)],
);

export const connectorPairings = pgTable("connector_pairings", {
  id: text().primaryKey(),
  deviceCodeHash: text().notNull().unique(),
  userCode: text().notNull().unique(), // shown to the user, e.g. "KQ7M-4TZP"
  name: text().notNull(),
  platform: text(),
  version: text(),
  origin: text(), // where the pairing request came from ("US · 203.0.113.7"), shown before the user approves
  approvedBy: text().references(() => user.id, { onDelete: "cascade" }),
  connectorId: text(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// One AI request relayed to a computer; the generation worker inserts it, the connector claims it and posts the result,
// the worker reads it and deletes the row (payloads can hold photo frames, so nothing is kept).
export const connectorJobs = pgTable(
  "connector_jobs",
  {
    id: text().primaryKey(),
    connectorId: text().notNull().references(() => connectors.id, { onDelete: "cascade" }),
    kind: text().notNull(), // llm.chat | comfy.run (v0.2: a template shipped in the Connector, typed inputs only)
    payload: jsonb().notNull(), // sent to the computer as-is
    inputs: jsonb(), // comfy.run: { name: storageKey } — server-only; the computer downloads them by name
    outputKey: text(), // comfy.run: MinIO key of the uploaded result
    progress: integer(), // comfy.run: 0–100 reported by the computer
    status: text().notNull().default("queued"), // queued | running | done | failed | expired
    result: text(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("connector_jobs_queue").on(t.connectorId, t.status, t.createdAt)],
);

// Waltz Avatar (Phase 1): a user's own presenter ("digital twin") — their footage, lip-synced to new speech by MuseTalk on
// AISERVER (aiserver/talking/presenter.py). Created only after an automatic consent check (live clip + one-time code +
// voice match, aiserver/talking/consent.py). Deleting one removes its footage, consent clip and the AISERVER cache.
export const presenters = pgTable(
  "presenters",
  {
    id: text().primaryKey(), // uuid (also the AISERVER cache dir name)
    userId: text().notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull(),
    kind: text().notNull().default("twin"), // twin (a user's own) | ai (library, fictional, generated) | actor (licensed, signed release)
    // A user's own presenter (twin) is made from: video (their footage) | photo (a frame of their live consent clip, animated)
    // | ai (a fictional face they generated). photo + ai are built like the library's AI presenters (EchoMimic base footage).
    source: text().notNull().default("video"),
    photoAt: real(), // photo: seconds into the consent clip of the frame the user picked
    buildChargeId: text(), // photo / ai: the generation_jobs row charged for the build (failed → refunded)
    // Phase 2 — ClipWaltz's presenter library (admin-made): every user may use a library presenter that is ready.
    library: boolean().notNull().default(false),
    description: text(), // ai: the look it was generated from; actor: who they are
    releaseRef: text(), // actor: the signed release's reference (AI likeness + voice; scope, territory, term)
    portraitKeys: jsonb(), // ai: generated face candidates (MinIO keys) to pick from
    status: text().notNull().default("draft"), // draft | queued | preparing | ready | failed
    consentCode: text(), // the one-time code shown while recording the consent clip
    footageKey: text(), // MinIO: presenters/<userId>/<id>/footage.<ext>
    consentKey: text(), // MinIO: presenters/<userId>/<id>/consent.<ext> (live browser recording)
    thumbKey: text(),
    voice: text().notNull().default("af_heart"), // default Kokoro voice for this presenter
    meta: jsonb(), // { frames, width, height, missing } from the prepare step
    error: text(),
    // Phase 2 — the presenter's own cloned voice (Chatterbox on AISERVER, aiserver/voice): its own live consent (a voice
    // sentence + code, checked against the footage's voice), then a reference clip cut from the footage.
    voiceStatus: text().notNull().default("none"), // none | draft | queued | ready | failed
    voiceConsentCode: text(),
    voiceConsentKey: text(), // MinIO: presenters/<userId>/<id>/voice-consent-<uuid>.mp4
    voiceRefKey: text(), // MinIO: presenters/<userId>/<id>/voice-ref.wav (≈ 12 s of the footage's speech)
    voiceError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("presenters_user_idx").on(t.userId, t.createdAt)],
);

// Consent record per presenter attempt (kept when the presenter is deleted — the clip itself is removed).
export const presenterConsents = pgTable(
  "presenter_consents",
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => user.id, { onDelete: "cascade" }),
    presenterId: text().references(() => presenters.id, { onDelete: "set null" }),
    kind: text().notNull().default("likeness"), // likeness | voice (Phase 2 voice clones)
    subjectName: text().notNull(),
    statement: text().notNull(), // the sentence shown on screen
    code: text().notNull(),
    method: text().notNull().default("code+face+voice-match"),
    verified: boolean().notNull().default(false),
    result: jsonb(), // { transcript, heard, code_ok, face_share, voice_score, reason }
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("presenter_consents_user_idx").on(t.userId, t.createdAt)],
);

export const aiPrefs = pgTable("ai_prefs", {
  userId: text().primaryKey().references(() => user.id, { onDelete: "cascade" }),
  writingProvider: text().notNull().default("builtin"), // builtin | anthropic | openai | deepseek | gemini
  source: text().notNull().default("platform"), // platform (ClipWaltz's key) | own (the user's key)
  platformDay: text(), // UTC date (YYYY-MM-DD) of platformJobs — daily cap on ClipWaltz's key
  platformJobs: integer().notNull().default(0),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Saved Generate-tab settings per user. `isRecent` = the auto-saved last-used settings (one row per
// user, CW-MVP-172); named rows are favourite presets (CW-MVP-173).
export const generationPresets = pgTable("generation_presets", {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text(),
  isRecent: boolean().notNull().default(false),
  settings: jsonb().notNull(), // { mode, prompt, negativePrompt, style, camera, motion, aspect, duration, quality, seed }
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// An ordered scene within a project (storyboard unit). Generation jobs/versions attach to a scene.
export const scenes = pgTable("scenes", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sequenceNumber: integer().notNull().default(0),
  title: text(),
  description: text(),
  durationTarget: real(), // desired seconds
  selectedVersionId: text(), // generation version used for this scene in the assembled storyboard
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A single AI generation request. Enqueued to BullMQ (ADR-0002); the AISERVER worker drives it
// through the state machine. Each run of a job may produce a generationVersion.
export const generationJobs = pgTable("generation_jobs", {
  id: text().primaryKey(),
  projectId: text().references(() => projects.id, { onDelete: "cascade" }), // null: not tied to a project (a presenter build)
  sceneId: text().references(() => scenes.id, { onDelete: "set null" }),
  workspaceId: text().references(() => workspaces.id, { onDelete: "cascade" }),
  requestedBy: text().references(() => user.id, { onDelete: "set null" }),
  jobType: text().notNull(), // text_to_video | image_to_video | montage | enhancement
  // queued | preparing | uploading_to_ai_node | loading_model | generating |
  // enhancing | encoding | uploading_output | completed | failed | cancelled | retried
  status: text().notNull().default("queued"),
  routingProfile: text(), // routing decision id/name (see routing engine)
  modelName: text(), // resolved model family (wan | hunyuan | ltx)
  workflowName: text(), // resolved workflow logical id
  workflowVersion: text(),
  prompt: text(),
  negativePrompt: text(),
  requestJson: jsonb(), // full normalized generation request (aspect, duration, quality, inputs…)
  // AI credits this job costs (src/lib/credits.ts). Counted against the requester's monthly allowance unless the
  // job ends failed / cancelled / retried (automatic refund). 0 for non-AI work (Fast enhance, storyboard assembly).
  credits: integer().notNull().default(0),
  priority: integer().notNull().default(0),
  retryCount: integer().notNull().default(0),
  progress: integer().notNull().default(0), // 0–100
  queuePosition: integer(),
  startedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  failedAt: timestamp({ withTimezone: true }),
  errorCode: text(),
  errorMessage: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A produced output of a generation job. Multiple versions per job/scene enable compare/select.
export const generationVersions = pgTable("generation_versions", {
  id: text().primaryKey(),
  generationJobId: text()
    .notNull()
    .references(() => generationJobs.id, { onDelete: "cascade" }),
  projectId: text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sceneId: text().references(() => scenes.id, { onDelete: "set null" }),
  versionNumber: integer().notNull().default(1),
  outputAssetId: text().references(() => assets.id, { onDelete: "set null" }),
  outputKey: text(), // MinIO object key of the generated video (watermarked when the job was)
  // Unwatermarked master (only when outputKey carries the logo). Enhance / Assemble / Export read
  // this so a logo is never processed or stacked twice.
  cleanKey: text(),
  thumbnailKey: text(),
  durationSec: real(),
  qualityScore: real(),
  selected: boolean().notNull().default(false), // the chosen version for the scene
  favorite: boolean().notNull().default(false),
  settings: jsonb(), // effective generation settings snapshot (reproducibility)
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A distinct export/delivery job (separate from generation — Guide §18). Renders a chosen version
// to a final deliverable at a requested format/resolution.
export const exportJobs = pgTable("export_jobs", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  workspaceId: text().references(() => workspaces.id, { onDelete: "cascade" }),
  sourceVersionId: text().references(() => generationVersions.id, { onDelete: "set null" }),
  requestedBy: text().references(() => user.id, { onDelete: "set null" }),
  status: text().notNull().default("queued"), // queued | processing | completed | failed | cancelled
  outputFormat: text().notNull().default("mp4"), // mp4 | webm | mov
  resolution: text(), // e.g. 1080x1920
  watermark: boolean().notNull().default(false), // stamp the ClipWaltz logo on the export
  aspectRatio: text(), // 9:16 | 16:9 | 1:1
  presetName: text(),
  outputAssetId: text().references(() => assets.id, { onDelete: "set null" }),
  outputKey: text(),
  errorMessage: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
});

// Reusable creation template (start-from-template). Binds a workflow profile + default settings.
export const templates = pgTable("templates", {
  id: text().primaryKey(),
  name: text().notNull(),
  category: text(), // e.g. cinematic | travel | product | social
  workflowProfile: text(), // logical workflow/routing profile this template drives
  description: text(),
  thumbnailKey: text(),
  metadataJson: jsonb(), // default prompt/settings/aspect the template pre-fills
  enabled: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Per-workspace brand kit (logo/colors/fonts/style guidance) applied to generations/exports.
export const brandKits = pgTable("brand_kits", {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text().notNull().default("Brand Kit"),
  logoAssetId: text().references(() => assets.id, { onDelete: "set null" }),
  colorsJson: jsonb(), // string[] hex
  fontsJson: jsonb(),
  styleGuidance: text(),
  logoKey: text(), // MinIO key of the uploaded logo (PNG/SVG/JPEG) — WaltzDeck end cards + corner logo
  pronunciationsJson: jsonb(), // { word, say }[] — how the voiceover says brand words (TxtYa → "Text Ya")
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// WaltzDeck storyboard: one row per scene card of a kind="deck" project, in order. The planner (LLM)
// writes unlocked rows; the user edits any row and can lock it so re-planning never touches it.
export const deckScenes = pgTable("deck_scenes", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  orderIndex: integer().notNull().default(0),
  role: text().notNull().default("content"), // hook | problem | benefit | proof | content | title | cta | …
  assetId: text().references(() => assets.id, { onDelete: "set null" }), // null = text-only card (e.g. CTA end card)
  inSec: real(), // window of a video asset (null = auto / photo)
  outSec: real(),
  // Framing of the media in this scene: { x, y } = centre (0–1 of the upright source), zoom ≥ 1. null = centred
  // cover (src/lib/deck/frame.ts, worker/deck/frame.mjs).
  frame: jsonb(),
  // What's behind a text-only scene (or media zoomed out below fill): { style, intensity, seed, imageId? }.
  // null = the deck default (DeckBrief.backdrop). worker/deck/backdrop.mjs.
  background: jsonb(),
  durationSec: real().notNull().default(3),
  textMode: text().notNull().default("auto"), // auto (AI writes) | manual (user's words, never rewritten) | none
  text: jsonb(), // { headline?: string, sub?: string, bullets?: string[] }
  layout: text().notNull().default("headline-bottom"), // scene template id (worker/deck/templates)
  motion: text().notNull().default("auto"), // auto | none | push-in | pull-out | pan-left | pan-right
  transition: text().notNull().default("cut"), // cut | crossfade
  locked: boolean().notNull().default(false),
  voice: text(), // narration line for this scene (phase 2); null/empty = silent
  prompt: text(), // the scene's suggested AI shot (planner / chat) — was the user's rewrite instruction before 2026-10-05
  captionPosition: text(), // voiceover captions for this scene: "top" | "bottom"; null = the deck's default
  why: text(), // planner's one-line reason for its choices, shown on the card
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// WaltzDeck slide exports (phase 3): the storyboard as a PDF or an editable PPTX. Queued by the app, built
// by the render worker on the AI box (headless Chromium, worker/deck/export.mjs), stored under exports/<projectId>/.
export const deckExports = pgTable("deck_exports", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  format: text().notNull(), // pdf | pptx
  status: text().notNull().default("queued"), // queued | running | done | failed
  watermark: boolean().notNull().default(true), // same rule as videos (src/lib/watermark.ts)
  outputKey: text(),
  error: text(),
  attempts: integer().notNull().default(0),
  requestedBy: text(),
  workerId: text(), // lease holder while 'running'
  heartbeatAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp({ withTimezone: true }),
  finishedAt: timestamp({ withTimezone: true }),
});

// Render workers (one row per worker process, e.g. the AI box and AISERVER). Upserted every ~20 s; the queue's
// capacity for wait estimates = sum(concurrency) of workers seen in the last 2 minutes.
export const renderWorkers = pgTable("render_workers", {
  id: text().primaryKey(), // WORKER_ID env, else hostname
  host: text().notNull(),
  concurrency: integer().notNull().default(1),
  active: integer().notNull().default(0), // renders running right now
  startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// WaltzDeck "What is this video for?" history: a user's last 15 briefs (newest first by usedAt), to reuse in a click.
export const deckBriefHistory = pgTable(
  "deck_brief_history",
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => user.id, { onDelete: "cascade" }),
    text: text().notNull(),
    usedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // md5: a long brief (a whole script, up to MAX_BRIEF_CHARS) is past what a btree index entry can hold.
  (t) => [uniqueIndex("deck_brief_history_user_text_idx").on(t.userId, sql`md5(${t.text})`), index("deck_brief_history_user_idx").on(t.userId, t.usedAt)],
);

// WaltzDeck campaign packs (phase 4): one storyboard → hooks × CTAs × lengths × aspects, rendered as a batch
// (renders.campaign_id). The AI writes hook / CTA options on the deck worker; the owner reviews them (status draft)
// and renders. `shared` opens the variants' landing pages (/c/<renderId>). `parentId` = "make more like the winner".
export const deckCampaigns = pgTable("deck_campaigns", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text().notNull(),
  status: text().notNull().default("drafting"), // drafting | draft | building | rendering | failed
  config: jsonb().notNull(), // { hooks:[…], ctas:[…], lengths:number[], aspects:string[], ctaUrl, aiHooks, aiCtas, winner? }
  shared: boolean().notNull().default(false),
  parentId: text(),
  error: text(),
  createdBy: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Per-variant audience events from the public landing page: view | play | complete | click. One row per visitor,
// render, type and UTC day (unique index) — `visitor` is a salted hash, never an IP or cookie value.
export const variantEvents = pgTable(
  "variant_events",
  {
    id: text().primaryKey(),
    renderId: text()
      .notNull()
      .references(() => renders.id, { onDelete: "cascade" }),
    campaignId: text().notNull(),
    type: text().notNull(),
    visitor: text().notNull(),
    net: text().notNull().default(""), // salted hash of the network address (per-address daily cap)
    day: text().notNull(), // YYYY-MM-DD (UTC)
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("variant_events_dedupe_idx").on(t.renderId, t.type, t.visitor, t.day),
    index("variant_events_campaign_idx").on(t.campaignId, t.type),
  ],
);

// Registry of AI model families the platform can route to (Architecture §9). Admin-toggleable.
// ComfyUI stays hidden behind this — the app references models by name, never node internals.
export const modelRegistry = pgTable("model_registry", {
  id: text().primaryKey(),
  name: text().notNull().unique(), // wan | hunyuan | ltx | …
  family: text(), // model family/label
  role: text(), // primary | premium | fast
  enabled: boolean().notNull().default(false),
  vramProfileMb: integer(), // approx VRAM the model needs to load
  capabilities: jsonb(), // { imageToVideo, textToVideo, maxDurationSec, aspectRatios[] }
  description: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Versioned ComfyUI workflow definitions (Architecture §8). Preserves reproducibility: a version's
// workflow JSON is pinned so past generations remain reproducible when workflows evolve.
export const workflowRegistry = pgTable(
  "workflow_registry",
  {
    id: text().primaryKey(),
    workflowId: text().notNull(), // logical id; `${workflowId}-${version}` is the AISERVER wrapper id
    version: text().notNull(), // e.g. "v1"
    // What it does: text_to_video | image_to_video | upscale | interpolate | restore (routing key).
    task: text(),
    modelName: text(), // supported model family
    inputTypes: jsonb(), // string[] — image | text | video
    aspectRatios: jsonb(), // string[] — 9:16 | 16:9 | 1:1
    durationMin: real(),
    durationMax: real(),
    requiredVramMb: integer(),
    expectedOutput: text(), // e.g. mp4
    workflowPath: text(), // path/key to the pinned workflow JSON
    parameterMapping: jsonb(), // maps ClipWaltz params → ComfyUI node inputs
    enabled: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.workflowId, t.version)],
);

// Routing rules (CW-MVP-070): task + quality → workflow + sampler steps, admin-editable so routing
// changes need no frontend deploy. Lowest `priority` wins among rules whose workflow AND model are
// enabled; the next one is the fallback. See src/lib/ai/routing.ts.
export const routingRules = pgTable("routing_rules", {
  id: text().primaryKey(),
  task: text().notNull(), // text_to_video | image_to_video
  quality: text().notNull(), // preview | standard | high
  workflowRegistryId: text()
    .notNull()
    .references(() => workflowRegistry.id, { onDelete: "cascade" }),
  steps: integer(), // sampler steps; null = workflow default
  priority: integer().notNull().default(0),
  enabled: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Beta instrumentation (DESIGN_BUILD_PLAN §3). Append-only product events: the funnel (uploads,
// first draft preview, renders, downloads, shares, exports), plan changes (free → paid history, which
// `subscriptions` overwrites) and daily storage snapshots. Server-written (src/lib/analytics.ts);
// the client can only send an allow-listed set. No FK on project: events outlive deleted projects.
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    userId: text().references(() => user.id, { onDelete: "set null" }),
    projectId: text(),
    props: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("analytics_events_name_created_idx").on(t.name, t.createdAt), index("analytics_events_user_idx").on(t.userId)],
);

// In-app feedback (beta): the Feedback button in the user menu. Reviewed in /admin.
export const feedback = pgTable("feedback", {
  id: text().primaryKey(),
  userId: text().references(() => user.id, { onDelete: "set null" }),
  email: text(), // snapshot, so feedback stays readable after an account is deleted
  page: text(), // path the user was on
  kind: text().notNull().default("idea"), // idea | bug | praise | other
  message: text().notNull(),
  status: text().notNull().default("new"), // new | read | done
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// ─── Social Publishing (ADR-0011; ported from publish.phoenixtekk.com) ──────────────────────────
// Column shapes mirror Social Publishing's `social_connection` / `post` / `post_target` / `media` / `auto_post_rule` /
// `auto_post_preset` / `snippet` / `ai_generation` so the P4 migration script can copy rows across. The differences:
// every table is owned by a WORKSPACE (SP owned rows per user), the author is `createdBy`, connection credentials are
// encrypted at rest (src/lib/cloud/crypto.ts), and media lives in MinIO (`storageKey`) instead of on disk.

// A connected social account. Many per provider per workspace (two Facebook Pages, two Telegram channels).
export const socialConnections = pgTable(
  "social_connections",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    provider: text().notNull(), // "facebook" | "linkedin" | … (src/lib/social/publishing/types.ts ProviderId)
    label: text(),
    // ENCRYPTED ("enc1:…", AES-256-GCM, TOKEN_ENC_KEY). Some providers store a JSON blob here (Mastodon instance +
    // token, X/TikTok/YouTube refresh material); it is encrypted as one string. Never sent to the client.
    accessToken: text().notNull(),
    refreshToken: text(), // ENCRYPTED
    expiresAt: timestamp({ withTimezone: true }),
    externalId: text(), // org id (LinkedIn) / page id (Facebook) / channel id …
    displayName: text(),
    scope: text(),
    aiContext: text(), // per-network AI persona/brief
    paused: boolean().notNull().default(false), // parked: kept, never published to
    // P4 double-post guard: rows imported from Social Publishing land with migrationHold="sp-import" and are never
    // published, retried, refreshed or swept while set. Cleared only by scripts/migrate-social-publishing.mjs --activate.
    migrationHold: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("social_connections_ws_provider_idx").on(t.workspaceId, t.provider)],
);

// The unit of content; fans out to one social_post_targets row per destination.
export const socialPosts = pgTable(
  "social_posts",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    text: text().notNull().default(""),
    link: text(),
    // draft | queued | scheduled | publishing | published | failed | partial | handoff | rendering
    status: text().notNull().default("draft"),
    providers: text().notNull().default(""), // comma-separated destination keys (provider or provider#connId)
    perNetwork: jsonb().$type<Record<string, { text?: string; mediaIds?: string[]; link?: string; meta?: Record<string, unknown> }>>(),
    favorite: boolean().notNull().default(false),
    autoImage: boolean().notNull().default(false),
    autoVideo: boolean().notNull().default(false),
    autoGif: boolean().notNull().default(false),
    mergeMediaId: text(),
    shareToken: text().unique(), // public read-only review link
    funnelId: text(),
    funnelStageId: text(),
    autoPostRuleId: text(),
    shortRuleId: text(),
    // A post can carry a ClipWaltz render or export (the "Publish" button on renders, P2).
    renderId: text().references(() => renders.id, { onDelete: "set null" }),
    exportId: text().references(() => exportJobs.id, { onDelete: "set null" }),
    // D9 approval workflow: none | pending | approved | rejected. A post that is `pending` or `rejected` is never
    // published by the scheduler, whatever its status says.
    approvalStatus: text().notNull().default("none"),
    approvedBy: text().references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp({ withTimezone: true }),
    // G14 content plan (P6): posts made together by "Plan a week" share a planId; angle = problem | educational |
    // proof | minimal.
    planId: text(),
    planAngle: text(),
    scheduledAt: timestamp({ withTimezone: true }),
    // P4 double-post guard: rows imported from Social Publishing land with migrationHold="sp-import" and are never
    // published, retried, refreshed or swept while set. Cleared only by scripts/migrate-social-publishing.mjs --activate.
    migrationHold: text(),
    publishedAt: timestamp({ withTimezone: true }),
    warnings: jsonb().$type<string[]>(), // non-fatal notes kept on the post (see SP history)
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("social_posts_ws_status_idx").on(t.workspaceId, t.status),
    index("social_posts_status_scheduled_idx").on(t.status, t.scheduledAt),
  ],
);

// One destination of a post. The row id is the idempotency key of the `publish-target` queue job.
export const socialPostTargets = pgTable(
  "social_post_targets",
  {
    id: text().primaryKey(),
    postId: text()
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    connectionId: text(),
    label: text(),
    // pending | publishing | published | failed | handoff
    status: text().notNull().default("pending"),
    externalId: text(),
    url: text(),
    error: text(),
    attempts: integer().notNull().default(0),
    retryAt: timestamp({ withTimezone: true }),
    // P4 double-post guard: rows imported from Social Publishing land with migrationHold="sp-import" and are never
    // published, retried, refreshed or swept while set. Cleared only by scripts/migrate-social-publishing.mjs --activate.
    migrationHold: text(),
    // Latest engagement numbers from the hourly metrics-pull ({ likes, comments, shares, views }).
    metrics: jsonb().$type<{ likes: number | null; comments: number | null; shares: number | null; views: number | null }>(),
    metricsAt: timestamp({ withTimezone: true }),
    // Latest comments from a comments-pull job (src/lib/social/jobs.ts) — the Comments inbox (P2) reads this cache.
    comments: jsonb().$type<
      { id: string; author: string; text: string; createdAt: string | null; ref?: { uri: string; cid: string; rootUri: string; rootCid: string } }[]
    >(),
    commentsAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("social_post_targets_post_idx").on(t.postId),
    index("social_post_targets_status_retry_idx").on(t.status, t.retryAt),
  ],
);

// Media attached to posts. Bytes live in MinIO under `social/<workspaceId>/<id>`.
export const socialMedia = pgTable(
  "social_media",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    postId: text().references(() => socialPosts.id, { onDelete: "set null" }),
    kind: text().notNull(), // image | video | audio
    filename: text().notNull(),
    mime: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    storageKey: text().notNull(),
    source: text().notNull().default("upload"), // upload | ai | render
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("social_media_post_idx").on(t.postId), index("social_media_ws_idx").on(t.workspaceId)],
);

// Auto Post: recurring rules (many per workspace).
export const socialAutoRules = pgTable(
  "social_auto_rules",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    name: text().notNull().default("Queue"),
    daysOfWeek: text().notNull().default("1,2,3,4,5"), // 0=Sun..6=Sat
    timeOfDay: text().notNull().default("09:00"), // HH:MM (or comma list), evaluated in `timezone`
    // IANA zone for this rule. SP had one zone per installation; a multi-tenant app needs one per rule.
    timezone: text(),
    providers: text().notNull().default(""),
    active: boolean().notNull().default(true),
    mode: text().notNull().default("queue"), // queue | generate
    // P4 double-post guard: rows imported from Social Publishing land with migrationHold="sp-import" and are never
    // published, retried, refreshed or swept while set. Cleared only by scripts/migrate-social-publishing.mjs --activate.
    migrationHold: text(),
    seedPrompt: text().notNull().default(""),
    topics: text().notNull().default(""),
    topicCursor: integer().notNull().default(0),
    links: text().notNull().default(""),
    linkCursor: integer().notNull().default(0),
    linkUtm: boolean().notNull().default(false),
    productId: text(), // SP product grounding (funnels stay on SP — D3); kept for row-copy fidelity
    imageMode: text().notNull().default("none"), // none | generate | set
    videoMode: text().notNull().default("none"), // none | explainer (P5)
    imageSet: text().notNull().default(""),
    imageCursor: integer().notNull().default(0),
    reviewFirst: boolean().notNull().default(false),
    nextRunAt: timestamp({ withTimezone: true }),
    lastRunAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("social_auto_rules_active_next_idx").on(t.active, t.nextRunAt)],
);

// Saved Auto Post configurations.
export const socialAutoPresets = pgTable("social_auto_presets", {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  createdBy: text().references(() => user.id, { onDelete: "set null" }),
  name: text().notNull().default("Untitled preset"),
  daysOfWeek: text().notNull().default("1,2,3,4,5"),
  timeOfDay: text().notNull().default("09:00"),
  providers: text().notNull().default(""),
  mode: text().notNull().default("generate"),
  seedPrompt: text().notNull().default(""),
  topics: text().notNull().default(""),
  productId: text(),
  imageMode: text().notNull().default("none"),
  videoMode: text().notNull().default("none"),
  imageSet: text().notNull().default(""),
  links: text().notNull().default(""),
  linkUtm: boolean().notNull().default(false),
  reviewFirst: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Saved post-text templates for the composer.
export const socialSnippets = pgTable("social_snippets", {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  createdBy: text().references(() => user.id, { onDelete: "set null" }),
  name: text().notNull().default(""),
  text: text().notNull().default(""),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// AI writing-assistant history.
export const socialAiGenerations = pgTable("social_ai_generations", {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  createdBy: text().references(() => user.id, { onDelete: "set null" }),
  mode: text().notNull(), // write | improve | shorten | hashtags | ideas
  length: text(),
  input: text().notNull().default(""),
  output: text().notNull().default(""),
  favorite: boolean().notNull().default(false),
  tags: text().notNull().default(""),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Waltz Image (plan G1 / G2 / G5, P3): an image ad, a carousel or a meme. The words live here (data), never in the
// pictures, so editing a headline re-composites on the server with no GPU job (src/lib/image-ad/render.ts). Workspace-
// scoped like social posts (the caller's personal workspace in P3).
//   data, by kind (src/lib/image-ad/types.ts):
//     image    { brief, style, layout, headline, subhead, cta, useBrand, imageId }
//     carousel { style, cta, slides: [{ id, imageId|null, headline, body }] }
//     meme     { layout, top, bottom, caption, imageId }
export const imageDesigns = pgTable(
  "image_designs",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    kind: text().notNull().default("image"), // image | carousel | meme
    title: text().notNull().default(""),
    format: text().notNull().default("1:1"), // worker/image/presets.mjs IMAGE_FORMATS key
    data: jsonb().notNull().default({}),
    // Library copies of the last saved output (media.id[], one per image / slide), replaced on the next save.
    savedMediaIds: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("image_designs_ws_updated_idx").on(t.workspaceId, t.updatedAt),
    check("image_designs_kind_check", sql`${t.kind} in ('image', 'carousel', 'meme')`),
  ],
);

// The pictures a design can use: AI renders (generation_jobs.job_type = 'image', 2 credits each, refunded on failure)
// and uploads (free). Clean pictures only — text is composited at render time. An AI row has no storage_key until the
// generation worker stores the finished render (worker/image/job.mjs).
export const imageDesignImages = pgTable(
  "image_design_images",
  {
    id: text().primaryKey(),
    designId: text()
      .notNull()
      .references(() => imageDesigns.id, { onDelete: "cascade" }),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    source: text().notNull(), // ai | upload
    generationJobId: text().references(() => generationJobs.id, { onDelete: "set null" }),
    storageKey: text(),
    width: integer(),
    height: integer(),
    prompt: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("image_design_images_design_idx").on(t.designId),
    index("image_design_images_job_idx").on(t.generationJobId),
    check("image_design_images_source_check", sql`${t.source} in ('ai', 'upload')`),
  ],
);

// ─── P5: podcast hosting (decision D4 — the feed moved here from Social Publishing) ─────────────────────────────────
// Shapes follow SP's 0029/0030 (Apple's RSS requirements, IAB Podcast Measurement v2.2) plus `workspace_id`. Audio and
// artwork are `social_media` rows (MinIO `social/<workspace>/<id>`); the feed reads each enclosure's byte length from
// `social_media.size`, so an imported episode keeps its exact length. GUIDs are immutable: Apple treats a changed GUID
// as a different episode.
export const podcastShows = pgTable(
  "podcast_shows",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    slug: text().notNull().unique(), // public: /p/<slug>/rss.xml
    title: text().notNull(),
    description: text().notNull(),
    author: text(),
    language: text().notNull().default("en-us"),
    category: text().notNull().default("Technology"),
    subcategory: text(),
    explicit: boolean().notNull().default(false),
    link: text(),
    coverMediaId: text().references(() => socialMedia.id, { onDelete: "set null" }),
    copyright: text(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("podcast_shows_ws_idx").on(t.workspaceId)],
);

export const podcastEpisodes = pgTable(
  "podcast_episodes",
  {
    id: text().primaryKey(),
    showId: text()
      .notNull()
      .references(() => podcastShows.id, { onDelete: "cascade" }),
    postId: text().references(() => socialPosts.id, { onDelete: "set null" }),
    guid: text().notNull().unique(), // `urn:uuid:<id>` for new episodes; imported episodes keep SP's value verbatim
    title: text().notNull(),
    description: text().notNull(),
    audioMediaId: text()
      .notNull()
      .references(() => socialMedia.id, { onDelete: "restrict" }),
    durationSec: integer().notNull(),
    imageMediaId: text().references(() => socialMedia.id, { onDelete: "set null" }),
    link: text(),
    publishedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("podcast_episodes_feed_idx").on(t.showId, t.publishedAt.desc())],
);

// One row per (episode, UTC day, client) — the IAB dedup unit. The client is only a salted hash (never the IP).
export const podcastListens = pgTable(
  "podcast_listens",
  {
    showId: text()
      .notNull()
      .references(() => podcastShows.id, { onDelete: "cascade" }),
    episodeId: text()
      .notNull()
      .references(() => podcastEpisodes.id, { onDelete: "cascade" }),
    day: text().notNull(), // YYYY-MM-DD (UTC)
    clientHash: text().notNull(),
    bytes: bigint({ mode: "number" }).notNull().default(0),
    requests: integer().notNull().default(0),
    counted: boolean().notNull().default(false),
    app: text(),
    firstAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("podcast_listens_pk").on(t.episodeId, t.day, t.clientHash),
    index("podcast_listens_show_day_idx").on(t.showId, t.day),
    index("podcast_listens_episode_idx").on(t.episodeId),
  ],
);

// ─── P5: Shorts rules (decision D6, SP 0031) ───────────────────────────────────────────────────────────────────────
// A recurring rule that produces one vertical tip video per slot. `source = 'workplace'` (ground the script in the
// Phoenixtekk Workplace catalogue) is only allowed for site-admin workspaces; everyone else writes their own brief
// (`source = 'seed'`). Built on the render worker (AI box) as a `social_render_jobs` row of kind 'short'.
export const shortRules = pgTable(
  "short_rules",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    name: text().notNull(),
    source: text().notNull().default("seed"), // workplace | seed
    solutionFilter: text().notNull().default(""),
    solutionCursor: integer().notNull().default(0),
    seedPrompt: text().notNull().default(""),
    topics: text().notNull().default(""),
    topicCursor: integer().notNull().default(0),
    daysOfWeek: text().notNull().default("1,2,3,4,5"),
    timeOfDay: text().notNull().default("09:00"),
    timezone: text(),
    providers: text().notNull().default(""),
    active: boolean().notNull().default(true),
    reviewFirst: boolean().notNull().default(true),
    // P4/P5 double-post guard: rules imported from SP stay held until `--activate`.
    migrationHold: text(),
    nextRunAt: timestamp({ withTimezone: true }),
    lastRunAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("short_rules_due_idx").on(t.active, t.nextRunAt)],
);

// ─── P5: explainer / short render jobs (SP `render_job` kind 'explainer', plus shorts) ─────────────────────────────
// Claimed by the render worker on the AI box (worker/social-render/job.mjs, FOR UPDATE SKIP LOCKED). An explainer
// advances ONE stage per claim (scripting → voicing → assembling → meta → ready) and persists between stages, so a
// crash never re-spends ElevenLabs characters; a short is built in one pass. Bytes go to MinIO (`social_media` rows)
// and `payload` carries ids only. When a job is `done`, the social worker's sweep finalizes its post (per-network copy
// + media) and releases it to publish (or to draft when review-first). `charge_id` is the generation_jobs row holding
// the AI credits — settled 'completed' on success, 'failed' (= refunded by the ledger) otherwise.
export const socialRenderJobs = pgTable(
  "social_render_jobs",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    postId: text().references(() => socialPosts.id, { onDelete: "cascade" }),
    kind: text().notNull(), // explainer | short
    ruleId: text(), // social_auto_rules.id (explainer) or short_rules.id (short); null = made by hand
    status: text().notNull().default("queued"), // queued | running | done | failed
    stage: text(),
    payload: jsonb().notNull().default({}),
    progress: integer().notNull().default(0),
    attempts: integer().notNull().default(0),
    error: text(),
    chargeId: text().references(() => generationJobs.id, { onDelete: "set null" }),
    finalizedAt: timestamp({ withTimezone: true }),
    startedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("social_render_jobs_status_idx").on(t.status, t.createdAt),
    index("social_render_jobs_ws_idx").on(t.workspaceId, t.createdAt),
    index("social_render_jobs_post_idx").on(t.postId),
    check("social_render_jobs_kind_check", sql`${t.kind} in ('explainer', 'short')`),
  ],
);

// ─── P6: approval history (G9) ─────────────────────────────────────────────────────────────────────────────────
// One row per approval event on a post: submitted for review, approved, or changes requested (with the note). A
// decision made through the public review link (/r/<token>) has no reviewer user and `viaToken` = true.
export const socialPostReviews = pgTable(
  "social_post_reviews",
  {
    id: text().primaryKey(),
    postId: text()
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    reviewerUserId: text().references(() => user.id, { onDelete: "set null" }),
    viaToken: boolean().notNull().default(false),
    reviewerName: text(), // typed by an external reviewer on the review link (optional)
    decision: text().notNull(), // submitted | approved | changes_requested
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("social_post_reviews_post_idx").on(t.postId, t.createdAt),
    check("social_post_reviews_decision_check", sql`${t.decision} in ('submitted', 'approved', 'changes_requested')`),
  ],
);

// ─── P6: product pages read from a URL (G3; G10 catalog sync will add rows here too) ──────────────────────────────
export const productSources = pgTable(
  "product_sources",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    url: text().notNull(),
    title: text().notNull().default(""),
    description: text(),
    price: text(), // as the page states it ("19.99"); never parsed into money
    currency: text(),
    brand: text(),
    images: jsonb().$type<string[]>().notNull().default([]),
    source: text().notNull().default("text"), // jsonld | og | text | catalog — where the name/price came from
    // G10: set when the product came from a store catalog sync (null = pasted product link, G3).
    connectionId: text().references(() => commerceConnections.id, { onDelete: "cascade" }),
    externalId: text(),
    available: boolean(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("product_sources_ws_idx").on(t.workspaceId, t.createdAt),
    uniqueIndex("product_sources_conn_ext_idx").on(t.connectionId, t.externalId),
  ],
);

// ─── P6 batch B (plan §6 G10, G12, G13, G7) ────────────────────────────────────────────────────────────────────────

// G10 store catalog connections. Shopify and WooCommerce sync from the shop's public storefront endpoints with no
// credentials; Wix (and an optional Shopify Admin token) need a key the store owner creates — stored ENCRYPTED
// ("enc1:…", TOKEN_ENC_KEY, same as social tokens) and never sent to the client. Deleting the connection deletes the
// credentials and every product it synced (cascade).
export const commerceConnections = pgTable(
  "commerce_connections",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    platform: text().notNull(), // shopify | woocommerce | wix
    storeUrl: text().notNull(), // https://shop.example.com (origin only)
    label: text(),
    currency: text(),
    credentials: text(), // ENCRYPTED JSON ({ token } | { apiKey, siteId }); null = public storefront sync
    webhookSecret: text(), // ENCRYPTED; HMAC key for /api/commerce/<platform>/webhook/<id>; null = webhooks off
    lastSyncedAt: timestamp({ withTimezone: true }),
    lastSyncCount: integer(),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("commerce_connections_ws_idx").on(t.workspaceId),
    check("commerce_connections_platform_check", sql`${t.platform} in ('shopify', 'woocommerce', 'wix')`),
  ],
);

// G12 public API keys. The secret is shown once; only its SHA-256 is stored (the secret is 32 random bytes, so a fast
// hash is enough — there is nothing to brute-force). `prefix` (first 12 chars) is shown in the UI to tell keys apart.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    name: text().notNull(),
    prefix: text().notNull(),
    hash: text().notNull(),
    scopes: jsonb().$type<string[]>().notNull().default([]), // read | generate | publish
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("api_keys_hash_idx").on(t.hash), index("api_keys_ws_idx").on(t.workspaceId)],
);

// One row per authenticated API / MCP request — the rate limiter counts these (a restart cannot reset the allowance).
// Rows older than 7 days are pruned opportunistically by src/lib/api-keys.ts.
export const apiRequests = pgTable(
  "api_requests",
  {
    id: text().primaryKey(),
    keyId: text()
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    workspaceId: text().notNull(),
    method: text().notNull(),
    path: text().notNull(),
    status: integer(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_requests_key_at_idx").on(t.keyId, t.at), index("api_requests_at_idx").on(t.at)],
);

// Idempotency-Key replay store (24 h): the same key + Idempotency-Key returns the first response instead of creating
// a second post / job.
export const apiIdempotency = pgTable(
  "api_idempotency",
  {
    id: text().primaryKey(),
    keyId: text()
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    idemKey: text().notNull(),
    requestHash: text().notNull(),
    status: integer(), // null while the first request is still running
    body: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("api_idempotency_key_idx").on(t.keyId, t.idemKey)],
);

// G7 competitor intelligence — public sources only (RSS/Atom feeds, YouTube channel feeds, Bluesky and Mastodon public
// APIs). Public fields only, with where and when they were fetched.
export const competitorSources = pgTable(
  "competitor_sources",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    name: text().notNull(),
    kind: text().notNull(), // rss | youtube | bluesky | mastodon
    ref: text().notNull(), // feed URL | YouTube channel id | Bluesky handle | Mastodon @user@host
    summary: text(),
    summaryAt: timestamp({ withTimezone: true }),
    lastFetchedAt: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("competitor_sources_ws_idx").on(t.workspaceId),
    check("competitor_sources_kind_check", sql`${t.kind} in ('rss', 'youtube', 'bluesky', 'mastodon')`),
  ],
);

export const competitorPosts = pgTable(
  "competitor_posts",
  {
    id: text().primaryKey(),
    sourceId: text()
      .notNull()
      .references(() => competitorSources.id, { onDelete: "cascade" }),
    workspaceId: text().notNull(),
    externalId: text().notNull(),
    url: text(),
    title: text(),
    text: text().notNull().default(""),
    publishedAt: timestamp({ withTimezone: true }),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("competitor_posts_source_ext_idx").on(t.sourceId, t.externalId), index("competitor_posts_ws_idx").on(t.workspaceId, t.publishedAt)],
);

// Post kits (2026-11-14, owner: "a feature that produces the content; I'll publish manually"). One source — a render,
// an export, a Waltz Image design, uploaded images or just an idea — becomes, per chosen network, a caption + hashtags
// (+ a title where the network has one) and the images redrawn or cropped to that network's size. Nothing is posted:
// the owner copies, downloads and ticks "posted". Image bytes are social_media rows (post_id null) listed in `assets`.
export const postKits = pgTable(
  "post_kits",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    title: text().notNull().default(""),
    brief: text().notNull().default(""),
    link: text(),
    source: jsonb().notNull(), // KitSource (src/lib/kits/types.ts)
    networks: text().notNull().default(""), // comma list of provider ids, in display order
    items: jsonb().notNull().default([]), // KitItem[]
    assets: jsonb().notNull().default([]), // KitAsset[]
    status: text().notNull().default("writing"), // writing | ready | failed
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("post_kits_ws_idx").on(t.workspaceId, t.createdAt)],
);
