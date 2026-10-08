"use server";
import { randomUUID } from "crypto";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { userCanAccessProject } from "./workspace";
import { requireUserId } from "./auth";
import { toResult } from "./action-result";

const VISIBILITY = new Set(["private", "unlisted", "public"]);

/** Set a render's share visibility (owner-checked). Returns the applied value. */
async function shareRenderImpl(renderId: string, visibility: string): Promise<string> {
  const userId = await requireUserId();
  const [row] = await db
    .select({ ownerId: schema.projects.ownerId, projectId: schema.renders.projectId })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .where(eq(schema.renders.id, renderId));
  // The creator shares (credit is theirs), and only while still an editor+ in the workspace.
  if (!row || row.ownerId !== userId || !(await userCanAccessProject(userId, row.projectId, "editor"))) {
    throw new Error("Render not found");
  }
  const v = VISIBILITY.has(visibility) ? visibility : "private";
  await db
    .update(schema.renders)
    .set({ visibility: v, sharedAt: v === "private" ? null : new Date() })
    .where(eq(schema.renders.id, renderId));
  revalidatePath("/community");
  return v;
}

/**
 * Video properties → "Show on the Community page": the project's latest finished video (campaign variants excluded)
 * and whether it's public. `canShare` = the caller created the project and can still edit it (shareRender's rule).
 */
async function communityShareStateImpl(projectId: string): Promise<{
  renderId: string | null; version: number | null; visibility: string | null; canShare: boolean;
}> {
  const userId = await requireUserId();
  const [p] = await db.select({ ownerId: schema.projects.ownerId }).from(schema.projects).where(eq(schema.projects.id, String(projectId)));
  if (!p || !(await userCanAccessProject(userId, String(projectId), "viewer"))) throw new Error("Project not found");
  const [r] = await db
    .select({ id: schema.renders.id, version: schema.renders.version, visibility: schema.renders.visibility })
    .from(schema.renders)
    .where(and(eq(schema.renders.projectId, String(projectId)), eq(schema.renders.status, "done"),
      isNotNull(schema.renders.outputKey), isNull(schema.renders.campaignId)))
    .orderBy(desc(schema.renders.version))
    .limit(1);
  const canShare = p.ownerId === userId && (await userCanAccessProject(userId, String(projectId), "editor"));
  return { renderId: r?.id ?? null, version: r?.version ?? null, visibility: r?.visibility ?? null, canShare };
}

/** Like / unlike a shared render (auth). Returns the new liked state. */
async function toggleLikeImpl(renderId: string): Promise<boolean> {
  const userId = await requireUserId();
  const [existing] = await db
    .select({ id: schema.renderLikes.id })
    .from(schema.renderLikes)
    .where(and(eq(schema.renderLikes.renderId, renderId), eq(schema.renderLikes.userId, userId)));
  if (existing) {
    await db.delete(schema.renderLikes).where(eq(schema.renderLikes.id, existing.id));
    return false;
  }
  await db.insert(schema.renderLikes).values({ id: randomUUID(), renderId, userId });
  revalidatePath("/community");
  return true;
}

// Exported actions return ActionResult (action-result.ts — thrown messages are hidden in production builds).
// Client: unwrap(await action(...)).
export async function shareRender(...args: Parameters<typeof shareRenderImpl>) { return toResult(() => shareRenderImpl(...args)); }
export async function communityShareState(...args: Parameters<typeof communityShareStateImpl>) { return toResult(() => communityShareStateImpl(...args)); }
export async function toggleLike(...args: Parameters<typeof toggleLikeImpl>) { return toResult(() => toggleLikeImpl(...args)); }
