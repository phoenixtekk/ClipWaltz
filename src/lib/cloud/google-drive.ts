import type { CloudProvider, Tokens } from "./types";

// Google Drive with the drive.file scope: ClipWaltz only sees the files and folders it creates. Shares the
// "google_drive" connection (and its registered redirect URI) with the editor's Drive backup (src/lib/drive.ts).
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const CHUNK = 16 * 1024 * 1024; // a multiple of Drive's required 256 KiB

const clientId = () => process.env.GOOGLE_CLIENT_ID ?? "";
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET ?? "";

type TokenResp = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
const toTokens = (t: TokenResp): Tokens => {
  if (!t.access_token) throw new Error(t.error_description || t.error || "Google sign-in failed");
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresIn: t.expires_in ?? null, scope: t.scope ?? SCOPE };
};
const form = (body: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body),
});
const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function folderId(token: string, parent: string, name: string): Promise<string> {
  const query = `name='${q(name)}' and mimeType='${FOLDER}' and '${parent}' in parents and trashed=false`;
  const find = await fetch(`${API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (find.ok) {
    const j = (await find.json()) as { files?: { id: string }[] };
    if (j.files?.[0]?.id) return j.files[0].id;
  }
  const res = await fetch(`${API}/files?fields=id`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
  });
  if (!res.ok) throw new Error(`Google Drive couldn't create the folder “${name}” (${res.status})`);
  return ((await res.json()) as { id: string }).id;
}

export const googleDrive: CloudProvider = {
  id: "google_drive",
  configured: () => !!clientId() && !!clientSecret(),
  redirectPath: "/api/oauth/google/drive/callback",
  authUrl: (state, redirectUri) =>
    `${AUTH}?${new URLSearchParams({
      client_id: clientId(), redirect_uri: redirectUri, response_type: "code", scope: SCOPE,
      access_type: "offline", include_granted_scopes: "true", prompt: "consent", state,
    })}`,
  async exchange(code, redirectUri) {
    const res = await fetch(TOKEN, form({ code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: redirectUri, grant_type: "authorization_code" }));
    return toTokens((await res.json()) as TokenResp);
  },
  async refresh(refreshToken) {
    const res = await fetch(TOKEN, form({ client_id: clientId(), client_secret: clientSecret(), refresh_token: refreshToken, grant_type: "refresh_token" }));
    return toTokens((await res.json()) as TokenResp);
  },
  async whoAmI(token) {
    const res = await fetch(`${API}/about?fields=user(emailAddress,displayName)`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const j = (await res.json()) as { user?: { emailAddress?: string; displayName?: string } };
    return j.user?.emailAddress || j.user?.displayName || null;
  },
  async upload(token, f) {
    let parent = "root";
    for (const name of f.folders) parent = await folderId(token, parent, name);
    const init = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": f.mime, "x-upload-content-length": String(f.size),
      },
      body: JSON.stringify({ name: f.name, parents: [parent] }),
    });
    const session = init.headers.get("location");
    if (!init.ok || !session) throw new Error(`Google Drive upload couldn't start (${init.status})`);
    for (let start = 0; start < f.size; start += CHUNK) {
      const end = Math.min(f.size, start + CHUNK) - 1;
      const bytes = await f.read(start, end);
      const res = await fetch(session, {
        method: "PUT",
        headers: { "content-length": String(bytes.length), "content-range": `bytes ${start}-${end}/${f.size}` },
        body: bytes as unknown as BodyInit,
      });
      if (res.status === 308) continue; // chunk accepted, more to come
      if (!res.ok) throw new Error(`Google Drive upload failed (${res.status})`);
      const j = (await res.json()) as { id: string; webViewLink?: string };
      return { id: j.id, url: j.webViewLink ?? `https://drive.google.com/file/d/${j.id}/view`, path: [...f.folders, f.name].join("/") };
    }
    throw new Error("Google Drive upload ended without a file");
  },
};
