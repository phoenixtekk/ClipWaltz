"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { userCanAccessProject } from "./workspace";
import { requireUserId } from "./auth";
import { sanitizeOverlays, type Overlay } from "./overlays";
import { toResult } from "./action-result";

/** Replace a project's overlays (owner-checked, validated). */
async function setProjectOverlaysImpl(projectId: string, overlays: Overlay[]): Promise<void> {
  const userId = await requireUserId();
  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!proj || !(await userCanAccessProject(userId, projectId, "editor"))) throw new Error("Project not found");
  const clean = sanitizeOverlays(overlays);
  await db
    .update(schema.projects)
    .set({ overlays: clean.length ? clean : null, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  revalidatePath(`/projects/${projectId}/edit`);
}

// Exported actions return ActionResult (action-result.ts — thrown messages are hidden in production builds).
// Client: unwrap(await action(...)).
export async function setProjectOverlays(...args: Parameters<typeof setProjectOverlaysImpl>) { return toResult(() => setProjectOverlaysImpl(...args)); }
