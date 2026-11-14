import { socialRedirectUri } from "../app-url";
// LinkedIn OAuth 2.0 (Authorization Code) + org lookup for Community Management.
//
// STAGED — end-to-end verification is blocked until the app's "Community
// Management API" product is approved (the scopes below aren't grantable before
// then). The flow itself is the standard LinkedIn authcode exchange.

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const API = "https://api.linkedin.com/rest";

// Community Management scopes: post to an org + read the orgs you administer.
export const LINKEDIN_SCOPES = [
  "w_organization_social",
  "r_organization_social",
  "rw_organization_admin",
];

export function linkedinConfigured(): boolean {
  return Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
}

function redirectUri(): string {
  return socialRedirectUri("linkedin");
}

export function buildAuthUrl(state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID || "",
    redirect_uri: redirectUri(),
    state,
    scope: LINKEDIN_SCOPES.join(" "),
  });
  return `${AUTH_URL}?${p.toString()}`;
}

export interface LinkedInToken {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string | null;
}

export async function exchangeCode(code: string): Promise<LinkedInToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: process.env.LINKEDIN_CLIENT_ID || "",
    client_secret: process.env.LINKEDIN_CLIENT_SECRET || "",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LinkedIn token exchange failed (HTTP ${res.status}): ${t.slice(0, 200)}`);
  }
  const d = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token ?? null,
    expiresIn: d.expires_in ?? null,
    scope: d.scope ?? null,
  };
}

/** Refresh a LinkedIn token using its refresh token (if the app has refresh enabled). */
export async function refreshLinkedInToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number | null } | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.LINKEDIN_CLIENT_ID || "",
      client_secret: process.env.LINKEDIN_CLIENT_SECRET || "",
    }),
  });
  if (!res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!d.access_token) return null;
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token ?? refreshToken,
    expiresIn: d.expires_in ?? null,
  };
}

/** Fetch the first organization the token holder administers → its numeric id + name. */
export async function fetchPrimaryOrg(
  accessToken: string,
  version: string
): Promise<{ id: string; name: string | null } | null> {
  const res = await fetch(
    `${API}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "LinkedIn-Version": version,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    }
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { elements?: { organization?: string }[] };
  const urn = d.elements?.[0]?.organization; // "urn:li:organization:1234567"
  if (!urn) return null;
  const id = urn.split(":").pop() || null;
  if (!id) return null;

  // Best-effort display name.
  let name: string | null = null;
  try {
    const orgRes = await fetch(`${API}/organizations/${id}?fields=localizedName`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "LinkedIn-Version": version,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    if (orgRes.ok) {
      const o = (await orgRes.json()) as { localizedName?: string };
      name = o.localizedName ?? null;
    }
  } catch {
    /* name is optional */
  }
  return { id, name };
}
