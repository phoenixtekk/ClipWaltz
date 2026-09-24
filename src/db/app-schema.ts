import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  unique,
  jsonb,
} from "drizzle-orm/pg-core";
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
  reframeMode: text().notNull().default("flat"), // 360 reframe: flat | follow | tiny
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
  cpuSeconds: real(), // instrumentation → cost-per-render
  costCents: integer(),
  visibility: text().notNull().default("private"), // private | unlisted | public (community feed)
  settings: jsonb(), // snapshot of the effective Format+Style settings at render time (audit + "what changed")
  description: text(), // AI-generated YouTube description (when project.describe is on)
  sharedAt: timestamp({ withTimezone: true }),
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
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

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
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A single AI generation request. Enqueued to BullMQ (ADR-0002); the AISERVER worker drives it
// through the state machine. Each run of a job may produce a generationVersion.
export const generationJobs = pgTable("generation_jobs", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
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
  outputKey: text(), // MinIO object key of the generated video
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
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

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
