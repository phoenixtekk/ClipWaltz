import { randomUUID } from "crypto";
import type { ConnData } from "@/lib/social/connections";
import type { ProviderId } from "@/lib/social/publishing/types";
import { assertPublicHost } from "@/lib/social/credentials";
import { fbAuthUrl, fbExchangeCode, fbLoginConfigured } from "./facebook";
import { exchangeLongLived, listPages } from "./facebook-tokens";
import { buildAuthUrl as linkedinAuthUrl, exchangeCode as linkedinExchange, fetchPrimaryOrg, linkedinConfigured } from "./linkedin";
import { ensureApp, mastodonAuthUrl, mastodonExchangeCode, mastodonVerify, normalizeInstance } from "./mastodon";
import {
  missingScopes, pinterestAuthUrl, pinterestBoards, pinterestConfigured, pinterestExchangeCode, pinterestUsername, serialiseCreds,
} from "./pinterest";
import { buildAuthUrl as threadsAuthUrl, exchangeCode as threadsExchange, threadsConfigured } from "./threads";
import { tiktokAuthUrl, tiktokConfigured, tiktokExchangeCode } from "./tiktok";
import { tumblrAuthUrl, tumblrConfigured, tumblrExchangeCode, tumblrPrimaryBlog } from "./tumblr";
import { pkce, xAuthUrl, xConfigured, xExchangeCode } from "./x";
import { youtubeAuthUrl, youtubeConfigured, youtubeExchangeCode } from "./youtube";

// The OAuth flows, behind ONE start route and ONE callback route
// (src/app/api/social/oauth/[provider]/{start,callback}/route.ts — plan §4.4). SP had a pair of route files per network
// (`/api/facebook/oauth/start`, `/api/linkedin/connect` + `/api/linkedin/callback`, …); the per-network logic of those
// routes lives here unchanged in substance, and the routes do the shared work: session, flag, workspace role (admin+),
// CSRF state cookie, plan limit, persistence, and the redirect back.
//
// Every provider's redirect URI is `${APP_URL}/api/social/oauth/<provider>/callback` (APP_URL = the canonical www.
// origin). Those URIs must be registered in each provider's developer console before a connect can work (plan §5/R4).

/** Opaque per-flow values carried from start to callback in the HMAC-sealed httpOnly state cookie (never secrets). */
export type FlowExtras = Record<string, string>;

/** One connection to save. `matchExternalId` = update the same account if already connected. */
export interface PendingConnection {
  provider: ProviderId;
  data: ConnData;
}

export interface FinishResult {
  connections: PendingConnection[];
  /** Query-string outcome for the Networks page, e.g. "connected", "choose_board". */
  result: string;
  /** Extra query parameters for the Networks page (never secrets). */
  params?: Record<string, string>;
}

export interface OAuthFlow {
  configured(): boolean;
  /** Build the authorize URL. May throw a user-facing Error (bad Mastodon instance). */
  start(ctx: { state: string; query: URLSearchParams }): Promise<{ url: string; extras?: FlowExtras }>;
  /** Exchange the code and describe the connection(s) to save. Throws a user-facing Error on failure. */
  finish(ctx: { code: string; extras: FlowExtras }): Promise<FinishResult>;
}

const FLOWS: Partial<Record<ProviderId, OAuthFlow>> = {
  // Facebook Login → long-lived user token → a connection for EVERY Page the user manages (existing ones refreshed in
  // place by account match). ClipWaltz addition: a Page's linked Instagram Business account becomes an `instagram`
  // connection too (SP had the env-linked one only). The long-lived USER token is kept on each connection's
  // (encrypted) refreshToken so the scheduler can re-derive Page tokens (src/lib/social/oauth/facebook-tokens.ts).
  facebook: {
    configured: fbLoginConfigured,
    async start({ state }) {
      return { url: fbAuthUrl(state) };
    },
    async finish({ code }) {
      const shortToken = await fbExchangeCode(code);
      if (!shortToken) throw new Error("facebook_exchange");
      const ll = await exchangeLongLived(shortToken);
      const userToken = ll?.token ?? shortToken;
      const expiresAt = ll?.expiresIn ? new Date(Date.now() + ll.expiresIn * 1000) : null;
      const { pages, error } = await listPages(userToken);
      if (error) throw new Error(error);
      const connections: PendingConnection[] = [];
      for (const pg of pages) {
        connections.push({
          provider: "facebook",
          data: { accessToken: pg.access_token, refreshToken: userToken, expiresAt, externalId: pg.id, label: pg.name, displayName: pg.name },
        });
        const ig = pg.instagram_business_account;
        if (ig?.id) {
          connections.push({
            provider: "instagram",
            data: {
              accessToken: pg.access_token,
              refreshToken: userToken,
              expiresAt,
              externalId: ig.id,
              label: ig.username ? `@${ig.username}` : `${pg.name} (Instagram)`,
              displayName: ig.username ? `@${ig.username}` : `${pg.name} (Instagram)`,
            },
          });
        }
      }
      if (connections.length === 0) throw new Error("facebook_no_pages");
      return { connections, result: "connected", params: { count: String(connections.length) } };
    },
  },

  linkedin: {
    configured: linkedinConfigured,
    async start({ state }) {
      return { url: linkedinAuthUrl(state) };
    },
    async finish({ code }) {
      const token = await linkedinExchange(code);
      const version = process.env.LINKEDIN_API_VERSION || "202401";
      const org = await fetchPrimaryOrg(token.accessToken, version);
      return {
        connections: [{
          provider: "linkedin",
          data: {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresAt: token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000) : null,
            externalId: org?.id ?? null,
            displayName: org?.name ?? null,
            scope: token.scope,
          },
        }],
        result: org?.id ? "connected" : "connected_no_org",
      };
    },
  },

  // Federated: the user's server first (`?instance=`), then an app registered on that instance at runtime (cached
  // per instance), then the usual code flow. The token is meaningless without its instance, so both are stored.
  mastodon: {
    configured: () => true,
    async start({ state, query }) {
      const instance = normalizeInstance(query.get("instance") || "");
      if (!instance) throw new Error("mastodon_instance");
      await assertPublicHost(instance).catch(() => {
        throw new Error("mastodon_instance");
      });
      const app = await ensureApp(instance);
      if (!app) throw new Error("mastodon_register");
      return { url: mastodonAuthUrl(instance, app.clientId, state), extras: { instance } };
    },
    async finish({ code, extras }) {
      // The cookie is sealed, but the instance is still re-normalized and re-checked here: it decides where this server
      // sends the code and client secret. (safeFetch re-vets the resolved address on every request as well.)
      const instance = normalizeInstance(extras.instance || "");
      if (!instance || instance !== extras.instance) throw new Error("mastodon_state");
      await assertPublicHost(instance).catch(() => {
        throw new Error("mastodon_instance");
      });
      const app = await ensureApp(instance);
      if (!app) throw new Error("mastodon_register");
      const token = await mastodonExchangeCode(instance, app, code);
      if (!token) throw new Error("mastodon_exchange");
      const who = await mastodonVerify(instance, token);
      if (!who) throw new Error("mastodon_verify");
      return {
        connections: [{
          provider: "mastodon",
          data: {
            accessToken: JSON.stringify({ instance, token }),
            externalId: who.id,
            displayName: who.acct,
            label: who.displayName ? `${who.displayName} (${who.acct})` : who.acct,
          },
        }],
        result: "connected",
      };
    },
  },

  // A Pin must be created ON A BOARD, so a token alone is not a usable destination. One board is selected outright;
  // several send the operator to a picker (P2). A short grant is caught HERE, not on a live post.
  pinterest: {
    configured: pinterestConfigured,
    async start({ state }) {
      return { url: pinterestAuthUrl(state) };
    },
    async finish({ code }) {
      const tokens = await pinterestExchangeCode(code);
      if (!tokens) throw new Error("pinterest_exchange");
      const short = missingScopes(tokens.scopes);
      if (short.length) throw new Error(`pinterest_scopes:${short.join(",")}`);
      const [boards, username] = await Promise.all([pinterestBoards(tokens.accessToken), pinterestUsername(tokens.accessToken)]);
      if (boards.length === 0) throw new Error("pinterest_no_boards");
      const board = boards.length === 1 ? boards[0] : null;
      return {
        connections: [{
          provider: "pinterest",
          data: {
            accessToken: serialiseCreds(tokens),
            expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
            externalId: board?.id ?? null,
            displayName: username ? `@${username}${board ? ` · ${board.name}` : ""}` : board?.name ?? "Pinterest",
          },
        }],
        result: board ? "connected" : "choose_board",
      };
    },
  },

  threads: {
    configured: threadsConfigured,
    async start({ state }) {
      return { url: threadsAuthUrl(state) };
    },
    async finish({ code }) {
      const token = await threadsExchange(code);
      return {
        connections: [{
          provider: "threads",
          data: {
            accessToken: token.accessToken,
            externalId: token.userId,
            expiresAt: token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000) : null,
          },
        }],
        result: "connected",
      };
    },
  },

  tiktok: {
    configured: tiktokConfigured,
    async start({ state }) {
      const { verifier, challenge } = pkce();
      return { url: tiktokAuthUrl(state, challenge), extras: { verifier } };
    },
    async finish({ code, extras }) {
      if (!extras.verifier) throw new Error("tiktok_state");
      const tokens = await tiktokExchangeCode(code, extras.verifier);
      if (!tokens) throw new Error("tiktok_exchange");
      return {
        connections: [{
          provider: "tiktok",
          data: {
            // The adapter refreshes from this blob (the shape SP's TikTok adapter reads).
            accessToken: JSON.stringify({
              clientKey: process.env.TIKTOK_CLIENT_KEY,
              clientSecret: process.env.TIKTOK_CLIENT_SECRET,
              refreshToken: tokens.refreshToken,
            }),
            externalId: tokens.openId,
            displayName: "TikTok",
          },
        }],
        result: "connected",
      };
    },
  },

  tumblr: {
    configured: tumblrConfigured,
    async start({ state }) {
      return { url: tumblrAuthUrl(state) };
    },
    async finish({ code }) {
      const tokens = await tumblrExchangeCode(code);
      if (!tokens || !tokens.refreshToken) throw new Error("tumblr_exchange");
      const blog = await tumblrPrimaryBlog(tokens.accessToken);
      if (!blog) throw new Error("tumblr_blog");
      return {
        connections: [{
          provider: "tumblr",
          data: {
            accessToken: JSON.stringify({
              clientId: process.env.TUMBLR_CLIENT_ID,
              clientSecret: process.env.TUMBLR_CLIENT_SECRET,
              refreshToken: tokens.refreshToken,
            }),
            externalId: blog.identifier,
            displayName: blog.name,
            label: blog.name,
          },
        }],
        result: "connected",
      };
    },
  },

  x: {
    configured: xConfigured,
    async start({ state }) {
      const { verifier, challenge } = pkce();
      return { url: xAuthUrl(state, challenge), extras: { verifier } };
    },
    async finish({ code, extras }) {
      if (!extras.verifier) throw new Error("x_state");
      const tokens = await xExchangeCode(code, extras.verifier);
      if (!tokens) throw new Error("x_exchange");
      let xUserId = "x";
      let handle: string | null = null;
      try {
        const me = (await fetch("https://api.twitter.com/2/users/me", {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }).then((r) => r.json())) as { data?: { id?: string; username?: string } };
        if (me.data?.id) xUserId = me.data.id;
        if (me.data?.username) handle = `@${me.data.username}`;
      } catch {
        /* best effort */
      }
      return {
        connections: [{
          provider: "x",
          data: {
            accessToken: JSON.stringify({ cid: process.env.X_CLIENT_ID, csec: process.env.X_CLIENT_SECRET, rt: tokens.refreshToken }),
            externalId: xUserId,
            displayName: handle || "X account",
          },
        }],
        result: "connected",
      };
    },
  },

  youtube: {
    configured: youtubeConfigured,
    async start({ state }) {
      return { url: youtubeAuthUrl(state) };
    },
    async finish({ code }) {
      const tokens = await youtubeExchangeCode(code);
      if (!tokens) throw new Error("youtube_exchange");
      let channelId = "youtube";
      let title: string | null = null;
      try {
        const ch = (await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }).then((r) => r.json())) as { items?: { id?: string; snippet?: { title?: string } }[] };
        if (ch.items?.[0]) {
          channelId = ch.items[0].id || channelId;
          title = ch.items[0].snippet?.title ?? null;
        }
      } catch {
        /* best effort */
      }
      return {
        connections: [{
          provider: "youtube",
          data: {
            accessToken: JSON.stringify({
              clientId: process.env.YOUTUBE_CLIENT_ID,
              clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
              refreshToken: tokens.refreshToken,
            }),
            externalId: channelId,
            displayName: title || "YouTube channel",
          },
        }],
        result: "connected",
      };
    },
  },
};

export function oauthFlow(provider: string): OAuthFlow | null {
  return (FLOWS as Record<string, OAuthFlow | undefined>)[provider] ?? null;
}

export const OAUTH_PROVIDERS = Object.keys(FLOWS) as ProviderId[];

export const newState = () => randomUUID();
