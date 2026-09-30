"use server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { deleteObject } from "./storage";
import { toResult } from "./action-result";

/** Delete a user's own uploaded MP3 (row + MinIO object). Any project using it falls back to
 *  the default track on the next render. Owner-checked; catalog tracks can't be deleted. */
async function deleteMusicTrackImpl(trackId: string): Promise<void> {
  const userId = await requireUserId();
  const [row] = await db
    .select({ ownerId: schema.musicTracks.ownerId, key: schema.musicTracks.storageKey })
    .from(schema.musicTracks)
    .where(eq(schema.musicTracks.id, trackId));
  if (!row || row.ownerId !== userId) throw new Error("Track not found");
  // Drop it from every project still pointing at it (incl. shared-workspace projects it scored).
  await db
    .update(schema.projects)
    .set({ musicTrackId: null })
    .where(eq(schema.projects.musicTrackId, trackId));
  await db.delete(schema.musicTracks).where(eq(schema.musicTracks.id, trackId));
  if (row.key) await deleteObject(row.key).catch(() => {});
  revalidatePath("/projects", "layout");
}

/** Favourite / unfavourite a track. Returns the new favourited state. */
async function toggleFavoriteImpl(trackId: string): Promise<boolean> {
  const userId = await requireUserId();
  const [existing] = await db
    .select({ id: schema.musicFavorites.id })
    .from(schema.musicFavorites)
    .where(and(eq(schema.musicFavorites.userId, userId), eq(schema.musicFavorites.trackId, trackId)));
  if (existing) {
    await db.delete(schema.musicFavorites).where(eq(schema.musicFavorites.id, existing.id));
    return false;
  }
  await db
    .insert(schema.musicFavorites)
    .values({ id: randomUUID(), userId, trackId })
    .onConflictDoNothing();
  return true;
}

// Exported actions return ActionResult (action-result.ts — thrown messages are hidden in production builds).
// Client: unwrap(await action(...)).
export async function deleteMusicTrack(...args: Parameters<typeof deleteMusicTrackImpl>) { return toResult(() => deleteMusicTrackImpl(...args)); }
export async function toggleFavorite(...args: Parameters<typeof toggleFavoriteImpl>) { return toResult(() => toggleFavoriteImpl(...args)); }
