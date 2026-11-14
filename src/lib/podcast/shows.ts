import { randomUUID } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { writeMedia } from "@/lib/social/media";
import { addConnection, updateConnectionById } from "@/lib/social/connections";
import { APPLE_CATEGORIES } from "./categories";
import { slugify } from "./feed";
import { siteOrigin } from "./serve";

// Podcast shows of a workspace (P5, decision D4). Ported from SP's /api/podcast/connect: creating a show also creates
// (or updates) its `social_connections` row (provider 'podcast', externalId = show id), which is what makes the show a
// destination in the composer, Auto Post and Explainers. No `server-only`: the request paths that call this already
// passed requireSocial (src/lib/social/access.ts).

export interface ShowInput {
  id?: string;
  title: string;
  description: string;
  author?: string;
  category?: string;
  subcategory?: string;
  language?: string;
  explicit?: boolean;
  link?: string;
  copyright?: string;
  slug?: string;
}

export type ShowResult = { ok: true; id: string; slug: string; feedUrl: string } | { ok: false; error: string };

/** Validate what Apple would reject the feed for, before the owner submits it and waits days for the verdict. */
export function validateShow(b: ShowInput): { error: string } | { value: Required<Omit<ShowInput, "id">> & { subcategory: string } } {
  const title = (b.title ?? "").trim().slice(0, 255);
  const description = (b.description ?? "").trim();
  const category = (b.category ?? "Technology").trim();
  const subcategory = (b.subcategory ?? "").trim();
  const language = ((b.language ?? "en-us").trim() || "en-us").toLowerCase();
  if (!title) return { error: "A show title is required." };
  if (!description) return { error: "A show description is required — Apple will not list a feed without one." };
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(language)) return { error: "Language must be a code like en-us." };
  // Apple only recognises its own category vocabulary, case-sensitively.
  const known = APPLE_CATEGORIES[category];
  if (!known) return { error: `“${category}” is not an Apple Podcasts category.` };
  if (subcategory && !known.includes(subcategory)) return { error: `“${subcategory}” is not a subcategory of ${category}.` };
  const slug = slugify(b.slug?.trim() || title);
  if (!slug) return { error: "That title produces an empty web address. Add a slug using letters or numbers." };
  const link = (b.link ?? "").trim();
  if (link && !/^https?:\/\//i.test(link)) return { error: "The website link must start with http:// or https://." };
  return {
    value: {
      title, description, category, subcategory, language, slug, link,
      author: (b.author ?? "").trim().slice(0, 255),
      copyright: (b.copyright ?? "").trim().slice(0, 255),
      explicit: Boolean(b.explicit),
    },
  };
}

/** Create or update a show (and its destination row). Generates a cover when the show has none. */
export async function saveShow(workspaceId: string, userId: string, b: ShowInput): Promise<ShowResult> {
  const v = validateShow(b);
  if ("error" in v) return { ok: false, error: v.error };
  const s = v.value;

  const existing = b.id
    ? (await db.select().from(schema.podcastShows).where(and(eq(schema.podcastShows.id, b.id), eq(schema.podcastShows.workspaceId, workspaceId))).limit(1))[0]
    : undefined;
  if (b.id && !existing) return { ok: false, error: "Show not found." };

  const [clash] = await db.select({ id: schema.podcastShows.id }).from(schema.podcastShows).where(eq(schema.podcastShows.slug, s.slug)).limit(1);
  if (clash && clash.id !== existing?.id) return { ok: false, error: `The address /p/${s.slug} is already taken. Choose a different slug.` };
  // A live feed's address must not move: subscribers follow the URL. (Moving it is a 301 + new-feed-url job.)
  if (existing && existing.slug !== s.slug) {
    const [ep] = await db.select({ id: schema.podcastEpisodes.id }).from(schema.podcastEpisodes).where(eq(schema.podcastEpisodes.showId, existing.id)).limit(1);
    if (ep) return { ok: false, error: "This show already has episodes, so its web address can't change — subscribers would lose it." };
  }

  const values = {
    slug: s.slug,
    title: s.title,
    description: s.description,
    author: s.author || null,
    language: s.language,
    category: s.category,
    subcategory: s.subcategory || null,
    explicit: s.explicit,
    link: s.link || null,
    copyright: s.copyright || null,
    updatedAt: new Date(),
  };

  const showId = existing?.id ?? randomUUID();
  if (existing) {
    await db.update(schema.podcastShows).set(values).where(eq(schema.podcastShows.id, showId));
  } else {
    await db.insert(schema.podcastShows).values({ id: showId, workspaceId, createdBy: userId, ...values });
  }

  // Cover art: generated so a show is publishable immediately; the owner can upload their own.
  if (!existing?.coverMediaId) await generateCover(workspaceId, userId, showId, s.title, s.author || undefined);

  // The destination row. Nothing secret: the "credential" is which show this destination writes to.
  const [conn] = await db
    .select({ id: schema.socialConnections.id })
    .from(schema.socialConnections)
    .where(and(eq(schema.socialConnections.workspaceId, workspaceId), eq(schema.socialConnections.provider, "podcast"), eq(schema.socialConnections.externalId, showId)))
    .limit(1);
  const data = { accessToken: JSON.stringify({ showId, slug: s.slug }), externalId: showId, label: s.title, displayName: s.title };
  if (conn) await updateConnectionById(conn.id, data, workspaceId);
  else await addConnection("podcast", data, workspaceId, userId);

  return { ok: true, id: showId, slug: s.slug, feedUrl: `${siteOrigin()}/p/${s.slug}/rss.xml` };
}

async function generateCover(workspaceId: string, userId: string, showId: string, title: string, author?: string) {
  const { renderCover, COVER_MIME } = await import("./cover");
  const cover = renderCover({ title, subtitle: author });
  await storeCover(workspaceId, userId, showId, new Uint8Array(cover), COVER_MIME, "cover.jpg");
}

async function storeCover(workspaceId: string, userId: string, showId: string, bytes: Uint8Array, mime: string, filename: string) {
  const id = randomUUID();
  const storageKey = await writeMedia(workspaceId, id, bytes, mime);
  await db.insert(schema.socialMedia).values({
    id, workspaceId, createdBy: userId, kind: "image", filename, mime, size: bytes.byteLength, storageKey, source: "upload",
  });
  await db
    .update(schema.podcastShows)
    .set({ coverMediaId: id, updatedAt: new Date() })
    .where(and(eq(schema.podcastShows.id, showId), eq(schema.podcastShows.workspaceId, workspaceId)));
}

/**
 * Replace the cover with an uploaded JPEG. Apple: square, 1400–3000 px, and the file extension must match the type —
 * the cover URL is `/cover.jpg`, so only JPEG is accepted.
 */
export async function uploadCover(workspaceId: string, userId: string, showId: string, bytes: Uint8Array): Promise<{ ok: true } | { ok: false; error: string }> {
  const [show] = await db.select({ id: schema.podcastShows.id }).from(schema.podcastShows).where(and(eq(schema.podcastShows.id, showId), eq(schema.podcastShows.workspaceId, workspaceId))).limit(1);
  if (!show) return { ok: false, error: "Show not found." };
  if (bytes.byteLength > 10 * 1024 * 1024) return { ok: false, error: "Cover art must be under 10 MB." };
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return { ok: false, error: "Cover art must be a JPEG (.jpg)." };
  const { loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(Buffer.from(bytes)).catch(() => null);
  if (!img) return { ok: false, error: "That file couldn't be read as an image." };
  if (img.width !== img.height || img.width < 1400 || img.width > 3000) {
    return { ok: false, error: `Apple needs square artwork between 1400 and 3000 px (this one is ${img.width}×${img.height}).` };
  }
  await storeCover(workspaceId, userId, showId, bytes, "image/jpeg", "cover.jpg");
  return { ok: true };
}

export async function setShowActive(workspaceId: string, showId: string, active: boolean): Promise<boolean> {
  const r = await db
    .update(schema.podcastShows)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(schema.podcastShows.id, showId), eq(schema.podcastShows.workspaceId, workspaceId)))
    .returning({ id: schema.podcastShows.id });
  return r.length > 0;
}

/** Remove one episode from the feed (its audio stays in the media library). */
export async function deleteEpisode(workspaceId: string, episodeId: string): Promise<boolean> {
  const own = db.select({ id: schema.podcastShows.id }).from(schema.podcastShows).where(eq(schema.podcastShows.workspaceId, workspaceId));
  const r = await db
    .delete(schema.podcastEpisodes)
    .where(and(eq(schema.podcastEpisodes.id, episodeId), inArray(schema.podcastEpisodes.showId, own)))
    .returning({ id: schema.podcastEpisodes.id });
  return r.length > 0;
}

export interface ShowSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string | null;
  category: string;
  subcategory: string | null;
  language: string;
  explicit: boolean;
  link: string | null;
  copyright: string | null;
  active: boolean;
  feedUrl: string;
  coverUrl: string | null;
  episodes: { id: string; guid: string; title: string; publishedAt: string; durationSec: number; downloads: number }[];
}

/** A workspace's shows with their episodes and counted downloads (for the studio page). */
export async function listShowsWithEpisodes(workspaceId: string): Promise<ShowSummary[]> {
  const shows = await db.select().from(schema.podcastShows).where(eq(schema.podcastShows.workspaceId, workspaceId)).orderBy(desc(schema.podcastShows.createdAt));
  if (!shows.length) return [];
  const eps = await db
    .select({
      id: schema.podcastEpisodes.id,
      showId: schema.podcastEpisodes.showId,
      guid: schema.podcastEpisodes.guid,
      title: schema.podcastEpisodes.title,
      publishedAt: schema.podcastEpisodes.publishedAt,
      durationSec: schema.podcastEpisodes.durationSec,
      downloads: sql<number>`(select count(*)::int from podcast_listens l where l.episode_id = ${schema.podcastEpisodes.id} and l.counted)`,
    })
    .from(schema.podcastEpisodes)
    .where(inArray(schema.podcastEpisodes.showId, shows.map((s) => s.id)))
    .orderBy(desc(schema.podcastEpisodes.publishedAt));
  const origin = siteOrigin();
  return shows.map((s) => ({
    id: s.id,
    slug: s.slug,
    title: s.title,
    description: s.description,
    author: s.author,
    category: s.category,
    subcategory: s.subcategory,
    language: s.language,
    explicit: s.explicit,
    link: s.link,
    copyright: s.copyright,
    active: s.active,
    feedUrl: `${origin}/p/${s.slug}/rss.xml`,
    coverUrl: s.coverMediaId ? `/p/${s.slug}/cover.jpg?v=${s.updatedAt.getTime()}` : null,
    episodes: eps
      .filter((e) => e.showId === s.id)
      .map((e) => ({ id: e.id, guid: e.guid, title: e.title, publishedAt: e.publishedAt.toISOString(), durationSec: e.durationSec, downloads: Number(e.downloads) })),
  }));
}
