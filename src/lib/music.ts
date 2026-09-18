import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAllProviderTracks } from "./music-providers";

export type Track = {
  id: string;
  title: string;
  artist: string | null;
  mood: string | null;
  bpm: number | null;
  provider: string;
  premium: boolean;
};

/** Active tracks for the picker, sourced through the Music Provider Layer. */
export async function getMusicTracks(): Promise<Track[]> {
  const rows = await getAllProviderTracks();
  return rows
    .map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      mood: r.mood,
      bpm: r.bpm,
      provider: r.provider,
      premium: r.premium,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The set of track ids this user has favourited (empty for signed-out). */
export async function getFavoriteTrackIds(userId: string | null): Promise<Set<string>> {
  if (!userId) return new Set();
  const rows = await db
    .select({ trackId: schema.musicFavorites.trackId })
    .from(schema.musicFavorites)
    .where(eq(schema.musicFavorites.userId, userId));
  return new Set(rows.map((r) => r.trackId));
}
