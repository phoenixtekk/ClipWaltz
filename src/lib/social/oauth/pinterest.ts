import { socialRedirectUri } from "../app-url";
// Pinterest OAuth 2.0 (API v5).
//
// Verified against developers.pinterest.com on 2026-09-20:
//
//   authorize   https://www.pinterest.com/oauth/
//   token       https://api.pinterest.com/v5/oauth/token
//   auth        HTTP Basic, base64 of `client_id:client_secret`
//   body        application/x-www-form-urlencoded
//
// Two details that are easy to get wrong:
//
//   • **The redirect URI must match EXACTLY** what is registered on the app
//     profile — Pinterest's own wording is "an exact match to avoid any
//     exceptions". Trailing slash, scheme and case all count. It is sent again
//     on the token exchange and must be identical there too.
//   • **`continuous_refresh=true`** is what yields a refresh token that keeps
//     working. Apps created before 2025-09-25 must pass it; apps created on or
//     after that date get the behaviour automatically. It is sent here either
//     way, because the cost of sending it to a newer app is nothing and the cost
//     of omitting it on an older one is a connection that silently dies when the
//     access token expires — exactly the failure the YouTube connection hit.

const AUTHORIZE = "https://www.pinterest.com/oauth/";
const TOKEN = "https://api.pinterest.com/v5/oauth/token";

/**
 * The scopes creating a Pin actually requires.
 *
 *   boards:read        list the boards, so a board can be chosen
 *   boards:write       ⚠️ required to create a Pin ON a board
 *   pins:read          ⚠️ required alongside pins:write
 *   pins:write         create the Pin
 *   user_accounts:read read the username, to label the connection
 *
 * The two marked entries are not guesses and not obvious from the scope list.
 * A first attempt asked only for `boards:read`, `pins:write` and
 * `user_accounts:read` — the reasonable-looking minimum — and `POST /v5/pins`
 * answered:
 *
 *   "Your token does not have sufficient permissions to perform this operation.
 *    … Missing: ['boards:write', 'pins:read']"
 *
 * Pinterest treats writing a Pin as writing to the board, and pairs each write
 * scope with its read. Nothing in the scope reference says so; the API is the
 * only source that does, which is why `missingScopes()` below exists — so a
 * short-scoped token is caught at connect time rather than at publish time.
 *
 * The `*_secret` variants are still excluded: they grant access to secret
 * boards, which this app has no reason to touch.
 */
export const PINTEREST_SCOPES = [
  "boards:read", "boards:write", "pins:read", "pins:write", "user_accounts:read",
] as const;

/**
 * Which required scopes a token does NOT have.
 *
 * Pinterest returns the granted scopes on the token response, so this can be
 * checked the moment a connection is made — the alternative is discovering it
 * when a real post fails, publicly and partially, which is exactly what
 * happened.
 */
export function missingScopes(granted: string[] | null): string[] {
  // Unknown grants are not treated as missing: an older connection predates
  // this recording, and warning about something unverifiable would train the
  // operator to ignore the warning.
  if (!granted || granted.length === 0) return [];
  const have = new Set(granted.map((g) => g.trim().toLowerCase()).filter(Boolean));
  return PINTEREST_SCOPES.filter((s) => !have.has(s));
}

/** Pinterest returns scopes space- or comma-separated depending on the call. */
function readScopes(d: Record<string, unknown>): string[] | null {
  const raw = typeof d.scope === "string" ? d.scope : "";
  if (!raw.trim()) return null;
  return raw.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
}

export function pinterestConfigured(): boolean {
  return Boolean(process.env.PINTEREST_APP_ID && process.env.PINTEREST_APP_SECRET);
}

/** Must match the app profile's registered redirect URI character for character. */
export function pinterestRedirectUri(): string {
  return socialRedirectUri("pinterest");
}

export function pinterestAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.PINTEREST_APP_ID || "",
    redirect_uri: pinterestRedirectUri(),
    response_type: "code",
    scope: PINTEREST_SCOPES.join(","),
    state,
  });
  return `${AUTHORIZE}?${p.toString()}`;
}

function basicAuth(): string {
  const raw = `${process.env.PINTEREST_APP_ID}:${process.env.PINTEREST_APP_SECRET}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

export interface PinterestTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms, or null when Pinterest did not say. */
  expiresAt: number | null;
  /** What Pinterest actually granted, which is not always what was asked for. */
  scopes: string[] | null;
}

function readTokens(d: Record<string, unknown>): PinterestTokens | null {
  const accessToken = typeof d.access_token === "string" ? d.access_token : "";
  if (!accessToken) return null;
  const expiresIn = typeof d.expires_in === "number" ? d.expires_in : null;
  return {
    accessToken,
    refreshToken: typeof d.refresh_token === "string" ? d.refresh_token : null,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    scopes: readScopes(d),
  };
}

/** Exchange the authorization code. Returns null on any failure. */
export async function pinterestExchangeCode(code: string): Promise<PinterestTokens | null> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      // Identical to the value sent on the authorize step, as Pinterest requires.
      redirect_uri: pinterestRedirectUri(),
      continuous_refresh: "true",
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  return readTokens((await res.json().catch(() => ({}))) as Record<string, unknown>);
}

/**
 * Trade a refresh token for a fresh access token.
 *
 * Pinterest access tokens are short-lived, so this runs on every publish where
 * the stored token is at or near expiry. The refresh token itself is long-lived
 * under `continuous_refresh`, but Pinterest may return a new one — so a caller
 * must persist whatever comes back rather than assume the old one still applies.
 */
export async function pinterestRefresh(refreshToken: string): Promise<PinterestTokens | null> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      continuous_refresh: "true",
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const t = readTokens((await res.json().catch(() => ({}))) as Record<string, unknown>);
  // A refresh response often omits the refresh token and the scope list; keep
  // whatever we already knew rather than recording a false "no scopes".
  return t ? { ...t, refreshToken: t.refreshToken ?? refreshToken } : null;
}

export interface PinterestBoard {
  id: string;
  name: string;
}

/** The boards this token can pin to. */
export async function pinterestBoards(accessToken: string): Promise<PinterestBoard[]> {
  const res = await fetch("https://api.pinterest.com/v5/boards?page_size=100", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res?.ok) return [];
  const d = (await res.json().catch(() => ({}))) as { items?: { id?: string; name?: string }[] };
  return (d.items ?? [])
    .filter((b): b is { id: string; name: string } => Boolean(b.id && b.name))
    .map((b) => ({ id: b.id, name: b.name }));
}

/** The account username, for labelling the connection. */
export async function pinterestUsername(accessToken: string): Promise<string | null> {
  const res = await fetch("https://api.pinterest.com/v5/user_account", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const d = (await res.json().catch(() => ({}))) as { username?: string };
  return d.username ?? null;
}

// ─── The stored credential blob ──────────────────────────────────────────────
//
// `ProviderCredentials` carries only `accessToken`, so — exactly as TikTok and
// YouTube already do — everything needed to keep the connection alive travels as
// JSON inside that one field. The alternative is widening a shared type for one
// provider's benefit, which is what the adapter boundary exists to avoid.

export interface PinterestCreds {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number | null;
  /** Granted scopes, recorded so a short-scoped token is visible before it fails. */
  scopes: string[] | null;
}

export function serialiseCreds(t: PinterestTokens): string {
  return JSON.stringify({
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    expiresAt: t.expiresAt,
    scopes: t.scopes,
  } satisfies PinterestCreds);
}

/** Tolerates the legacy shape: a bare token string rather than a blob. */
export function parseCreds(raw: string): PinterestCreds {
  try {
    const d = JSON.parse(raw) as Partial<PinterestCreds>;
    if (typeof d.accessToken === "string") {
      return {
        accessToken: d.accessToken,
        refreshToken: typeof d.refreshToken === "string" ? d.refreshToken : null,
        expiresAt: typeof d.expiresAt === "number" ? d.expiresAt : null,
        scopes: Array.isArray(d.scopes) ? d.scopes.map(String) : null,
      };
    }
  } catch {
    /* not JSON — treat the whole value as the token */
  }
  return { accessToken: raw, refreshToken: null, expiresAt: null, scopes: null };
}

/** Refresh a minute early, so a token cannot expire mid-request. */
const SKEW_MS = 60_000;

/**
 * A usable access token, refreshing first when the stored one is spent.
 *
 * Returns the new blob in `updated` when a refresh happened, so the caller can
 * persist it — the same `updatedAccessToken` path TikTok uses. Without that the
 * refresh works once per publish and is thrown away, which reads as "it works"
 * right up until the refresh token is the thing that rotates.
 */
export async function pinterestAccessToken(
  raw: string,
): Promise<{ token: string | null; scopes: string[] | null; updated?: string }> {
  const creds = parseCreds(raw);
  const expired = creds.expiresAt !== null && Date.now() >= creds.expiresAt - SKEW_MS;
  if (!expired || !creds.refreshToken) {
    return { token: creds.accessToken || null, scopes: creds.scopes };
  }

  const fresh = await pinterestRefresh(creds.refreshToken);
  if (!fresh) return { token: null, scopes: creds.scopes };

  // Carry the known scopes forward. A refresh response usually omits `scope`,
  // and writing that absence back would erase the record and silently disable
  // the very check that catches a short-scoped token.
  const scopes = fresh.scopes ?? creds.scopes;
  return { token: fresh.accessToken, scopes, updated: serialiseCreds({ ...fresh, scopes }) };
}
