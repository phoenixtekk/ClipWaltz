import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";

export type RenderStatus = {
  id: string;
  status: string; // queued | rendering | done | failed
  version: number;
  hasOutput: boolean;
  visibility: string; // private | unlisted | public
} | null;

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
  };
}
