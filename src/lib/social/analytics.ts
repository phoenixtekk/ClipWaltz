import type { Connection } from "@/lib/social/connections";

// ClipWaltz port: SP read Facebook/Instagram tokens from the installation's env (FACEBOOK_PAGE_ACCESS_TOKEN) and
// Threads/Bluesky from "the" connection of the signed-in user. Here the caller passes the CONNECTION the post was
// published through (social_post_targets.connectionId, resolved in the post's workspace), so every tenant reads its
// own channel with its own token.

// Per-post engagement metrics, fetched live from each network's own API.
// Nulls mean "this network doesn't expose that metric" (or it's unavailable).
export interface PostMetrics {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
}

const EMPTY: PostMetrics = { likes: null, comments: null, shares: null, views: null };
const GRAPH = "https://graph.facebook.com";

function fbVersion() {
  return process.env.FACEBOOK_API_VERSION || "v21.0";
}

/** Fetch live metrics for one published post on one network. Never throws. */
export async function fetchPostMetrics(
  provider: string,
  externalId: string,
  conn: Connection | null,
): Promise<PostMetrics> {
  try {
    if (provider === "facebook") {
      const token = conn?.accessToken;
      if (!token) return EMPTY;
      const res = await fetch(
        `${GRAPH}/${fbVersion()}/${externalId}?fields=reactions.summary(true),comments.summary(true),shares&access_token=${encodeURIComponent(token)}`
      );
      const d = (await res.json()) as {
        reactions?: { summary?: { total_count?: number } };
        comments?: { summary?: { total_count?: number } };
        shares?: { count?: number };
      };
      return {
        likes: d.reactions?.summary?.total_count ?? null,
        comments: d.comments?.summary?.total_count ?? null,
        shares: d.shares?.count ?? null,
        views: null,
      };
    }

    if (provider === "instagram") {
      const token = conn?.accessToken;
      if (!token) return EMPTY;
      const res = await fetch(
        `${GRAPH}/${fbVersion()}/${externalId}?fields=like_count,comments_count&access_token=${encodeURIComponent(token)}`
      );
      const d = (await res.json()) as { like_count?: number; comments_count?: number };
      return { likes: d.like_count ?? null, comments: d.comments_count ?? null, shares: null, views: null };
    }

    if (provider === "threads") {
      if (!conn) return EMPTY;
      const res = await fetch(
        `https://graph.threads.net/v1.0/${externalId}/insights?metric=views,likes,replies,reposts&access_token=${encodeURIComponent(conn.accessToken)}`
      );
      const d = (await res.json()) as { data?: { name?: string; values?: { value?: number }[] }[] };
      const m = Object.fromEntries((d.data || []).map((x) => [x.name, x.values?.[0]?.value]));
      return {
        likes: m.likes ?? null,
        comments: m.replies ?? null,
        shares: m.reposts ?? null,
        views: m.views ?? null,
      };
    }

    if (provider === "bluesky") {
      // Public appview — no auth. externalId is the at:// URI.
      const res = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(externalId)}`
      );
      const d = (await res.json()) as {
        posts?: { likeCount?: number; replyCount?: number; repostCount?: number }[];
      };
      const p = d.posts?.[0];
      return {
        likes: p?.likeCount ?? null,
        comments: p?.replyCount ?? null,
        shares: p?.repostCount ?? null,
        views: null,
      };
    }
  } catch {
    /* fall through to EMPTY */
  }
  return EMPTY;
}
