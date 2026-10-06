import { createHash } from "crypto";
import type { CloudProvider, Tokens } from "./types";

// Box: OAuth 2.0 "User" app (BOX_CLIENT_ID / BOX_CLIENT_SECRET, scope root_readwrite, redirect URI
// /api/oauth/cloud/box/callback). Refresh tokens are SINGLE-USE — every refresh returns a new one, which the store
// saves (store.ts accessToken() refreshes one at a time per connection). Files < 20 MB go up in one request; larger
// ones use a chunked upload session (parts of the session's part_size, each with its SHA-1, then a commit).
const API = "https://api.box.com/2.0";
const UPLOAD = "https://upload.box.com/api/2.0";
const CHUNKED_MIN = 20 * 1024 * 1024;

const clientId = () => process.env.BOX_CLIENT_ID ?? "";
const clientSecret = () => process.env.BOX_CLIENT_SECRET ?? "";

type TokenResp = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
const toTokens = (t: TokenResp): Tokens => {
  if (!t.access_token) throw new Error(t.error_description || t.error || "Box sign-in failed");
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresIn: t.expires_in ?? null, scope: "root_readwrite" };
};
async function token(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${API.replace("/2.0", "")}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...body }),
  });
  return toTokens((await res.json()) as TokenResp);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const sha1 = (b: Uint8Array) => createHash("sha1").update(b).digest("base64");

/** The id of folder `name` in `parentId` (created if missing; Box names are case-insensitive). */
async function folder(t: string, parentId: string, name: string): Promise<string> {
  const res = await fetch(`${API}/folders`, {
    method: "POST",
    headers: { ...auth(t), "content-type": "application/json" },
    body: JSON.stringify({ name, parent: { id: parentId } }),
  });
  if (res.ok) return ((await res.json()) as { id: string }).id;
  if (res.status !== 409) throw new Error(`Box couldn't create the folder “${name}” (${res.status})`);
  for (let offset = 0; offset < 10000; offset += 1000) {
    const list = await fetch(`${API}/folders/${parentId}/items?fields=name,type&limit=1000&offset=${offset}`, { headers: auth(t) });
    if (!list.ok) break;
    const j = (await list.json()) as { entries?: { id: string; type: string; name: string }[]; total_count?: number };
    const hit = j.entries?.find((e) => e.type === "folder" && e.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    if (!j.entries?.length || offset + 1000 >= (j.total_count ?? 0)) break;
  }
  throw new Error(`Box has an item called “${name}” that isn't a folder`);
}

/** “Name.mp4” → “Name (2).mp4” … for name clashes. */
const variantName = (name: string, n: number) => (n < 2 ? name : name.replace(/(\.[^.]+)?$/, (ext) => ` (${n})${ext}`));

async function uploadSmall(t: string, parent: string, name: string, bytes: Uint8Array) {
  for (let n = 1; n <= 20; n++) {
    const fd = new FormData();
    fd.append("attributes", JSON.stringify({ name: variantName(name, n), parent: { id: parent } }));
    fd.append("file", new Blob([bytes as unknown as BlobPart]), variantName(name, n));
    const res = await fetch(`${UPLOAD}/files/content`, { method: "POST", headers: auth(t), body: fd });
    if (res.status === 409) continue;
    if (!res.ok) throw new Error(`Box upload failed (${res.status})`);
    const j = (await res.json()) as { entries: { id: string; name: string }[] };
    return j.entries[0];
  }
  throw new Error("Box upload failed: too many files with that name");
}

async function uploadChunked(t: string, parent: string, name: string, size: number, read: (s: number, e: number) => Promise<Uint8Array>) {
  let session: { id: string; part_size: number } | null = null;
  let finalName = name;
  for (let n = 1; n <= 20 && !session; n++) {
    finalName = variantName(name, n);
    const res = await fetch(`${UPLOAD}/files/upload_sessions`, {
      method: "POST",
      headers: { ...auth(t), "content-type": "application/json" },
      body: JSON.stringify({ folder_id: parent, file_size: size, file_name: finalName }),
    });
    if (res.status === 409) continue;
    if (!res.ok) throw new Error(`Box upload couldn't start (${res.status})`);
    session = (await res.json()) as { id: string; part_size: number };
  }
  if (!session) throw new Error("Box upload failed: too many files with that name");
  const whole = createHash("sha1");
  const parts: unknown[] = [];
  for (let start = 0; start < size; start += session.part_size) {
    const end = Math.min(size, start + session.part_size) - 1;
    const bytes = await read(start, end);
    whole.update(bytes);
    const res = await fetch(`${UPLOAD}/files/upload_sessions/${session.id}`, {
      method: "PUT",
      headers: {
        ...auth(t), "content-type": "application/octet-stream",
        digest: `sha=${sha1(bytes)}`, "content-range": `bytes ${start}-${end}/${size}`,
      },
      body: bytes as unknown as BodyInit,
    });
    if (!res.ok) throw new Error(`Box upload failed at ${start} (${res.status})`);
    parts.push(((await res.json()) as { part: unknown }).part);
  }
  const digest = `sha=${whole.digest("base64")}`;
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${UPLOAD}/files/upload_sessions/${session.id}/commit`, {
      method: "POST",
      headers: { ...auth(t), "content-type": "application/json", digest },
      body: JSON.stringify({ parts }),
    });
    if (res.status === 202) { // still assembling the parts — wait as told
      await new Promise((r) => setTimeout(r, Math.min(30, Number(res.headers.get("retry-after")) || 5) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Box upload couldn't finish (${res.status})`);
    return ((await res.json()) as { entries: { id: string; name: string }[] }).entries[0];
  }
  throw new Error("Box took too long to finish the upload");
}

export const box: CloudProvider = {
  id: "box",
  configured: () => !!clientId() && !!clientSecret(),
  redirectPath: "/api/oauth/cloud/box/callback",
  authUrl: (state, redirectUri) =>
    `https://account.box.com/api/oauth2/authorize?${new URLSearchParams({
      client_id: clientId(), response_type: "code", redirect_uri: redirectUri, state,
    })}`,
  exchange: (code, redirectUri) => token({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),
  async whoAmI(t) {
    const res = await fetch(`${API}/users/me?fields=login,name`, { headers: auth(t) });
    if (!res.ok) return null;
    const j = (await res.json()) as { login?: string; name?: string };
    return j.login || j.name || null;
  },
  async upload(t, f) {
    let parent = "0"; // the user's All Files root
    for (const name of f.folders) parent = await folder(t, parent, name);
    const file = f.size < CHUNKED_MIN
      ? await uploadSmall(t, parent, f.name, await f.read(0, f.size - 1))
      : await uploadChunked(t, parent, f.name, f.size, f.read);
    return { id: file.id, url: null, path: [...f.folders, file.name].join("/") };
  },
};
