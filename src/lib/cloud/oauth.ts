import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import { provider } from "./providers";
import { saveConnection } from "./store";
import { addDefaultTarget } from "./routing";
import type { CloudProviderId } from "./types";

// OAuth for Cloud storage connections. start → provider consent → callback (same browser session).
// CSRF: a random state in an httpOnly cookie, bound to the provider it was issued for.
const STATE = (p: CloudProviderId) => `cs_state_${p}`; // one per provider: two tabs connecting different services both work
const PAGE = "/account/storage";
const cookie = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: "/" };

const base = () => process.env.NEXT_PUBLIC_APP_URL ?? "https://www.clipwaltz.com";
export const redirectUri = (p: CloudProviderId) => `${base()}${provider(p).redirectPath}`;
// Built on the canonical www. origin, not req.url (behind the tunnel that can be the bare apex host).
const back = (_req: NextRequest, p: CloudProviderId, result: string) => new URL(`${PAGE}?provider=${p}&result=${result}`, base());

export async function startCloudOAuth(req: NextRequest, p: CloudProviderId) {
  try {
    await requireUserId();
  } catch {
    return NextResponse.redirect(new URL(`/sign-in?redirect=${encodeURIComponent(PAGE)}`, base()));
  }
  if (!provider(p).configured()) return NextResponse.redirect(back(req, p, "unavailable"));
  console.log(`[cloud] ${p} connect started`);
  const state = randomUUID();
  const res = NextResponse.redirect(provider(p).authUrl(state, redirectUri(p)));
  res.cookies.set(STATE(p), `${p}:${state}`, cookie);
  return res;
}

/** True when this callback belongs to a Cloud storage connect (shares Google's Drive redirect URI). */
export const isCloudCallback = (req: NextRequest) =>
  req.cookies.get(STATE("google_drive"))?.value === `google_drive:${req.nextUrl.searchParams.get("state")}`;

export async function finishCloudOAuth(req: NextRequest, p: CloudProviderId) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    console.warn(`[cloud] ${p} callback without a session → sign-in`);
    return NextResponse.redirect(new URL("/sign-in", base()));
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = req.cookies.get(STATE(p))?.value;
  const done = (result: string, why = "") => {
    // Every outcome is logged (never the code or tokens) so a failed connect can be traced from pm2 logs.
    console.log(`[cloud] ${p} connect ${result}${why ? ` — ${why}` : ""} (user ${userId})`);
    const res = NextResponse.redirect(back(req, p, result));
    res.cookies.delete(STATE(p));
    return res;
  };
  if (url.searchParams.get("error")) return done("cancelled", String(url.searchParams.get("error")).slice(0, 80));
  if (!code || !state) return done("error", "no code/state in the callback");
  if (expected !== `${p}:${state}`) return done("error", expected ? "state mismatch" : "state cookie missing");
  try {
    const tokens = await provider(p).exchange(code, redirectUri(p));
    const label = await provider(p).whoAmI(tokens.accessToken).catch(() => null);
    await saveConnection(userId, p, tokens, label);
    await addDefaultTarget(userId, p);
  } catch (e) {
    return done("error", (e as Error).message.slice(0, 200));
  }
  return done("connected");
}
