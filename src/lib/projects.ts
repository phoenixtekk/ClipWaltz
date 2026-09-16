import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";

export type ProjectStatus = "draft" | "rendering" | "ready" | "failed";

export type ProjectSummary = {
  id: string;
  title: string;
  status: ProjectStatus;
  aspect: string;
  updatedAt: string; // ISO — serializable across the RSC boundary
};

export type ProjectDetail = ProjectSummary & {
  template: string;
  lengthSec: number;
  musicTrackId: string | null;
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

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status as ProjectStatus,
    aspect: r.aspect,
    updatedAt: r.updatedAt.toISOString(),
  }));
}
