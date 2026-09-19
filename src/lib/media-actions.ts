"use server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { deleteObject } from "./storage";

async function ownedMedia(userId: string, mediaId: string) {
  const [m] = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, mediaId), eq(schema.media.ownerId, userId)));
  return m ?? null;
}

/** Reuse a library file in a project: creates a placement (asset) referencing the media. */
export async function addMediaToProject(mediaId: string, projectId: string): Promise<void> {
  const userId = await requireUserId();
  const m = await ownedMedia(userId, mediaId);
  if (!m) throw new Error("File not found");
  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!proj) throw new Error("Project not found");

  const existing = await db
    .select({ orderIndex: schema.assets.orderIndex })
    .from(schema.assets)
    .where(eq(schema.assets.projectId, projectId));
  const nextIdx = existing.reduce((n, a) => Math.max(n, a.orderIndex + 1), 0);

  await db.insert(schema.assets).values({
    id: randomUUID(),
    projectId,
    mediaId: m.id,
    storageKey: m.storageKey,
    convertedKey: m.convertedKey,
    kind: m.kind,
    originalName: m.originalName,
    sourceFormat: m.sourceFormat,
    conversionState: m.conversionState,
    uploadState: "uploaded",
    orderIndex: nextIdx,
  });
  await db.update(schema.media).set({ lastUsedAt: new Date() }).where(eq(schema.media.id, m.id));
  revalidatePath(`/projects/${projectId}/edit`);
  revalidatePath("/library");
}

/** Rename a library file (updates the library + any project placements). */
export async function renameMedia(mediaId: string, name: string): Promise<void> {
  const userId = await requireUserId();
  const m = await ownedMedia(userId, mediaId);
  if (!m) throw new Error("File not found");
  const clean = name.trim().slice(0, 200) || "file";
  await db.update(schema.media).set({ originalName: clean }).where(eq(schema.media.id, m.id));
  await db.update(schema.assets).set({ originalName: clean }).where(eq(schema.assets.mediaId, m.id));
  revalidatePath("/library");
}

const REFRAME_MODES = new Set(["flat", "follow", "tiny"]);

/** Change the 360 reframe mode of a file and re-convert it (worker picks it up). */
export async function setReframeMode(mediaId: string, mode: string): Promise<void> {
  const userId = await requireUserId();
  const m = await ownedMedia(userId, mediaId);
  if (!m) throw new Error("File not found");
  if (!m.sourceFormat) throw new Error("Not a 360 file");
  if (!REFRAME_MODES.has(mode)) throw new Error("Unknown mode");
  if (m.reframeMode === mode) return;
  await db
    .update(schema.media)
    .set({ reframeMode: mode, conversionState: "pending" })
    .where(eq(schema.media.id, m.id));
  // Exclude its placements from renders until the re-conversion completes.
  await db.update(schema.assets).set({ conversionState: "pending" }).where(eq(schema.assets.mediaId, m.id));
  revalidatePath("/library");
}

/** Delete a library file: removes the object(s) and every project placement (cascade). */
export async function deleteMedia(mediaId: string): Promise<void> {
  const userId = await requireUserId();
  const m = await ownedMedia(userId, mediaId);
  if (!m) throw new Error("File not found");
  await deleteObject(m.storageKey).catch(() => {});
  if (m.convertedKey) await deleteObject(m.convertedKey).catch(() => {});
  await db.delete(schema.media).where(eq(schema.media.id, m.id)); // cascade removes assets
  revalidatePath("/library");
}
