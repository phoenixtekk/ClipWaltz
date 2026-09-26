"use server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { userCanAccessProject } from "./workspace";
import { track, type EventProps } from "./analytics";

// Events only the browser can see (beta instrumentation). Allow-listed names and props, so a
// client can't write arbitrary rows; everything else is recorded server-side (src/lib/analytics.ts).
const CLIENT_EVENTS = new Set(["upload_started", "upload_failed", "upload_resumed", "draft_preview_shown"]);
const PROP_KEYS = new Set(["bytes", "method", "reason", "partsDone", "clips"]);

function cleanProps(p: unknown): EventProps {
  const out: EventProps = {};
  if (!p || typeof p !== "object") return out;
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    if (!PROP_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 160);
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

export async function trackClientEvent(name: string, projectId: string, props?: Record<string, unknown>): Promise<void> {
  if (!CLIENT_EVENTS.has(name)) return;
  const userId = await requireUserId();
  if (!(await userCanAccessProject(userId, projectId))) return;
  const clean = cleanProps(props);

  if (name === "draft_preview_shown") {
    // Time-to-first-draft-preview: record once per project, measured from project creation and
    // from the first finished upload.
    const [seen] = await db.select({ id: schema.analyticsEvents.id }).from(schema.analyticsEvents)
      .where(and(eq(schema.analyticsEvents.name, "draft_preview_shown"), eq(schema.analyticsEvents.projectId, projectId))).limit(1);
    if (seen) return;
    const [proj] = await db.select({ createdAt: schema.projects.createdAt }).from(schema.projects).where(eq(schema.projects.id, projectId));
    const [firstUpload] = await db.select({ at: schema.analyticsEvents.createdAt }).from(schema.analyticsEvents)
      .where(and(eq(schema.analyticsEvents.name, "upload_completed"), eq(schema.analyticsEvents.projectId, projectId)))
      .orderBy(schema.analyticsEvents.createdAt).limit(1);
    const now = Date.now();
    if (proj) clean.secondsSinceProjectCreated = Math.round((now - proj.createdAt.getTime()) / 1000);
    if (firstUpload) clean.secondsSinceFirstUpload = Math.round((now - firstUpload.at.getTime()) / 1000);
  }
  await track(name, { userId, projectId, props: clean });
}
