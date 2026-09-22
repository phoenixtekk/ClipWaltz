import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";

export type RenderStatus = {
  id: string;
  status: string; // queued | rendering | done | failed
  version: number;
  hasOutput: boolean;
  visibility: string; // private | unlisted | public
  description: string | null; // AI YouTube description (when enabled)
} | null;

// Snapshot of the effective Format + Style settings a render used — stored on the render row so
// we can show "what changed since last render" and keep an audit of each output.
export type RenderSettings = {
  aspect: string;
  lengthSec: number;
  maxFootage: boolean;
  styleFilter: string;
  lightFx: string;
  transition: string;
  motion: boolean;
  fades: boolean;
  fadeOut: boolean;
  smartCut: boolean;
  beatSync: boolean;
  waltzToMusic: boolean;
  loopToFill: boolean;
  titleText: string | null;
  musicTrackId: string | null;
  clips: number;
};

export type CheckLevel = "red" | "yellow" | "info";
export type CheckWarning = { level: CheckLevel; text: string };

// Everything the render confirmation checkpoint shows the user before spending a render.
export type RenderCheckpoint = {
  clips: number;
  musicTitle: string | null;
  lengthLabel: string; // "Max footage" or "30s"
  projectedSec: number; // estimated output length
  aspect: string;
  summary: { label: string; value: string }[];
  warnings: CheckWarning[];
  changes: string[]; // human-readable diffs vs the previous render
  hasBlocking: boolean; // a 🔴 issue is present
};

export type RenderHistoryItem = {
  id: string;
  version: number;
  aspect: string;
  visibility: string;
  createdAt: string; // ISO
  hasOutput: boolean;
};

/** All finished renders for a project the user owns, newest first (for the download history). */
export async function listRenders(projectId: string): Promise<RenderHistoryItem[]> {
  const userId = await requireUserId();
  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!proj) return [];
  const rows = await db
    .select()
    .from(schema.renders)
    .where(and(eq(schema.renders.projectId, projectId), eq(schema.renders.status, "done")))
    .orderBy(desc(schema.renders.version));
  return rows
    .filter((r) => !!r.outputKey)
    .map((r) => ({
      id: r.id,
      version: r.version,
      aspect: r.aspect,
      visibility: r.visibility,
      createdAt: (r.completedAt ?? r.createdAt).toISOString(),
      hasOutput: true,
    }));
}

/** Latest render for a project the current user owns. */
export async function getLatestRender(projectId: string): Promise<RenderStatus> {
  const userId = await requireUserId();
  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!proj) return null;

  const [r] = await db
    .select()
    .from(schema.renders)
    .where(eq(schema.renders.projectId, projectId))
    .orderBy(desc(schema.renders.version))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    version: r.version,
    hasOutput: !!r.outputKey,
    visibility: r.visibility,
    description: r.description ?? null,
  };
}
