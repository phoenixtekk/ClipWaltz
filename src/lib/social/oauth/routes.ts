import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/social/app-url";
import { requireSocial, SocialAccessError } from "@/lib/social/access";
import { listConnectionsForProvider, saveOAuthConnection } from "@/lib/social/connections";
import { assertChannelCapacity, ChannelLimitError } from "@/lib/social/limits";
import { newState, oauthFlow, type FlowExtras } from "./registry";
import { openState, sealState } from "./state-cookie";

// The shared half of the single OAuth start/callback route pair (plan §4.4). Per-provider logic is in ./registry.ts.
//
// CSRF: a random state in an httpOnly cookie bound to the provider it was issued for (one cookie per provider, so two
// tabs connecting different networks both work — the pattern of src/lib/cloud/oauth.ts). The cookie also carries the
// workspace the connect was started for and per-flow values (PKCE verifier, Mastodon instance); none are secrets on
// their own, but the callback trusts them, so the cookie is HMAC-sealed (./state-cookie.ts) and an edited cookie is
// treated as missing. The workspace role is checked again at the callback: an admin demoted mid-flow cannot finish it.

const PAGE = "/publish/networks"; // the Networks page (built in P2)
const COOKIE = (p: string) => `social_oauth_${p}`;
const cookieOpts = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: "/" };

interface StateCookie {
  s: string; // state
  w: string; // workspace id
  x?: FlowExtras;
}

function back(provider: string, result: string, params: Record<string, string> = {}): URL {
  const u = new URL(PAGE, appUrl());
  u.searchParams.set("provider", provider);
  u.searchParams.set("result", result);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
}

function signIn(): NextResponse {
  return NextResponse.redirect(new URL(`/sign-in?redirect=${encodeURIComponent(PAGE)}`, appUrl()));
}

/** GET /api/social/oauth/<provider>/start?workspace=<id>[&instance=<mastodon host>] */
export async function startSocialOAuth(req: NextRequest, provider: string): Promise<Response> {
  const flow = oauthFlow(provider);
  if (!flow) return new NextResponse("not found", { status: 404 });

  let workspaceId: string;
  try {
    ({ workspaceId } = await requireSocial(req.nextUrl.searchParams.get("workspace"), "admin"));
  } catch (e) {
    if (e instanceof SocialAccessError && e.status === 401) return signIn();
    return NextResponse.redirect(back(provider, "forbidden"));
  }
  if (!flow.configured()) return NextResponse.redirect(back(provider, "not_configured"));

  // Refuse up front when the plan has no room, rather than after the user has been through the consent screen.
  try {
    await assertChannelCapacity(workspaceId, 1);
  } catch (e) {
    if (e instanceof ChannelLimitError) return NextResponse.redirect(back(provider, "limit"));
    throw e;
  }

  const state = newState();
  let url: string;
  let extras: FlowExtras | undefined;
  try {
    ({ url, extras } = await flow.start({ state, query: req.nextUrl.searchParams }));
  } catch (e) {
    return NextResponse.redirect(back(provider, "error", { reason: (e as Error).message.slice(0, 80) }));
  }
  console.log(`[social] ${provider} connect started (workspace ${workspaceId})`);
  const res = NextResponse.redirect(url);
  res.cookies.set(COOKIE(provider), sealState(provider, { s: state, w: workspaceId, x: extras } satisfies StateCookie), cookieOpts);
  return res;
}

/** GET /api/social/oauth/<provider>/callback?code&state — the redirect URI registered with every provider. */
export async function finishSocialOAuth(req: NextRequest, provider: string): Promise<Response> {
  const flow = oauthFlow(provider);
  if (!flow) return new NextResponse("not found", { status: 404 });

  const saved = openState<StateCookie>(provider, req.cookies.get(COOKIE(provider))?.value);
  const done = (result: string, why = "", params: Record<string, string> = {}) => {
    // Every outcome is logged (never the code or tokens) so a failed connect can be traced from pm2 logs.
    console.log(`[social] ${provider} connect ${result}${why ? ` — ${why}` : ""}`);
    const res = NextResponse.redirect(back(provider, result, params));
    res.cookies.delete(COOKIE(provider));
    return res;
  };

  const url = req.nextUrl;
  if (url.searchParams.get("error")) return done("cancelled", String(url.searchParams.get("error")).slice(0, 80));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return done("error", "no code/state in the callback");
  if (!saved || typeof saved.s !== "string" || typeof saved.w !== "string" || saved.s !== state) {
    return done("error", saved ? "state mismatch" : "state cookie missing or invalid");
  }

  let ctx;
  try {
    ctx = await requireSocial(saved.w, "admin");
  } catch (e) {
    if (e instanceof SocialAccessError && e.status === 401) return signIn();
    return done("forbidden", (e as Error).message);
  }

  let outcome;
  try {
    outcome = await flow.finish({ code, extras: saved.x ?? {} });
  } catch (e) {
    const msg = (e as Error).message || "error";
    // Pinterest's short-grant check reports which scopes were missing.
    if (msg.startsWith("pinterest_scopes:")) return done("pinterest_scopes", msg, { missing: msg.slice(17) });
    return done("error", msg.slice(0, 200), { reason: msg.slice(0, 80) });
  }

  // Save each connection: an account already connected in this workspace is updated in place (and costs no channel);
  // a new one needs room in the plan. A Facebook login that returns more Pages than fit saves what fits and says so.
  const ids: string[] = [];
  let limited = false;
  for (const c of outcome.connections) {
    const existing = await listConnectionsForProvider(c.provider, ctx.workspaceId);
    const known = c.data.externalId ? existing.some((e) => e.externalId === c.data.externalId) : false;
    if (!known) {
      try {
        await assertChannelCapacity(ctx.workspaceId, 1);
      } catch (e) {
        if (e instanceof ChannelLimitError) {
          limited = true;
          continue;
        }
        throw e;
      }
    }
    ids.push(await saveOAuthConnection(c.provider, c.data, ctx.workspaceId, ctx.userId));
  }
  if (ids.length === 0 && limited) return done("limit", "plan channel limit");
  const params: Record<string, string> = { ...(outcome.params ?? {}) };
  if (outcome.result === "choose_board" && ids[0]) params.connection = ids[0];
  if (limited) params.limited = "1";
  return done(outcome.result, `${ids.length} saved (workspace ${ctx.workspaceId})`, params);
}
