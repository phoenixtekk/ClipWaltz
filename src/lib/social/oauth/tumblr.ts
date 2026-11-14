import { socialRedirectUri } from "../app-url";
// Tumblr OAuth 2.0 (Authorization Code). Requires a registered Tumblr app
// (https://www.tumblr.com/oauth/apps) for the consumer key/secret. Access tokens
// expire (~1h); `offline_access` yields a refresh token we use to mint new ones.
//
// Docs: https://www.tumblr.com/docs/en/api/v2

const AUTH_URL = "https://www.tumblr.com/oauth2/authorize";
const TOKEN_URL = "https://api.tumblr.com/v2/oauth2/token";
const API = "https://api.tumblr.com/v2";

export const TUMBLR_SCOPES = "basic write offline_access";

export function tumblrConfigured(): boolean {
  return Boolean(process.env.TUMBLR_CLIENT_ID && process.env.TUMBLR_CLIENT_SECRET);
}

export function tumblrRedirectUri(): string {
  return socialRedirectUri("tumblr");
}

export function tumblrAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.TUMBLR_CLIENT_ID || "",
    response_type: "code",
    scope: TUMBLR_SCOPES,
    state,
    redirect_uri: tumblrRedirectUri(),
  });
  return `${AUTH_URL}?${p.toString()}`;
}

interface TumblrTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
}

export async function tumblrExchangeCode(code: string): Promise<TumblrTokens | null> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: process.env.TUMBLR_CLIENT_ID || "",
    client_secret: process.env.TUMBLR_CLIENT_SECRET || "",
    redirect_uri: tumblrRedirectUri(),
  });
}

export async function tumblrRefresh(refreshToken: string): Promise<TumblrTokens | null> {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.TUMBLR_CLIENT_ID || "",
    client_secret: process.env.TUMBLR_CLIENT_SECRET || "",
  });
}

async function tokenRequest(fields: Record<string, string>): Promise<TumblrTokens | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!d.access_token) return null;
  return { accessToken: d.access_token, refreshToken: d.refresh_token ?? null, expiresIn: d.expires_in ?? null };
}

/** The user's primary blog identifier (e.g. "myblog.tumblr.com") + display name. */
export async function tumblrPrimaryBlog(
  accessToken: string
): Promise<{ identifier: string; name: string } | null> {
  const res = await fetch(`${API}/user/info`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as {
    response?: { user?: { blogs?: { name?: string; url?: string; primary?: boolean }[] } };
  };
  const blogs = d.response?.user?.blogs ?? [];
  const primary = blogs.find((b) => b.primary) ?? blogs[0];
  if (!primary?.name) return null;
  return { identifier: `${primary.name}.tumblr.com`, name: primary.name };
}
