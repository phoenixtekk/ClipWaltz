import { listAllConnectionsForMaintenance, updateConnectionTokens } from "@/lib/social/connections";

// Facebook token lifecycle. Page access tokens derived from a LONG-lived user token are themselves long-lived, so
// keeping Facebook healthy means: (1) store the long-lived user token, (2) re-extend it before its ~60-day expiry, and
// (3) periodically re-derive Page tokens from it. Shared by the OAuth callback and the scheduler's auto-refresh.
//
// Ported from SP `src/lib/facebook-tokens.ts`. SP kept ONE long-lived user token in `app_setting` (one installation,
// one Facebook login). ClipWaltz is multi-tenant, so the long-lived USER token is stored on each Page connection's
// (encrypted) `refreshToken` column, its expiry in `expiresAt`, and the refresh is per connection.

const GRAPH = "https://graph.facebook.com";
const V = () => process.env.FACEBOOK_API_VERSION || "v21.0";

/** Exchange a user token for a long-lived one (~60 days). */
export async function exchangeLongLived(
  userToken: string,
): Promise<{ token: string; expiresIn: number | null } | null> {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return { token: userToken, expiresIn: null };
  const ex = (await fetch(
    `${GRAPH}/${V()}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(userToken)}`,
  )
    .then((r) => r.json())
    .catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (ex.access_token) return { token: ex.access_token, expiresIn: ex.expires_in ?? null };
  return null;
}

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id?: string; username?: string };
}

/** Every Page the user token manages, with fresh Page tokens (and any linked Instagram business account). */
export async function listPages(userToken: string): Promise<{ pages: FacebookPage[]; error?: string }> {
  const acc = (await fetch(
    `${GRAPH}/${V()}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=200&access_token=${encodeURIComponent(userToken)}`,
  )
    .then((r) => r.json())
    .catch(() => ({}))) as { data?: FacebookPage[]; error?: { message?: string } };
  if (!acc.data) return { pages: [], error: acc.error?.message || "Couldn't read Pages." };
  return { pages: acc.data };
}

const DAY = 24 * 3600 * 1000;

/**
 * Scheduler hook: keep Facebook (and the Instagram accounts riding on Page tokens) self-healing. For every connection
 * that holds a long-lived user token: extend it when within 14 days of expiry, and re-derive the Page token at most
 * once a day. Returns the number of connections whose Page token was refreshed.
 */
export async function autoRefreshFacebook(now: Date): Promise<number> {
  const conns = [
    ...(await listAllConnectionsForMaintenance("facebook")),
    ...(await listAllConnectionsForMaintenance("instagram")),
  ].filter((c) => c.refreshToken);
  let refreshed = 0;
  for (const c of conns) {
    try {
      let userToken = c.refreshToken!;
      let userExpires = c.expiresAt;
      if (userExpires && userExpires.getTime() - now.getTime() < 14 * DAY) {
        const ll = await exchangeLongLived(userToken);
        if (ll) {
          userToken = ll.token;
          userExpires = ll.expiresIn ? new Date(now.getTime() + ll.expiresIn * 1000) : null;
        }
      }
      // Page tokens are stable from a long-lived user token, so once a day is plenty: the scheduler calls this at
      // most daily (`social:facebook_last_refresh`, src/lib/social/scheduler.ts), as SP did with FB_LAST_REFRESH.
      const { pages } = await listPages(userToken);
      const page =
        c.provider === "facebook"
          ? pages.find((p) => p.id === c.externalId)
          : pages.find((p) => p.instagram_business_account?.id === c.externalId);
      if (!page) continue;
      await updateConnectionTokens(c, { accessToken: page.access_token, refreshToken: userToken, expiresAt: userExpires });
      refreshed++;
    } catch {
      /* leave the connection; try again next time */
    }
  }
  return refreshed;
}
