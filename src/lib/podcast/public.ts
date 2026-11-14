import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { buildFeed, type FeedEpisode } from "./feed";
import { siteOrigin, serveStored } from "./serve";
import { fromPublicId, publicId } from "./ids";
import { clientIp, oneMinuteBytes, recordDelivery } from "./analytics";

// The anonymous podcast URLs (plan §5, decision D4): /p/<slug>/rss.xml, /p/<slug>/cover.jpg,
// /p/<slug>/audio/<id>.mp3, /p/<slug>/episode/<id>.png. Identical paths to Social Publishing's, so the old host's 301s
// land on a working URL. Apple requires the feed to be "publicly addressable (not password-protected)"; these routes are
// listed in src/proxy.ts PUBLIC_PATHS.

type MediaRow = { id: string; storageKey: string; size: number; mime: string };

async function activeShow(slug: string) {
  const [show] = await db
    .select()
    .from(schema.podcastShows)
    .where(and(eq(schema.podcastShows.slug, slug), eq(schema.podcastShows.active, true)))
    .limit(1);
  return show ?? null;
}

async function mediaRow(id: string | null, workspaceId: string): Promise<MediaRow | null> {
  if (!id) return null;
  const [m] = await db
    .select({ id: schema.socialMedia.id, storageKey: schema.socialMedia.storageKey, size: schema.socialMedia.size, mime: schema.socialMedia.mime })
    .from(schema.socialMedia)
    .where(and(eq(schema.socialMedia.id, id), eq(schema.socialMedia.workspaceId, workspaceId)))
    .limit(1);
  return m ?? null;
}

/** The feed XML, or null when the show does not exist / is inactive. */
export async function feedXml(slug: string): Promise<string | null> {
  const show = await activeShow(slug);
  if (!show) return null;

  const rows = await db
    .select()
    .from(schema.podcastEpisodes)
    .where(eq(schema.podcastEpisodes.showId, show.id))
    .orderBy(desc(schema.podcastEpisodes.publishedAt));

  // Enclosure sizes come from the media rows: Apple requires `length`, and a wrong value makes clients mis-report
  // progress or abandon a download.
  const audioIds = rows.map((r) => r.audioMediaId);
  const media = audioIds.length
    ? await db
        .select({ id: schema.socialMedia.id, size: schema.socialMedia.size, mime: schema.socialMedia.mime })
        .from(schema.socialMedia)
        .where(and(inArray(schema.socialMedia.id, audioIds), eq(schema.socialMedia.workspaceId, show.workspaceId)))
    : [];
  const byId = new Map(media.map((m) => [m.id, m]));

  const base = `${siteOrigin()}/p/${show.slug}`;
  const episodes: FeedEpisode[] = [];
  for (const e of rows) {
    const audio = byId.get(e.audioMediaId);
    if (!audio) continue; // an episode with no file is not listable
    episodes.push({
      guid: e.guid,
      title: e.title,
      description: e.description,
      audioUrl: `${base}/audio/${publicId(e.id)}.mp3`,
      audioBytes: audio.size,
      audioMime: audio.mime || "audio/mpeg",
      durationSec: e.durationSec,
      imageUrl: e.imageMediaId ? `${base}/episode/${publicId(e.id)}.png` : null,
      link: e.link,
      publishedAt: e.publishedAt,
    });
  }

  return buildFeed(
    {
      slug: show.slug,
      title: show.title,
      description: show.description,
      author: show.author,
      language: show.language,
      category: show.category,
      subcategory: show.subcategory,
      explicit: show.explicit,
      link: show.link,
      copyright: show.copyright,
      coverUrl: show.coverMediaId ? `${base}/cover.jpg` : null,
      newFeedUrl: `${base}/rss.xml`,
    },
    episodes,
  );
}

export async function feedResponse(method: string, slug: string): Promise<Response> {
  const xml = await feedXml(slug);
  if (xml === null) return new Response("Not found", { status: 404 });
  const headers = {
    "Content-Type": "application/rss+xml; charset=utf-8",
    // Short: a directory re-reads the feed to discover new episodes.
    "Cache-Control": "public, max-age=300",
  };
  return new Response(method === "HEAD" ? null : xml, { headers });
}

export async function coverResponse(req: Request, slug: string): Promise<Response> {
  const show = await activeShow(slug);
  const m = show ? await mediaRow(show.coverMediaId, show.workspaceId) : null;
  if (!show || !m) return new Response("Not found", { status: 404 });
  const r = await serveStored(req.method, req.headers.get("range"), m.storageKey, m.size, {
    mime: m.mime || "image/jpeg",
    maxAge: 86_400,
    lastModified: show.updatedAt,
    signal: req.signal,
  });
  return r.response;
}

async function episodeOf(slug: string, file: string, ext: RegExp) {
  const id = fromPublicId(file.replace(ext, ""));
  if (!id) return null;
  const show = await activeShow(slug);
  if (!show) return null;
  const [ep] = await db
    .select()
    .from(schema.podcastEpisodes)
    .where(and(eq(schema.podcastEpisodes.id, id), eq(schema.podcastEpisodes.showId, show.id)))
    .limit(1);
  return ep ? { show, ep } : null;
}

export async function episodeImageResponse(req: Request, slug: string, file: string): Promise<Response> {
  const hit = await episodeOf(slug, file, /\.png$/i);
  const m = hit ? await mediaRow(hit.ep.imageMediaId, hit.show.workspaceId) : null;
  if (!hit || !m) return new Response("Not found", { status: 404 });
  const r = await serveStored(req.method, req.headers.get("range"), m.storageKey, m.size, {
    mime: m.mime || "image/png",
    maxAge: 31_536_000,
    lastModified: hit.ep.publishedAt,
    signal: req.signal,
  });
  return r.response;
}

/**
 * An episode's audio. A permanent, anonymous URL: podcast clients have no session, and Apple treats a changed
 * enclosure URL as a different episode. GET 200/206 deliveries are counted (IAB v2.2: HEAD excluded, 304 not counted),
 * using the bytes this response sends.
 */
export async function audioResponse(req: Request, slug: string, file: string): Promise<Response> {
  const hit = await episodeOf(slug, file, /\.mp3$/i);
  const m = hit ? await mediaRow(hit.ep.audioMediaId, hit.show.workspaceId) : null;
  if (!hit || !m) return new Response("Not found", { status: 404 });

  const r = await serveStored(req.method, req.headers.get("range"), m.storageKey, m.size, {
    mime: m.mime || "audio/mpeg",
    maxAge: 31_536_000, // immutable once published
    lastModified: hit.ep.publishedAt,
    signal: req.signal,
  });

  if (req.method === "GET" && (r.response.status === 200 || r.response.status === 206) && r.sending > 0) {
    await recordDelivery({
      showId: hit.ep.showId,
      episodeId: hit.ep.id,
      ip: clientIp(req.headers),
      userAgent: req.headers.get("user-agent") ?? "",
      bytes: r.sending,
      thresholdBytes: oneMinuteBytes(m.size, hit.ep.durationSec),
    });
  }
  return r.response;
}
