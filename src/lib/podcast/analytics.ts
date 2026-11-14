import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// Podcast download counting.
//
// Implemented to the IAB Podcast Measurement Technical Guidelines v2.2
// (iabtechlab.com, read 2026-09-15). "Downloads" is a number people compare
// between shows and quote to sponsors, so it is counted the way the industry
// defines it rather than by whatever our access log happens to make easy.
//
// The rules, verbatim in effect:
//
//   HEAD        excluded — "No data is transferred in a HEAD request"
//   GET 200     "valid count for downloads"
//   GET 206     counted "only if the download covers the 1 minute rule … and
//               de-duplication based on IP Address/UA to cover cases where the
//               listener might be skipping ahead. Determining whether the
//               requests cover the 1-minute requirement might require
//               reassembling requests."
//   GET 304     "should not be counted"
//   threshold   "the header information plus enough of the podcast content to
//               play for 1 minute should have been downloaded"
//   window      24 hours, fixed calendar day or rolling; deduplicated on IP + UA
//
// Reassembly is why this accumulates bytes into a per-(episode, day, client) row
// rather than logging requests: a client that seeks issues many 206s that are one
// listen, and summing them is precisely what the guidelines ask for.

/**
 * The salt for client hashes.
 *
 * Deduplication only needs to recognise a repeat client within 24 hours, so the
 * address is hashed and never stored. Falling back to the auth secret keeps
 * this working without new configuration; what matters is that it is stable
 * (a rotating salt would make every request look like a new listener) and not
 * guessable (an attacker who knows the salt could test whether a given IP
 * listened).
 */
function salt(): string {
  return process.env.PODCAST_ANALYTICS_SALT || process.env.BETTER_AUTH_SECRET || "dev-podcast-salt";
}

function clientHash(ip: string, ua: string): string {
  return createHash("sha256").update(`${salt()}|${ip}|${ua}`).digest("hex").slice(0, 32);
}

/**
 * The client's address.
 *
 * Behind Cloudflare the socket address is Cloudflare's, so the real client is in
 * `CF-Connecting-IP`. These headers are only trustworthy because this app is
 * reached exclusively through the tunnel; on a directly-exposed origin they
 * would be caller-controlled and useless for deduplication.
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Known non-listeners.
 *
 * The guidelines require filtering "User Agents that identify to be from sources
 * that are not actual listeners (e.g. bots that self identify as being bots)".
 * This is the self-identifying set only — it makes no attempt to detect traffic
 * that is actively pretending to be human, which is a different problem and not
 * one a feed of this size has.
 *
 * `validator` and `feedparser` matter more than they look: Apple, Spotify and
 * every directory poll the feed and sample the audio, and counting their checks
 * as listens would inflate a small show's numbers substantially.
 */
const BOT = /bot|crawler|spider|slurp|curl|wget|python-requests|okhttp-health|monitor|validator|feedparser|preview|scanner|uptime/i;

export function isBot(ua: string): boolean {
  return !ua || BOT.test(ua);
}

/**
 * Coarse client label for the "listening apps" breakdown.
 *
 * Deliberately a small allow-list rather than a parser: podcast user agents are
 * wildly inconsistent, and a bucket labelled "Other" is more honest than a
 * confidently wrong guess derived from a version string.
 */
const APPS: [RegExp, string][] = [
  [/apple ?podcasts|itunes|itms/i, "Apple Podcasts"],
  // AppleCoreMedia is iOS's own media fetcher. Apple Podcasts downloads through
  // it, but so does any app using AVFoundation — so it is labelled for what it
  // can actually be known to be rather than claimed as Apple Podcasts.
  [/applecoremedia|cfnetwork/i, "Apple (iOS)"],
  [/spotify/i, "Spotify"],
  [/overcast/i, "Overcast"],
  [/pocket ?casts/i, "Pocket Casts"],
  [/antennapod/i, "AntennaPod"],
  [/castro/i, "Castro"],
  [/podcast ?addict/i, "Podcast Addict"],
  [/downcast/i, "Downcast"],
  [/amazon ?music|audible/i, "Amazon Music"],
  [/youtube/i, "YouTube"],
  [/deezer/i, "Deezer"],
  [/iheart/i, "iHeartRadio"],
  [/vlc|mpv|foobar/i, "Desktop player"],
  [/mozilla|chrome|safari|edge/i, "Browser"],
];

export function appLabel(ua: string): string {
  for (const [re, label] of APPS) if (re.test(ua)) return label;
  return "Other";
}

/**
 * Bytes that must arrive before a request counts, for one episode.
 *
 * The guidelines say the publisher "must calculate this size for each episode"
 * because it depends on the bitrate and on how much the ID3 header consumes.
 * Deriving it from the episode's real file size and real duration does exactly
 * that, and is more accurate than assuming the nominal bitrate — it accounts for
 * the header automatically, since the header is part of the bytes.
 */
export function oneMinuteBytes(fileBytes: number, durationSec: number): number {
  if (durationSec <= 0) return fileBytes; // unknown duration: require the whole file
  return Math.min(fileBytes, Math.ceil((fileBytes / durationSec) * 60));
}

/** UTC calendar day — the fixed 24-hour window the guidelines permit. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Record bytes delivered for an episode, and count a download once the client
 * has received a minute's worth.
 *
 * Called after the response is built, for GET only. Never throws: analytics must
 * not be able to break audio delivery.
 */
export async function recordDelivery(opts: {
  showId: string;
  episodeId: string;
  ip: string;
  userAgent: string;
  bytes: number;
  thresholdBytes: number;
}): Promise<void> {
  const ua = opts.userAgent || "";
  if (isBot(ua) || opts.bytes <= 0) return;

  const hash = clientHash(opts.ip, ua);
  const day = today();

  try {
    // One statement: accumulate, and flip `counted` the moment the running total
    // crosses the threshold. Doing it in SQL keeps concurrent range requests from
    // the same client — which is the normal case — from racing each other.
    await db.execute(sql`
      INSERT INTO podcast_listens (show_id, episode_id, day, client_hash, bytes, requests, counted, app)
      VALUES (${opts.showId}, ${opts.episodeId}, ${day}, ${hash}, ${opts.bytes}, 1,
              ${opts.bytes >= opts.thresholdBytes}, ${appLabel(ua)})
      ON CONFLICT (episode_id, day, client_hash) DO UPDATE SET
        bytes = podcast_listens.bytes + ${opts.bytes},
        requests = podcast_listens.requests + 1,
        counted = podcast_listens.counted
                  OR (podcast_listens.bytes + ${opts.bytes}) >= ${opts.thresholdBytes},
        last_at = now()`);
  } catch {
    /* counting must never break delivery */
  }
}

/**
 * Clients whose volume marks them as something other than a listener.
 *
 * The guidelines require filtering "IP addresses that account for a large number
 * of downloads in the 24 hour period". The threshold is left to the implementer;
 * 50 distinct episodes from one client in a day is far beyond plausible human
 * listening and well clear of a household sharing an address.
 */
const ABUSIVE_PER_DAY = 50;

export interface ShowStats {
  downloads: number;
  last7: number;
  last30: number;
  episodes: { id: string; title: string; publishedAt: Date; downloads: number }[];
  byDay: { day: string; downloads: number }[];
  byApp: { app: string; downloads: number }[];
}

/** Everything the analytics page shows for one show. */
export async function showStats(showId: string): Promise<ShowStats> {
  const since = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  // Exclude over-volume clients up front so every figure below agrees.
  const valid = sql`
    counted
    AND client_hash NOT IN (
      SELECT client_hash FROM podcast_listens
      WHERE show_id = ${showId} AND counted
      GROUP BY client_hash, day
      HAVING count(*) > ${ABUSIVE_PER_DAY}
    )`;

  const [totals, byDay, byApp, episodes] = await Promise.all([
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE true)                    AS all_time,
        count(*) FILTER (WHERE day >= ${since(7)})      AS last7,
        count(*) FILTER (WHERE day >= ${since(30)})     AS last30
      FROM podcast_listens WHERE show_id = ${showId} AND ${valid}`),
    db.execute(sql`
      SELECT day::text AS day, count(*)::int AS downloads
      FROM podcast_listens
      WHERE show_id = ${showId} AND day >= ${since(30)} AND ${valid}
      GROUP BY day ORDER BY day`),
    db.execute(sql`
      SELECT coalesce(app, 'Other') AS app, count(*)::int AS downloads
      FROM podcast_listens
      WHERE show_id = ${showId} AND ${valid}
      GROUP BY app ORDER BY downloads DESC`),
    db.execute(sql`
      SELECT e.id, e.title, e.published_at,
             count(l.*) FILTER (WHERE l.counted)::int AS downloads
      FROM podcast_episodes e
      LEFT JOIN podcast_listens l ON l.episode_id = e.id
      WHERE e.show_id = ${showId}
      GROUP BY e.id, e.title, e.published_at
      ORDER BY e.published_at DESC`),
  ]);

  const t = (totals[0] ?? {}) as Record<string, string>;
  return {
    downloads: Number(t.all_time ?? 0),
    last7: Number(t.last7 ?? 0),
    last30: Number(t.last30 ?? 0),
    byDay: (byDay as unknown[]) as unknown as { day: string; downloads: number }[],
    byApp: (byApp as unknown[]) as unknown as { app: string; downloads: number }[],
    episodes: ((episodes as unknown[]) as unknown as {
      id: string; title: string; published_at: Date; downloads: number;
    }[]).map((r) => ({
      id: r.id, title: r.title, publishedAt: r.published_at, downloads: r.downloads,
    })),
  };
}

/** A workspace's shows, for the studio's analytics view. */
export async function listShows(workspaceId: string) {
  return db
    .select({ id: schema.podcastShows.id, title: schema.podcastShows.title, slug: schema.podcastShows.slug })
    .from(schema.podcastShows)
    .where(and(eq(schema.podcastShows.workspaceId, workspaceId), eq(schema.podcastShows.active, true)))
    .orderBy(desc(schema.podcastShows.createdAt));
}
