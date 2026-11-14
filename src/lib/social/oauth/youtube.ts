import { socialRedirectUri } from "../app-url";
// YouTube (Google) OAuth 2.0 Authorization Code. Confidential web client, so the
// token exchange uses client_secret. access_type=offline + prompt=consent yields
// a durable refresh token (Google refresh tokens don't rotate).


export function youtubeConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
}

export function youtubeRedirectUri(): string {
  return socialRedirectUri("youtube");
}

export function youtubeAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID || "",
    redirect_uri: youtubeRedirectUri(),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export async function youtubeExchangeCode(code: string): Promise<{ refreshToken: string; accessToken: string } | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.YOUTUBE_CLIENT_ID || "",
      client_secret: process.env.YOUTUBE_CLIENT_SECRET || "",
      redirect_uri: youtubeRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string };
  if (!d.refresh_token || !d.access_token) return null;
  return { refreshToken: d.refresh_token, accessToken: d.access_token };
}
