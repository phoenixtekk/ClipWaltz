import { socialRedirectUri } from "../app-url";
// Threads OAuth 2.0 + long-lived token exchange (Meta Threads API).
//
// STAGED — verified only once the Threads account is connected. The token
// exchange returns the Threads user id, which we store for publishing.
// Docs: https://developers.facebook.com/docs/threads

const AUTH_URL = "https://threads.net/oauth/authorize";
const TOKEN_URL = "https://graph.threads.net/oauth/access_token";
const LONG_LIVED_URL = "https://graph.threads.net/access_token";

export const THREADS_SCOPES = ["threads_basic", "threads_content_publish", "threads_manage_replies"];

export function threadsConfigured(): boolean {
  return Boolean(process.env.THREADS_CLIENT_ID && process.env.THREADS_CLIENT_SECRET);
}

function redirectUri(): string {
  return socialRedirectUri("threads");
}

export function buildAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.THREADS_CLIENT_ID || "",
    redirect_uri: redirectUri(),
    scope: THREADS_SCOPES.join(","),
    response_type: "code",
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

export interface ThreadsToken {
  accessToken: string;
  userId: string;
  expiresIn: number | null;
}

/** Exchange the auth code → short-lived token (+ user id) → long-lived token. */
export async function exchangeCode(code: string): Promise<ThreadsToken> {
  const clientId = process.env.THREADS_CLIENT_ID || "";
  const clientSecret = process.env.THREADS_CLIENT_SECRET || "";

  // 1. Short-lived token — also returns the Threads user id.
  const shortRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
      code,
    }),
  });
  if (!shortRes.ok) {
    const t = await shortRes.text().catch(() => "");
    throw new Error(`Threads token exchange failed (HTTP ${shortRes.status}): ${t.slice(0, 200)}`);
  }
  const short = (await shortRes.json()) as { access_token: string; user_id: string | number };

  // 2. Long-lived token (~60 days).
  let accessToken = short.access_token;
  let expiresIn: number | null = null;
  const longRes = await fetch(
    `${LONG_LIVED_URL}?grant_type=th_exchange_token&client_secret=${encodeURIComponent(clientSecret)}&access_token=${encodeURIComponent(short.access_token)}`
  );
  if (longRes.ok) {
    const long = (await longRes.json()) as { access_token?: string; expires_in?: number };
    if (long.access_token) accessToken = long.access_token;
    expiresIn = long.expires_in ?? null;
  }

  // The token response's user_id is a NUMBER; large Threads ids exceed JS's safe
  // integer range and lose precision. /me returns the id as a string — use that.
  let userId = String(short.user_id);
  try {
    const meRes = await fetch(
      `https://graph.threads.net/v1.0/me?fields=id&access_token=${encodeURIComponent(accessToken)}`
    );
    if (meRes.ok) {
      const me = (await meRes.json()) as { id?: string };
      if (me.id) userId = me.id;
    }
  } catch {
    /* fall back to the token-response id */
  }

  return { accessToken, userId, expiresIn };
}

/** Refresh a long-lived Threads token (extends ~60 days). Returns null on failure. */
export async function refreshThreadsToken(
  currentToken: string
): Promise<{ accessToken: string; expiresIn: number | null } | null> {
  const res = await fetch(
    `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(currentToken)}`
  );
  if (!res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!d.access_token) return null;
  return { accessToken: d.access_token, expiresIn: d.expires_in ?? null };
}
