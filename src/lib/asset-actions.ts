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
  revalidatePath(`/projects/${projectId}/edit`);
}

/**
 * Set the full clip order for a project (timeline drag-reorder + insert). Owner-checked;
 * only assets that belong to the project are (re)numbered, any omitted keep a stable tail.
 */
export async function reorderAssets(projectId: string, orderedIds: string[]): Promise<void> {
  const userId = await requireUserId();
  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!proj) throw new Error("Project not found");

  const rows = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(eq(schema.assets.projectId, projectId));
  const valid = new Set(rows.map((r) => r.id));
  const seen = new Set<string>();
  const order = orderedIds.filter((id) => valid.has(id) && !seen.has(id) && seen.add(id));
  // append any project assets the client didn't mention (keeps them at the end)
  for (const r of rows) if (!seen.has(r.id)) order.push(r.id);

  for (let i = 0; i < order.length; i++) {
    await db.update(schema.assets).set({ orderIndex: i }).where(eq(schema.assets.id, order[i]));
  }
  revalidatePath(`/projects/${projectId}/edit`);
}
