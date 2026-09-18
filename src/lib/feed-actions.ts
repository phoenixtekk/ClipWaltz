"use server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";

const VISIBILITY = new Set(["private", "unlisted", "public"]);

/** Set a render's share visibility (owner-checked). Returns the applied value. */
export async function shareRender(renderId: string, visibility: string): Promise<string> {
  const userId = await requireUserId();
  const [row] = await db
    .select({ ownerId: schema.projects.ownerId })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .where(eq(schema.renders.id, renderId));
  if (!row || row.ownerId !== userId) throw new Error("Render not found");
  const v = VISIBILITY.has(visibility) ? visibility : "private";
  await db
    .update(schema.renders)
    .set({ visibility: v, sharedAt: v === "private" ? null : new Date() })
    .where(eq(schema.renders.id, renderId));
  revalidatePath("/community");
  return v;
}

/** Like / unlike a shared render (auth). Returns the new liked state. */
export async function toggleLike(renderId: string): Promise<boolean> {
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
