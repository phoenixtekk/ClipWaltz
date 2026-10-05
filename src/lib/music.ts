import { and, asc, eq, isNull } from "drizzle-orm";
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
  mine?: boolean; // true = this user's uploaded MP3 (shown in the Upload tab, deletable)
};

/**
 * Tracks for the picker: the shared catalog (via the Music Provider Layer) plus, when a userId is
 * given, that user's own uploaded MP3s (marked `mine`). Uploads are never shown to other users.
 */
export async function getMusicTracks(userId?: string | null): Promise<Track[]> {
  const rows = await getAllProviderTracks();
  const catalog: Track[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    mood: r.mood,
    bpm: r.bpm,
    provider: r.provider,
    premium: r.premium,
  }));

  let uploads: Track[] = [];
  if (userId) {
    const up = await db
      .select()
      .from(schema.musicTracks)
      .where(and(eq(schema.musicTracks.ownerId, userId), eq(schema.musicTracks.active, true)));
    uploads = up.map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      mood: r.mood,
      bpm: r.bpm,
      provider: r.provider,
      premium: r.premium,
      mine: true,
    }));
  }
  return [...uploads, ...catalog.filter((c) => !uploads.some((u) => u.id === c.id))].sort((a, b) =>
    a.title.localeCompare(b.title),
  );
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

/** The catalogue beds new WaltzDeck ads / presentations start with (owner request 2026-09-30: gentle, not music-video music). */
const DECK_DEFAULT_TRACK: Record<string, string> = { ad: "t-music-promotion", presentation: "t-presentation-clean", explainer: "t-music-promotion" };

/**
 * Default soundtrack for a new WaltzDeck project: the mode's gentle bed if it's active, else any active catalogue track
 * with mood "gentle"; null for slideshows (or when there are none) — the user picks, as before.
 */
export async function defaultDeckTrackId(mode: string): Promise<string | null> {
  const preferred = DECK_DEFAULT_TRACK[mode];
  if (!preferred) return null;
  const catalogue = and(eq(schema.musicTracks.active, true), isNull(schema.musicTracks.ownerId));
  const [hit] = await db.select({ id: schema.musicTracks.id }).from(schema.musicTracks)
    .where(and(catalogue, eq(schema.musicTracks.id, preferred)));
  if (hit) return hit.id;
  const [gentle] = await db.select({ id: schema.musicTracks.id }).from(schema.musicTracks)
    .where(and(catalogue, eq(schema.musicTracks.mood, "gentle"))).orderBy(asc(schema.musicTracks.title)).limit(1);
  return gentle?.id ?? null;
}