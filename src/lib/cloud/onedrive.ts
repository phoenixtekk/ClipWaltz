import type { CloudProvider, Tokens } from "./types";

// OneDrive (personal + work/school) through Microsoft Graph. Files.ReadWrite is the documented scope for uploads on
// both account types (Files.ReadWrite.AppFolder is documented inconsistently for work accounts). Saves under
// /ClipWaltz/… in the user's OneDrive. Needs a confidential "Web" app registration: MS_CLIENT_ID (falls back to the
// picker's NEXT_PUBLIC_MS_CLIENT_ID) + MS_CLIENT_SECRET, redirect URI /api/oauth/cloud/onedrive/callback.
const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const SCOPE = "offline_access User.Read Files.ReadWrite";
const GRAPH = "https://graph.microsoft.com/v1.0";
const CHUNK = 10 * 1024 * 1024; // 32 × 320 KiB — Graph needs multiples of 320 KiB, < 60 MiB per request

const clientId = () => process.env.MS_CLIENT_ID || process.env.NEXT_PUBLIC_MS_CLIENT_ID || "";
const clientSecret = () => process.env.MS_CLIENT_SECRET ?? "";

type TokenResp = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
const toTokens = (t: TokenResp): Tokens => {
  if (!t.access_token) throw new Error((t.error_description || t.error || "Microsoft sign-in failed").split("\n")[0]);
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresIn: t.expires_in ?? null, scope: t.scope ?? SCOPE };
};
async function token(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), scope: SCOPE, ...body }),
  });
  return toTokens((await res.json()) as TokenResp);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

/** The id of folder `name` under `parentId` (created if missing). */
async function folder(t: string, parentId: string, name: string, retried = false): Promise<string> {
  const list = await fetch(`${GRAPH}/me/drive/items/${parentId}/children?$select=id,name,folder&$top=999`, { headers: auth(t) });
  if (list.ok) {
    const j = (await list.json()) as { value?: { id: string; name: string; folder?: unknown }[] };
    const hit = j.value?.find((v) => v.folder && v.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
  }
  const res = await fetch(`${GRAPH}/me/drive/items/${parentId}/children`, {
    method: "POST",
    headers: { ...auth(t), "content-type": "application/json" },
    body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
  });
  if (res.ok) return ((await res.json()) as { id: string }).id;
  if (res.status === 409 && !retried) return folder(t, parentId, name, true); // created meanwhile — look it up once more
  if (res.status === 409) throw new Error(`OneDrive has an item called “${name}” that isn't a folder`);
  throw new Error(`OneDrive couldn't create the folder “${name}” (${res.status})`);
}

export const oneDrive: CloudProvider = {
  id: "onedrive",
  configured: () => !!clientId() && !!clientSecret(),
  redirectPath: "/api/oauth/cloud/onedrive/callback",
  authUrl: (state, redirectUri) =>
    `${AUTHORITY}/authorize?${new URLSearchParams({
      client_id: clientId(), response_type: "code", redirect_uri: redirectUri, response_mode: "query", scope: SCOPE, state,
    })}`,
  exchange: (code, redirectUri) => token({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),
  async whoAmI(t) {
    const res = await fetch(`${GRAPH}/me?$select=displayName,mail,userPrincipalName`, { headers: auth(t) });
    if (!res.ok) return null;
    const j = (await res.json()) as { displayName?: string; mail?: string; userPrincipalName?: string };
    return j.mail || j.userPrincipalName || j.displayName || null;
  },
  async upload(t, f) {
    const rootRes = await fetch(`${GRAPH}/me/drive/root?$select=id`, { headers: auth(t) });
    if (!rootRes.ok) throw new Error(`OneDrive isn't available for this account (${rootRes.status})`);
    let parent = ((await rootRes.json()) as { id: string }).id;
    for (const name of f.folders) parent = await folder(t, parent, name);
    const init = await fetch(`${GRAPH}/me/drive/items/${parent}:/${encodeURIComponent(f.name)}:/createUploadSession`, {
      method: "POST",
      headers: { ...auth(t), "content-type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }),
    });
    if (!init.ok) throw new Error(`OneDrive upload couldn't start (${init.status})`);
    const { uploadUrl } = (await init.json()) as { uploadUrl: string };
    for (let start = 0; start < f.size; start += CHUNK) {
      const end = Math.min(f.size, start + CHUNK) - 1;
      const bytes = await f.read(start, end);
      // No Authorization header on the upload URL (Graph rejects it there).
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-length": String(bytes.length), "content-range": `bytes ${start}-${end}/${f.size}` },
        body: bytes as unknown as BodyInit,
      });
      if (res.status === 202) continue;
      if (!res.ok) {
        await fetch(uploadUrl, { method: "DELETE" }).catch(() => {});
        throw new Error(`OneDrive upload failed (${res.status})`);
      }
      const j = (await res.json()) as { id: string; name?: string; webUrl?: string };
      return { id: j.id, url: j.webUrl ?? null, path: [...f.folders, j.name ?? f.name].join("/") };
    }
    throw new Error("OneDrive upload ended without a file");
  },
};
