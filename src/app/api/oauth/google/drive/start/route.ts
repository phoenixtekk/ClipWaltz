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
  if (!driveConfigured()) {
    return NextResponse.redirect(new URL("/library?drive=unconfigured", req.url));
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
  return res;
}
