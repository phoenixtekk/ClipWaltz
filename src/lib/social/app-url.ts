// The canonical public origin (always the www. host in production — global canonical-hostname rule). OAuth redirect
// URIs, signed media URLs and webhook status URLs are built on this, never on the request's own host: behind the
// Cloudflare tunnel a request can arrive on the bare apex.
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "https://www.clipwaltz.com").replace(/\/$/, "");
}

/** The single OAuth callback path every provider uses: `${APP_URL}/api/social/oauth/<provider>/callback`. */
export function socialRedirectUri(provider: string): string {
  return `${appUrl()}/api/social/oauth/${provider}/callback`;
}
