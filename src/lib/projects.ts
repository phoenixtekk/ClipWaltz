import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { parseOverlays, type Overlay } from "./overlays";

export type ProjectStatus = "draft" | "rendering" | "ready" | "failed";

export type ProjectSummary = {
  id: string;
  title: string;
  status: ProjectStatus;
  aspect: string;
  clips?: number; // uploaded asset count (populated by listProjects)
  updatedAt: string; // ISO — serializable across the RSC boundary
};

export type ProjectDetail = ProjectSummary & {
  template: string;
  lengthSec: number;
  musicTrackId: string | null;
  titleText: string | null;
  styleFilter: string;
  lightFx: string;
  transition: string;
  motion: boolean;
  fades: boolean;
  fadeOut: boolean;
  smartCut: boolean;
  beatSync: boolean;
  waltzToMusic: boolean;
  overlays: Overlay[];
};

/** A single project owned by the current user, or null. */
export async function getProject(id: string): Promise<ProjectDetail | null> {
  const userId = await requireUserId();
  const [r] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.ownerId, userId)));
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    status: r.status as ProjectStatus,
    aspect: r.aspect,
    template: r.template,
    lengthSec: r.lengthSec,
    musicTrackId: r.musicTrackId,
    titleText: r.titleText,
    styleFilter: r.styleFilter,
    lightFx: r.lightFx,
    transition: r.transition,
    motion: r.motion,
    fades: r.fades,
    fadeOut: r.fadeOut,
    smartCut: r.smartCut,
    beatSync: r.beatSync,
    waltzToMusic: r.waltzToMusic,
    overlays: parseOverlays(r.overlays),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Projects owned by the current user, newest first. Server-only (uses headers + db). */
export async function listProjects(): Promise<ProjectSummary[]> {
  const userId = await requireUserId();
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, userId))
    .orderBy(desc(schema.projects.updatedAt));

  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await db
        .select({ pid: schema.assets.projectId, n: sql<number>`count(*)::int` })
        .from(schema.assets)
        .where(and(inArray(schema.assets.projectId, ids), eq(schema.assets.uploadState, "uploaded")))
        .groupBy(schema.assets.projectId)
    : [];
  const clipMap = new Map(counts.map((c) => [c.pid, c.n]));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status as ProjectStatus,
    aspect: r.aspect,
    clips: clipMap.get(r.id) ?? 0,
    updatedAt: r.updatedAt.toISOString(),
  }));
}
