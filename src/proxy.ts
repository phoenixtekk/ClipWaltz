import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Routes reachable without authentication. EDIT for your app.
// /api/auth/* and the auth pages must stay public.
const PUBLIC_PATHS = [
  /^\/$/,
  /^\/sign-in(?:\/|$)/,
  /^\/sign-up(?:\/|$)/,
  /^\/forgot-password(?:\/|$)/,
  /^\/reset-password(?:\/|$)/,
  /^\/terms(?:\/|$)/,
  /^\/privacy(?:\/|$)/,
  /^\/refund(?:\/|$)/,
  /^\/help(?:\/|$)/, // in-app Help Center
  /^\/setup-guide(?:\/|$)/, // public "connect a network" guide (Social Publishing)
  /^\/r\/[A-Za-z0-9_-]+$/, // public read-only review link for a social post (404 unless the owner shared it)
  /^\/community(?:\/|$)/, // public community feed
  /^\/feed(?:\/|$)/, // legacy → redirects to /community
  /^\/w\/[^/]+$/, // public watch page
  /^\/u\/[^/]+$/, // public creator profile
  /^\/api\/renders\/[^/]+\/watch(?:\/|$)/, // public shared-render stream
  /^\/c\/[^/]+(?:\/go|\/leaving)?$/, // WaltzDeck campaign variant landing page, CTA redirect, leaving page (404 unless shared)
  /^\/api\/c\/[^/]+\/event$/, // campaign variant audience beacon
  /^\/voices\/[a-z_]+\.mp3$/, // WaltzDeck voice previews (static files in public/voices)
  /^\/api\/auth(?:\/|$)/,
  /^\/api\/billing\/webhook(?:\/|$)/, // Stripe posts here with no cookie
  /^\/api\/internal\/render-ready(?:\/|$)/, // worker callback (shared-secret gated)
  /^\/api\/internal\/retention(?:\/|$)/, // worker-triggered retention (shared-secret gated)
  /^\/api\/oauth\/microsoft\/callback(?:\/|$)/, // OneDrive.js picker redirect (SDK loader)
  /^\/api\/connector\/(?:pair\/(?:start|poll)|hello|jobs\/next|jobs\/[^/]+\/(?:result|output|progress|input\/[a-z0-9_-]+))$/, // ClipWaltz Connector (bearer-token / device-code gated)
  /^\/connector\/[a-z0-9.-]+$/, // Connector program download (public/connector)
  /^\/api\/social\/media\/public\/[a-f0-9-]{36}$/, // signed media URLs fetched by Threads/Instagram/TikTok (HMAC-gated)
  /^\/api\/social\/webhooks\/threads\/(?:deauthorize|delete)$/, // Meta's servers (signed_request-gated)
];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Canonical host: apex → www (standing rule). www.clipwaltz.com is canonical.
  // Behind the Cloudflare tunnel the real hostname arrives as x-forwarded-host.
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").toLowerCase();
  if (host === "clipwaltz.com") {
    return NextResponse.redirect(
      `https://www.clipwaltz.com${pathname}${req.nextUrl.search}`,
      308,
    );
  }

  if (PUBLIC_PATHS.some((re) => re.test(pathname))) return NextResponse.next();

  // Optimistic cookie check for routing; server components re-validate the session.
  const cookie = getSessionCookie(req);
  if (!cookie) {
    const url = new URL("/sign-in", req.url);
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|gif|png|svg|ico|webp|avif|woff2?|ttf|otf|map)).*)",
    "/(api|trpc)(.*)",
  ],
};
