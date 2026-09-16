import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type Track = { id: string; title: string; mood: string | null; bpm: number | null };

/** Active licensed tracks for the picker. */
export async function getMusicTracks(): Promise<Track[]> {
  const rows = await db
    .select()
    .from(schema.musicTracks)
    .where(eq(schema.musicTracks.active, true))
    .orderBy(asc(schema.musicTracks.title));
  return rows.map((r) => ({ id: r.id, title: r.title, mood: r.mood, bpm: r.bpm }));
}
