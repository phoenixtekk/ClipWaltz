import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

// ClipWaltz domain tables (MVP). Field names are camelCase; with the snake_case-cased
// Drizzle client the DB columns become snake_case automatically.

// Licensed royalty-free music catalog (see Design & Build Plan §2 — music strategy).
export const musicTracks = pgTable("music_tracks", {
  id: text().primaryKey(),
  title: text().notNull(),
  artist: text(),
  licenseRef: text(), // catalog / license reference — proves "safe to post"
  bpm: integer(),
  mood: text(), // e.g. upbeat, chill, cinematic
  durationSec: real(),
  storageKey: text().notNull(), // MinIO object key
  active: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

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
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Uploaded source media (photos + videos) for a project.
export const assets = pgTable("assets", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  storageKey: text().notNull(), // MinIO object key
  kind: text().notNull(), // photo | video
  originalName: text(),
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
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp({ withTimezone: true }),
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
