import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// ClipWaltz Music Provider Layer.
// The app/DB/UI never depend on one music company: every source implements MusicProvider
// and is normalized to ProviderTrack. Today only the included (DB-backed) catalog is
// implemented; premium adapters (Epidemic, Soundstripe, Artlist), user uploads and AI music
// are interface-ready and light up when their API + key are configured — no editor changes.

export type ProviderTrack = {
  id: string; // ClipWaltz track id (music_tracks.id)
  title: string;
  artist: string | null;
  mood: string | null;
  bpm: number | null;
  provider: string; // pixabay | epidemic | soundstripe | artlist | upload | ai
  premium: boolean;
  providerTrackId: string | null;
};

export interface MusicProvider {
  readonly id: string;
  readonly label: string; // user-facing source label ("Included", "Epidemic Sound", …)
  readonly premium: boolean;
  configured(): boolean; // usable right now (creds present / catalog seeded)
  listTracks(): Promise<ProviderTrack[]>;
}

/** Included catalog backed by our own MinIO + music_tracks (currently the Pixabay set). */
class DbProvider implements MusicProvider {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly premium: boolean,
  ) {}
  configured() {
    return true;
  }
  async listTracks(): Promise<ProviderTrack[]> {
    const rows = await db
      .select()
      .from(schema.musicTracks)
      .where(and(eq(schema.musicTracks.active, true), eq(schema.musicTracks.provider, this.id)))
      .orderBy(asc(schema.musicTracks.title));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      mood: r.mood,
      bpm: r.bpm,
      provider: r.provider,
      premium: r.premium,
      providerTrackId: r.providerTrackId,
    }));
  }
}

/**
 * External partner adapter (Epidemic / Soundstripe / Artlist). Interface-ready: when the
 * partner API + key are configured, implement listTracks() to fetch + normalize their
 * catalog (and ingest/stream) here — nothing else in ClipWaltz changes.
 */
class PartnerProvider implements MusicProvider {
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly envKey: string,
    readonly premium = true,
  ) {}
  configured() {
    return !!process.env[this.envKey];
  }
  async listTracks(): Promise<ProviderTrack[]> {
    // TODO: implement against the partner API once ${this.envKey} is set (owner-provided).
    return [];
  }
}

// The provider registry. Order defines catalog precedence in aggregated listings.
export const PROVIDERS: MusicProvider[] = [
  new DbProvider("pixabay", "Included", false),
  new PartnerProvider("epidemic", "Epidemic Sound", "EPIDEMIC_API_KEY"),
  new PartnerProvider("soundstripe", "Soundstripe", "SOUNDSTRIPE_API_KEY"),
  new PartnerProvider("artlist", "Artlist", "ARTLIST_API_KEY"),
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

/** Human label for a provider id (falls back to the id). */
export function providerLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

/** Tracks from every configured provider, aggregated + normalized. */
export async function getAllProviderTracks(): Promise<ProviderTrack[]> {
  const lists = await Promise.all(
    PROVIDERS.filter((p) => p.configured()).map((p) => p.listTracks().catch(() => [] as ProviderTrack[])),
  );
  return lists.flat();
}
