import { createHmac, timingSafeEqual } from "crypto";

// The social OAuth state cookie, sealed with an HMAC so the browser cannot edit it.
//
// It carries the CSRF state, the workspace, and per-flow values the callback trusts: the Mastodon instance the code is
// exchanged against (a server-side request to that host) and the X PKCE verifier. httpOnly stops other sites' scripts
// reading it, but the user's own browser can still rewrite it — e.g. point `instance` at an internal address between
// start and callback. A MAC over the whole value, keyed from the server secret and bound to the provider, makes any edit
// fail verification. Nothing in it is encrypted (none of it is a credential on its own).

const MAX_AGE_SECONDS = 600; // matches the cookie's maxAge

function key(): Buffer {
  const s = process.env.SOCIAL_OAUTH_STATE_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") throw new Error("BETTER_AUTH_SECRET is not set");
    return createHmac("sha256", "dev-social-oauth-state").update("k").digest();
  }
  // Derived, so the auth secret itself never signs anything outside Better Auth.
  return createHmac("sha256", s).update("clipwaltz.social-oauth-state.v1").digest();
}

function mac(provider: string, payload: string): Buffer {
  return createHmac("sha256", key()).update(`${provider}.${payload}`).digest();
}

/** Serialize + sign. The result is cookie-safe (base64url + "." + base64url). */
export function sealState(provider: string, value: object, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ v: value, t: Math.floor(now / 1000) })).toString("base64url");
  return `${payload}.${mac(provider, payload).toString("base64url")}`;
}

/** Verify + parse. Null when missing, malformed, signed for another provider, tampered with, or expired. */
export function openState<T>(provider: string, raw: string | undefined | null, now = Date.now()): T | null {
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot !== raw.lastIndexOf(".")) return null;
  const payload = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1), "base64url");
  const want = mac(provider, payload);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: T; t?: number };
    if (typeof d.t !== "number" || Math.floor(now / 1000) - d.t > MAX_AGE_SECONDS || d.t - Math.floor(now / 1000) > 60) return null;
    return d.v ?? null;
  } catch {
    return null;
  }
}
