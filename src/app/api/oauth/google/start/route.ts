import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { requireUserId } from "@/lib/auth";
import { googleAuthUrl, googleConfigured } from "@/lib/google";

export const runtime = "nodejs";

// Begin Google OAuth: stash CSRF state + the project to return to, then redirect to consent.
export async function GET(req: NextRequest) {
  try {
    await requireUserId();
  } catch {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/projects?google=unconfigured", req.url));
  }
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const state = randomUUID();
  const res = NextResponse.redirect(googleAuthUrl(state));
  const opts = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: "/" };
  res.cookies.set("g_state", state, opts);
  res.cookies.set("g_project", projectId, opts);
  return res;
}
