import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { requireUserId } from "@/lib/auth";
import { driveAuthUrl, driveConfigured } from "@/lib/drive";

export const runtime = "nodejs";

// Begin the Google Drive OAuth (drive.file scope) for cloud backup.
export async function GET(req: NextRequest) {
  try {
    await requireUserId();
  } catch {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  // Return the user to where they started (a same-site path only — no open redirect). The Media
  // Library this used to return to was removed on 2026-09-22.
  const want = req.nextUrl.searchParams.get("returnTo") ?? "";
  const returnTo = /^\/(?!\/)[\w\-./?=&%]*$/.test(want) ? want : "/projects";
  if (!driveConfigured()) {
    return NextResponse.redirect(new URL(`${returnTo}${returnTo.includes("?") ? "&" : "?"}drive=unconfigured`, req.url));
  }
  const state = randomUUID();
  const res = NextResponse.redirect(driveAuthUrl(state));
  res.cookies.set("gd_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  res.cookies.set("gd_return", returnTo, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
