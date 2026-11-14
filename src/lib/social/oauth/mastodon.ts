import { appUrl, socialRedirectUri } from "../app-url";
// Mastodon OAuth 2.0 — self-service, no developer portal.
//
// Mastodon is federated: every user lives on their own instance (server), so a
// connect starts by asking for that instance's domain. Apps self-register at
// runtime via POST /api/v1/apps — no manual client id/secret, no review. We
// cache the per-instance app credentials (client id/secret) in app_setting so
// reconnecting the same instance reuses one app instead of spawning duplicates.
//
// Docs: https://docs.joinmastodon.org/methods/apps/ + /methods/oauth/

import { safeFetch } from "@/lib/social/safe-fetch";
import { getSetting, setSetting } from "@/lib/social/settings";

// ClipWaltz: one callback per provider under /api/social/oauth/<provider>/callback on the canonical www. origin.
const BASE = appUrl();

/** Our OAuth callback — the same for every instance, so nothing to register by hand. */
export function mastodonRedirectUri(): string {
  return socialRedirectUri("mastodon");
}

// Read + write scopes cover posting statuses and reading the account identity.
export const MASTODON_SCOPES = "read write";

/**
 * Normalize a user-typed instance ("mastodon.social", "https://mastodon.social/",
 * "@me@mastodon.social") to a clean https origin, or null if unusable.
 */
export function normalizeInstance(raw: string): string | null {
  let s = (raw || "").trim();
  if (!s) return null;
  // "@user@host" or "user@host" → take the host part.
  if (s.includes("@")) s = s.split("@").pop() || s;
  s = s.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim().toLowerCase();
  // Basic hostname sanity: at least one dot, valid chars.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null;
  return `https://${s}`;
}

interface MastodonApp {
  clientId: string;
  clientSecret: string;
}

/** Register (or reuse a cached) Mastodon app on the given instance. */
export async function ensureApp(instance: string): Promise<MastodonApp | null> {
  const cacheKey = `mastodon_app:${instance}`;
  const cached = await getSetting(cacheKey);
  if (cached) {
    try {
      const c = JSON.parse(cached) as MastodonApp;
      if (c.clientId && c.clientSecret) return c;
    } catch {
      /* fall through to re-register */
    }
  }

  const body = new URLSearchParams({
    client_name: "ClipWaltz",
    redirect_uris: mastodonRedirectUri(),
    scopes: MASTODON_SCOPES,
    website: BASE,
  });
  const res = await safeFetch(`${instance}/api/v1/apps`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as { client_id?: string; client_secret?: string };
  if (!d.client_id || !d.client_secret) return null;
  const app = { clientId: d.client_id, clientSecret: d.client_secret };
  await setSetting(cacheKey, JSON.stringify(app));
  return app;
}

/** Build the authorize URL the user is redirected to on their instance. */
export function mastodonAuthUrl(instance: string, clientId: string, state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: mastodonRedirectUri(),
    scope: MASTODON_SCOPES,
    state,
  });
  return `${instance}/oauth/authorize?${p.toString()}`;
}

/** Exchange an authorization code for an access token. */
export async function mastodonExchangeCode(
  instance: string,
  app: MastodonApp,
  code: string
): Promise<string | null> {
  const res = await safeFetch(`${instance}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: mastodonRedirectUri(),
      scope: MASTODON_SCOPES,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as { access_token?: string };
  return d.access_token ?? null;
}

/** Who owns this token → account id + handle for labelling the connection. */
export async function mastodonVerify(
  instance: string,
  token: string
): Promise<{ id: string; acct: string; displayName: string | null } | null> {
  const res = await safeFetch(`${instance}/api/v1/accounts/verify_credentials`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as {
    id?: string;
    username?: string;
    acct?: string;
    display_name?: string;
  };
  if (!d.id) return null;
  const host = instance.replace(/^https?:\/\//, "");
  const acct = d.acct?.includes("@") ? d.acct : `${d.acct || d.username}@${host}`;
  return { id: d.id, acct: `@${acct}`, displayName: d.display_name || d.username || null };
}
