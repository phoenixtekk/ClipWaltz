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
  /^\/community(?:\/|$)/, // public community feed
  /^\/feed(?:\/|$)/, // legacy → redirects to /community
  /^\/w\/[^/]+$/, // public watch page
  /^\/api\/renders\/[^/]+\/watch(?:\/|$)/, // public shared-render stream
  /^\/api\/auth(?:\/|$)/,
  /^\/api\/billing\/webhook(?:\/|$)/, // Stripe posts here with no cookie
  /^\/api\/oauth\/microsoft\/callback(?:\/|$)/, // OneDrive.js picker redirect (SDK loader)
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
