import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import { provider } from "./providers";
import { saveConnection } from "./store";
import type { CloudProviderId } from "./types";

// OAuth for Cloud storage connections. start → provider consent → callback (same browser session).
// CSRF: a random state in an httpOnly cookie, bound to the provider it was issued for.
const STATE = "cs_state";
const PAGE = "/account/storage";
const cookie = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: "/" };

const base = () => process.env.NEXT_PUBLIC_APP_URL ?? "https://www.clipwaltz.com";
export const redirectUri = (p: CloudProviderId) => `${base()}${provider(p).redirectPath}`;
const back = (req: NextRequest, p: CloudProviderId, result: string) => new URL(`${PAGE}?provider=${p}&result=${result}`, req.url);

export async function startCloudOAuth(req: NextRequest, p: CloudProviderId) {
  try {
    await requireUserId();
  } catch {
    return NextResponse.redirect(new URL(`/sign-in?redirect=${encodeURIComponent(PAGE)}`, req.url));
  }
  if (!provider(p).configured()) return NextResponse.redirect(back(req, p, "unavailable"));
  const state = randomUUID();
  const res = NextResponse.redirect(provider(p).authUrl(state, redirectUri(p)));
  res.cookies.set(STATE, `${p}:${state}`, cookie);
  return res;
}

/** True when this callback belongs to a Cloud storage connect (shares Google's Drive redirect URI). */
export const isCloudCallback = (req: NextRequest) =>
  req.cookies.get(STATE)?.value === `google_drive:${req.nextUrl.searchParams.get("state")}`;

export async function finishCloudOAuth(req: NextRequest, p: CloudProviderId) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = req.cookies.get(STATE)?.value;
  const done = (result: string) => {
    const res = NextResponse.redirect(back(req, p, result));
    res.cookies.delete(STATE);
    return res;
  };
  if (url.searchParams.get("error")) return done("cancelled");
  if (!code || !state || expected !== `${p}:${state}`) return done("error");
  try {
    const tokens = await provider(p).exchange(code, redirectUri(p));
    const label = await provider(p).whoAmI(tokens.accessToken).catch(() => null);
    await saveConnection(userId, p, tokens, label);
  } catch (e) {
    console.error(`[cloud] ${p} connect failed:`, (e as Error).message);
    return done("error");
  }
  return done("connected");
}
