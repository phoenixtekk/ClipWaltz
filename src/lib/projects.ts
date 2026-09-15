import { desc, eq } from "drizzle-orm";
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
