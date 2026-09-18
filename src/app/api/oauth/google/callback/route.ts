import { NextResponse, type NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import { exchangeGoogleCode, upsertGoogleTokens } from "@/lib/google";

export const runtime = "nodejs";

// Google redirects here after consent (user still carries their session cookie).
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
  const cookieState = req.cookies.get("g_state")?.value;
  const projectId = req.cookies.get("g_project")?.value || "";
  const back = projectId ? `/projects/${projectId}/import` : "/projects";

  if (url.searchParams.get("error") || !code || !state || state !== cookieState) {
    return NextResponse.redirect(new URL(`${back}?google=error`, req.url));
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    if (!tokens.access_token) throw new Error(tokens.error_description || "no access token");
    await upsertGoogleTokens(userId, tokens);
  } catch {
    return NextResponse.redirect(new URL(`${back}?google=error`, req.url));
  }

  const res = NextResponse.redirect(new URL(`${back}?google=connected`, req.url));
  res.cookies.delete("g_state");
  res.cookies.delete("g_project");
  return res;
}
