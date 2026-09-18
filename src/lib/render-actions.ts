"use server";
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";

/** Queue an HD render for a project (owner-checked). A worker picks it up. */
export async function createRender(projectId: string): Promise<string> {
  const userId = await requireUserId();

  const [proj] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!proj) throw new Error("Project not found");

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.assets)
    .where(and(eq(schema.assets.projectId, projectId), eq(schema.assets.uploadState, "uploaded")));
  if (!count) throw new Error("Add at least one clip before rendering");

  const { getEffectiveTier } = await import("./tier");
  const watermark = (await getEffectiveTier(userId)) === "free";

  const [{ maxv }] = await db
    .select({ maxv: sql<number>`coalesce(max(version),0)::int` })
    .from(schema.renders)
    .where(eq(schema.renders.projectId, projectId));

  const id = randomUUID();
  await db.insert(schema.renders).values({
    id,
    projectId,
    version: (maxv ?? 0) + 1,
    aspect: proj.aspect,
    status: "queued",
    watermark,
  });
  await db
    .update(schema.projects)
    .set({ status: "rendering", updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));

  revalidatePath(`/projects/${projectId}/edit`);
  revalidatePath(`/projects`);
  return id;
}
