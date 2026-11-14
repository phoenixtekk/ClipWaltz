import { socialRedirectUri } from "../app-url";
import crypto from "crypto";

// X (Twitter) OAuth 2.0 Authorization Code + PKCE. Confidential client (the app
// has a secret), so the token exchange uses HTTP Basic auth. Scopes include
// offline.access so we receive a refresh token.

export function xConfigured(): boolean {
  return Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
}

export function xRedirectUri(): string {
  return socialRedirectUri("x");
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function xAuthUrl(state: string, challenge: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID || "",
    redirect_uri: xRedirectUri(),
    scope: "tweet.read tweet.write users.read offline.access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://twitter.com/i/oauth2/authorize?${p.toString()}`;
}

/** Exchange an authorization code for tokens. */
export async function xExchangeCode(code: string, verifier: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  const cid = process.env.X_CLIENT_ID || "";
  const csec = process.env.X_CLIENT_SECRET || "";
  const basic = Buffer.from(`${cid}:${csec}`).toString("base64");
  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: xRedirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string };
  if (!d.access_token || !d.refresh_token) return null;
  return { accessToken: d.access_token, refreshToken: d.refresh_token };
}
