import { socialRedirectUri } from "../app-url";
// Facebook Login (OAuth 2.0). One authorize → a user token we exchange for a
// long-lived one, then derive Page tokens for every Page the user manages.
// Reuses the app credentials already configured for token refresh.

const V = () => process.env.FACEBOOK_API_VERSION || "v21.0";

export function fbLoginConfigured(): boolean {
  return Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);
}

export function fbRedirectUri(): string {
  return socialRedirectUri("facebook");
}

export function fbAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID || "",
    redirect_uri: fbRedirectUri(),
    state,
    response_type: "code",
    scope: "pages_show_list,pages_manage_posts,pages_read_engagement,pages_read_user_content,instagram_basic,instagram_content_publish,business_management",
  });
  return `https://www.facebook.com/${V()}/dialog/oauth?${p.toString()}`;
}

/** Exchange an authorization code for a (short-lived) user access token. */
export async function fbExchangeCode(code: string): Promise<string | null> {
  const p = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID || "",
    client_secret: process.env.FACEBOOK_APP_SECRET || "",
    redirect_uri: fbRedirectUri(),
    code,
  });
  const res = await fetch(`https://graph.facebook.com/${V()}/oauth/access_token?${p.toString()}`);
  if (!res.ok) return null;
  const d = (await res.json().catch(() => ({}))) as { access_token?: string };
  return d.access_token ?? null;
}
