import type { CloudProvider, Tokens } from "./types";

// Dropbox: offline access (a long-lived refresh token that doesn't rotate), scopes files.content.write +
// account_info.read (enable both in the app console). Upload sessions (start → append_v2 → finish), sequential.
// Env: DROPBOX_APP_KEY (falls back to the Chooser's NEXT_PUBLIC_DROPBOX_APP_KEY) + DROPBOX_APP_SECRET; redirect URI
// /api/oauth/cloud/dropbox/callback. In an "App folder" app, "/ClipWaltz/…" lands in Apps/<app name>/ClipWaltz/….
const SCOPE = "files.content.write account_info.read";
const CHUNK = 8 * 1024 * 1024; // ≤ 150 MiB per request

const appKey = () => process.env.DROPBOX_APP_KEY || process.env.NEXT_PUBLIC_DROPBOX_APP_KEY || "";
const appSecret = () => process.env.DROPBOX_APP_SECRET ?? "";

type TokenResp = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
const toTokens = (t: TokenResp): Tokens => {
  if (!t.access_token) throw new Error(t.error_description || t.error || "Dropbox sign-in failed");
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresIn: t.expires_in ?? null, scope: t.scope ?? SCOPE };
};
async function token(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: appKey(), client_secret: appSecret(), ...body }),
  });
  return toTokens((await res.json()) as TokenResp);
}
// Dropbox-API-Arg is an HTTP header: non-ASCII must be \uXXXX-escaped.
const arg = (o: unknown) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

async function content(t: string, endpoint: string, a: unknown, body: Uint8Array) {
  const res = await fetch(`https://content.dropboxapi.com/2/files/${endpoint}`, {
    method: "POST",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/octet-stream", "dropbox-api-arg": arg(a) },
    body: body as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`Dropbox ${endpoint} failed (${res.status}) ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

export const dropbox: CloudProvider = {
  id: "dropbox",
  configured: () => !!appKey() && !!appSecret(),
  redirectPath: "/api/oauth/cloud/dropbox/callback",
  authUrl: (state, redirectUri) =>
    `https://www.dropbox.com/oauth2/authorize?${new URLSearchParams({
      client_id: appKey(), response_type: "code", redirect_uri: redirectUri, token_access_type: "offline", scope: SCOPE, state,
    })}`,
  exchange: (code, redirectUri) => token({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),
  async whoAmI(t) {
    // No-argument RPC: only the Authorization header, no body (as in Dropbox's examples).
    const res = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { authorization: `Bearer ${t}` } });
    if (!res.ok) return null;
    const j = (await res.json()) as { email?: string; name?: { display_name?: string } };
    return j.email || j.name?.display_name || null;
  },
  async quota(t) {
    const res = await fetch("https://api.dropboxapi.com/2/users/get_space_usage", { method: "POST", headers: { authorization: `Bearer ${t}` } });
    if (!res.ok) throw new Error(`Dropbox quota ${res.status}`);
    const j = (await res.json()) as { used?: number; allocation?: { ".tag"?: string; allocated?: number; user_within_team_space_allocated?: number } };
    const a = j.allocation ?? {};
    // Team accounts: a per-user cap when set (0 = none), otherwise the team's whole allocation.
    const total = a[".tag"] === "team" && a.user_within_team_space_allocated ? a.user_within_team_space_allocated : a.allocated ?? null;
    return { used: j.used ?? 0, total };
  },
  async upload(t, f) {
    const { session_id } = (await content(t, "upload_session/start", { close: false }, new Uint8Array())) as { session_id: string };
    let offset = 0;
    while (offset < f.size) {
      const end = Math.min(f.size, offset + CHUNK) - 1;
      const bytes = await f.read(offset, end);
      await content(t, "upload_session/append_v2", { cursor: { session_id, offset }, close: end === f.size - 1 }, bytes);
      offset = end + 1;
    }
    const path = `/${[...f.folders, f.name].join("/")}`; // Dropbox creates missing parent folders
    const meta = (await content(t, "upload_session/finish", {
      cursor: { session_id, offset }, commit: { path, mode: "add", autorename: true, mute: false },
    }, new Uint8Array())) as { id: string; path_display?: string };
    // No shared link: that needs sharing.write and makes the file public by default.
    return { id: meta.id, url: null, path: (meta.path_display ?? path).replace(/^\//, "") };
  },
};
