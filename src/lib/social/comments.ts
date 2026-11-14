import type { Connection } from "@/lib/social/connections";

// ClipWaltz port: SP read Facebook/Instagram tokens from the installation's env (FACEBOOK_PAGE_ACCESS_TOKEN) and
// Threads/Bluesky from "the" connection of the signed-in user. Here the caller passes the CONNECTION the post was
// published through (social_post_targets.connectionId, resolved in the post's workspace), so every tenant reads its
// own channel with its own token.

// A comment/reply on a published post, normalized across networks.
export interface CommentItem {
  id: string; // platform id (FB comment id / Bluesky post uri)
  author: string;
  text: string;
  createdAt: string | null;
  // Bluesky reply context (root + parent refs).
  ref?: { uri: string; cid: string; rootUri: string; rootCid: string };
}

const GRAPH = "https://graph.facebook.com";
const PDS = process.env.BLUESKY_PDS || "https://bsky.social";
function fbV() {
  return process.env.FACEBOOK_API_VERSION || "v21.0";
}

/** Fetch comments/replies on one published post. Never throws. */
export async function fetchComments(
  provider: string,
  externalId: string,
  conn: Connection | null,
): Promise<CommentItem[]> {
  try {
    if (provider === "facebook") {
      const token = conn?.accessToken;
      if (!token) return [];
      const res = await fetch(
        `${GRAPH}/${fbV()}/${externalId}/comments?fields=id,message,created_time,from&limit=50&access_token=${encodeURIComponent(token)}`
      );
      const d = (await res.json()) as {
        data?: { id: string; message?: string; created_time?: string; from?: { name?: string } }[];
      };
      return (d.data || []).map((c) => ({
        id: c.id,
        author: c.from?.name || "Someone",
        text: c.message || "",
        createdAt: c.created_time ?? null,
      }));
    }

    if (provider === "instagram") {
      const token = conn?.accessToken;
      if (!token) return [];
      const res = await fetch(
        `${GRAPH}/${fbV()}/${externalId}/comments?fields=id,text,username,timestamp&access_token=${encodeURIComponent(token)}`
      );
      const d = (await res.json()) as {
        data?: { id: string; text?: string; username?: string; timestamp?: string }[];
      };
      return (d.data || []).map((c) => ({
        id: c.id,
        author: c.username ? `@${c.username}` : "Someone",
        text: c.text || "",
        createdAt: c.timestamp ?? null,
      }));
    }

    if (provider === "threads") {
      if (!conn) return [];
      const res = await fetch(
        `https://graph.threads.net/v1.0/${externalId}/replies?fields=id,text,username,timestamp&access_token=${encodeURIComponent(conn.accessToken)}`
      );
      const d = (await res.json()) as {
        data?: { id: string; text?: string; username?: string; timestamp?: string }[];
      };
      return (d.data || []).map((c) => ({
        id: c.id,
        author: c.username ? `@${c.username}` : "Someone",
        text: c.text || "",
        createdAt: c.timestamp ?? null,
      }));
    }

    if (provider === "bluesky") {
      const res = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(externalId)}&depth=1`
      );
      const d = (await res.json()) as {
        thread?: {
          post?: { uri?: string; cid?: string };
          replies?: {
            post: {
              uri: string; cid: string;
              author?: { handle?: string };
              record?: { text?: string; createdAt?: string };
            };
          }[];
        };
      };
      const rootUri = d.thread?.post?.uri || externalId;
      const rootCid = d.thread?.post?.cid || "";
      return (d.thread?.replies || []).map((r) => ({
        id: r.post.uri,
        author: `@${r.post.author?.handle || "user"}`,
        text: r.post.record?.text || "",
        createdAt: r.post.record?.createdAt ?? null,
        ref: { uri: r.post.uri, cid: r.post.cid, rootUri, rootCid },
      }));
    }
  } catch {
    /* fall through */
  }
  return [];
}

/** Post a reply. Returns {ok} / {ok:false,error}. */
export async function postReply(
  provider: string,
  args: { commentId?: string; ref?: CommentItem["ref"]; text: string },
  conn: Connection | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (provider === "facebook") {
      const token = conn?.accessToken;
      if (!token || !args.commentId) return { ok: false, error: "Missing Facebook context." };
      const res = await fetch(`${GRAPH}/${fbV()}/${args.commentId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ message: args.text, access_token: token }),
      });
      const d = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      return d.id ? { ok: true } : { ok: false, error: d.error?.message || "Facebook reply failed." };
    }

    if (provider === "instagram") {
      const token = conn?.accessToken;
      if (!token || !args.commentId) return { ok: false, error: "Missing Instagram context." };
      const res = await fetch(`${GRAPH}/${fbV()}/${args.commentId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ message: args.text, access_token: token }),
      });
      const d = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      return d.id ? { ok: true } : { ok: false, error: d.error?.message || "Instagram reply failed." };
    }

    if (provider === "threads") {
      if (!conn?.externalId || !args.commentId) return { ok: false, error: "Missing Threads context." };
      // Create a reply container (reply_to_id), then publish it.
      const create = await fetch(`https://graph.threads.net/v1.0/${conn.externalId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          media_type: "TEXT",
          text: args.text,
          reply_to_id: args.commentId,
          access_token: conn.accessToken,
        }),
      });
      const c = (await create.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (!c.id) return { ok: false, error: c.error?.message || "Threads reply container failed." };
      const pub = await fetch(`https://graph.threads.net/v1.0/${conn.externalId}/threads_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ creation_id: c.id, access_token: conn.accessToken }),
      });
      const p = (await pub.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      return p.id ? { ok: true } : { ok: false, error: p.error?.message || "Threads reply publish failed." };
    }

    if (provider === "bluesky") {
      if (!args.ref) return { ok: false, error: "Missing Bluesky context." };
      if (!conn) return { ok: false, error: "Bluesky not connected." };
      const sess = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: conn.externalId, password: conn.accessToken }),
      });
      if (!sess.ok) return { ok: false, error: "Bluesky sign-in failed." };
      const s = (await sess.json()) as { accessJwt: string; did: string };
      const record = {
        $type: "app.bsky.feed.post",
        text: args.text,
        createdAt: new Date().toISOString(),
        reply: {
          root: { uri: args.ref.rootUri, cid: args.ref.rootCid },
          parent: { uri: args.ref.uri, cid: args.ref.cid },
        },
      };
      const res = await fetch(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
        method: "POST",
        headers: { Authorization: `Bearer ${s.accessJwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ repo: s.did, collection: "app.bsky.feed.post", record }),
      });
      const d = (await res.json().catch(() => ({}))) as { uri?: string; message?: string };
      return d.uri ? { ok: true } : { ok: false, error: d.message || "Bluesky reply failed." };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reply failed." };
  }
  return { ok: false, error: "Unsupported network." };
}
