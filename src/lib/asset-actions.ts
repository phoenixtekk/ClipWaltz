"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { deleteObject } from "./storage";

/** Delete an asset (its DB row + the MinIO object), owner-checked via its project. */
export async function deleteAsset(projectId: string, assetId: string): Promise<void> {
  const userId = await requireUserId();
  const [row] = await db
    .select({ storageKey: schema.assets.storageKey, ownerId: schema.projects.ownerId })
    .from(schema.assets)
    .innerJoin(schema.projects, eq(schema.assets.projectId, schema.projects.id))
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)));
  if (!row || row.ownerId !== userId) throw new Error("Asset not found");

  await deleteObject(row.storageKey).catch(() => {
    // best-effort object delete; the row is the source of truth for the UI
  });
  await db.delete(schema.assets).where(eq(schema.assets.id, assetId));
  revalidatePath(`/projects/${projectId}/import`);
}
