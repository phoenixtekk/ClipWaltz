import { socialRedirectUri } from "../app-url";
// TikTok OAuth 2.0 Authorization Code + PKCE (TikTok recommends PKCE). Uses the
// client_secret for the token exchange. Scope video.upload lets us push videos
// to the user's TikTok drafts.


export function tiktokConfigured(): boolean {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

export function tiktokRedirectUri(): string {
  return socialRedirectUri("tiktok");
}

export function tiktokAuthUrl(state: string, challenge: string): string {
  const p = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY || "",
    redirect_uri: tiktokRedirectUri(),
    response_type: "code",
    scope: "user.info.basic,video.upload",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${p.toString()}`;
}

export async function tiktokExchangeCode(
  code: string,
  verifier: string
): Promise<{ refreshToken: string; accessToken: string; openId: string } | null> {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY || "",
      client_secret: process.env.TIKTOK_CLIENT_SECRET || "",
      code,
      grant_type: "authorization_code",
      redirect_uri: tiktokRedirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; open_id?: string };
  if (!d.refresh_token || !d.access_token) return null;
  return { refreshToken: d.refresh_token, accessToken: d.access_token, openId: d.open_id || "tiktok" };
}
