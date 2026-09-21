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
  storageKey: text().notNull(), // MinIO object key
  kind: text().notNull(), // photo | video
  originalName: text(),
  // 360 / Insta360 ingest: original format + async reprojection to a usable flat clip.
  sourceFormat: text(), // null for normal uploads; insv | lrv | insp for 360 files
  conversionState: text().notNull().default("ready"), // ready | pending | converting | failed
  convertedKey: text(), // MinIO key of the flat mp4/jpg once reprojected
  durationSec: real(),
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
