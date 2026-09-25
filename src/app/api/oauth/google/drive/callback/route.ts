import { NextResponse, type NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import { exchangeDriveCode, upsertDriveTokens } from "@/lib/drive";

export const runtime = "nodejs";

// Google redirects here after Drive consent (user still carries their session cookie).
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("gd_state")?.value;
  const back = req.cookies.get("gd_return")?.value;
  const returnTo = back && /^\/(?!\/)[\w\-./?=&%]*$/.test(back) ? back : "/projects";
  const to = (result: string) => new URL(`${returnTo}${returnTo.includes("?") ? "&" : "?"}drive=${result}`, req.url);

  if (url.searchParams.get("error") || !code || !state || state !== cookieState) {
    return NextResponse.redirect(to("error"));
  }
  try {
    const tokens = await exchangeDriveCode(code);
    if (!tokens.access_token) throw new Error(tokens.error || "no access token");
    await upsertDriveTokens(userId, tokens);
  } catch {
    return NextResponse.redirect(to("error"));
  }
  const res = NextResponse.redirect(to("connected"));
  res.cookies.delete("gd_state");
  res.cookies.delete("gd_return");
  return res;
}
