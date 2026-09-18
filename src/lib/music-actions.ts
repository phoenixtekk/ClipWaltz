"use server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";

/** Favourite / unfavourite a track. Returns the new favourited state. */
export async function toggleFavorite(trackId: string): Promise<boolean> {
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
