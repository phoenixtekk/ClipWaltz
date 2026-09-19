import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, schema } from "@/db";

// Google Drive backup — a separate OAuth connection (provider "google_drive") from the
// Photos import, using the least-privilege drive.file scope (ClipWaltz only ever sees the
// files it creates). Reuses the same GOOGLE_CLIENT_ID/SECRET.
const PROVIDER = "google_drive";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const FOLDER_NAME = "ClipWaltz";

const clientId = () => process.env.GOOGLE_CLIENT_ID ?? "";
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET ?? "";
export function driveConfigured() {
  return !!clientId() && !!clientSecret();
}
export function driveRedirectUri() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.clipwaltz.com";
  return `${base}/api/oauth/google/drive/callback`;
}
export function driveAuthUrl(state: string) {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: driveRedirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `${AUTH}?${p.toString()}`;
}

type TokenResp = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

export async function exchangeDriveCode(code: string): Promise<TokenResp> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: driveRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  return (await res.json()) as TokenResp;
}

export async function upsertDriveTokens(userId: string, t: TokenResp) {
  const expiresAt = t.expires_in ? new Date(Date.now() + (t.expires_in - 60) * 1000) : null;
  const [existing] = await db
    .select({ id: schema.oauthAccounts.id, refreshToken: schema.oauthAccounts.refreshToken })
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.provider, PROVIDER)));
  if (existing) {
    await db
      .update(schema.oauthAccounts)
      .set({
        accessToken: t.access_token ?? null,
        refreshToken: t.refresh_token ?? existing.refreshToken,
        expiresAt,
        scope: t.scope ?? SCOPE,
        updatedAt: new Date(),
      })
      .where(eq(schema.oauthAccounts.id, existing.id));
  } else {
    await db.insert(schema.oauthAccounts).values({
      id: randomUUID(),
      userId,
      provider: PROVIDER,
      accessToken: t.access_token ?? null,
      refreshToken: t.refresh_token ?? null,
      expiresAt,
      scope: t.scope ?? SCOPE,
    });
  }
}

export async function hasDriveConnection(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.oauthAccounts.id })
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.provider, PROVIDER)));
  return !!row;
}

export async function disconnectDrive(userId: string) {
  await db
    .delete(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.provider, PROVIDER)));
}

/** A valid Drive access token, refreshing if expired. Throws if not connected. */
export async function driveAccessToken(userId: string): Promise<string> {
  const [row] = await db
    .select()
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.provider, PROVIDER)));
  if (!row) throw new Error("Google Drive not connected");
  if (row.accessToken && row.expiresAt && row.expiresAt.getTime() > Date.now()) return row.accessToken;
  if (!row.refreshToken) throw new Error("Drive session expired — reconnect");
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: row.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const t = (await res.json()) as TokenResp;
  if (!t.access_token) throw new Error("Drive token refresh failed");
  const expiresAt = t.expires_in ? new Date(Date.now() + (t.expires_in - 60) * 1000) : null;
  await db
    .update(schema.oauthAccounts)
    .set({ accessToken: t.access_token, expiresAt, updatedAt: new Date() })
    .where(eq(schema.oauthAccounts.id, row.id));
  return t.access_token;
}

/** Find or create the "ClipWaltz" folder in the user's Drive; returns its id. */
export async function ensureClipWaltzFolder(token: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const find = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (find.ok) {
    const j = await find.json();
    if (j.files?.[0]?.id) return j.files[0].id as string;
  }
  const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!create.ok) throw new Error(`Drive folder create failed: ${create.status}`);
  return (await create.json()).id as string;
}

/** Upload bytes to the given Drive folder (multipart). Returns the new file id. */
export async function uploadToDrive(
  token: string,
  folderId: string,
  name: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const boundary = `cw${randomUUID().replace(/-/g, "")}`;
  const meta = JSON.stringify({ name, parents: [folderId] });
  const enc = new TextEncoder();
  const pre = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const post = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(pre.length + bytes.length + post.length);
  body.set(pre, 0);
  body.set(bytes, pre.length);
  body.set(post, pre.length + bytes.length);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id as string;
}
