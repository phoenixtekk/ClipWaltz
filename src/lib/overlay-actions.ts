"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { sanitizeOverlays, type Overlay } from "./overlays";

/** Replace a project's overlays (owner-checked, validated). */
export async function setProjectOverlays(projectId: string, overlays: Overlay[]): Promise<void> {
  const userId = await requireUserId();
  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!proj) throw new Error("Project not found");
  const clean = sanitizeOverlays(overlays);
  await db
    .update(schema.projects)
    .set({ overlays: clean.length ? clean : null, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  revalidatePath(`/projects/${projectId}/edit`);
}
