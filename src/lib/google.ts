import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, schema } from "@/db";

// Google cloud import — OAuth + the Google Photos Picker API (session-based; the
// sanctioned way to let users pick their own photos). Scope is read-only picker access.
const SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const PICKER = "https://photospicker.googleapis.com/v1";

function clientId() {
  return process.env.GOOGLE_CLIENT_ID ?? "";
}
function clientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET ?? "";
}
export function googleRedirectUri() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.clipwaltz.com";
  return `${base}/api/oauth/google/callback`;
}
export function googleConfigured() {
  return !!clientId() && !!clientSecret();
}

export function googleAuthUrl(state: string) {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: googleRedirectUri(),
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
  error_description?: string;
};

export async function exchangeGoogleCode(code: string): Promise<TokenResp> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  return (await res.json()) as TokenResp;
}

export async function upsertGoogleTokens(userId: string, t: TokenResp) {
  const expiresAt = t.expires_in ? new Date(Date.now() + (t.expires_in - 60) * 1000) : null;
  const [existing] = await db
    .select({ id: schema.oauthAccounts.id, refreshToken: schema.oauthAccounts.refreshToken })
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.provider, "google")));
  if (existing) {
    await db
      .update(schema.oauthAccounts)
      .set({
        accessToken: t.access_token ?? null,
        // keep the prior refresh token if Google didn't return a new one
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
      provider: "google",
      accessToken: t.access_token ?? null,
      refreshToken: t.refresh_token ?? null,
      expiresAt,
      scope: t.scope ?? SCOPE,
    });
  }
}

export async function hasGoogleConnection(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.oauthAccounts.id })
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.provider, "google")));
  return !!row;
}

/** A valid Google access token for the user, refreshing if expired. Throws if not connected. */
export async function googleAccessToken(userId: string): Promise<string> {
  const [row] = await db
    .select()
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.provider, "google")));
  if (!row) throw new Error("Google account not connected");
  if (row.accessToken && row.expiresAt && row.expiresAt.getTime() > Date.now()) {
    return row.accessToken;
  }
  if (!row.refreshToken) throw new Error("Google session expired — reconnect");
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
  if (!t.access_token) throw new Error("Google token refresh failed");
  const expiresAt = t.expires_in ? new Date(Date.now() + (t.expires_in - 60) * 1000) : null;
  await db
    .update(schema.oauthAccounts)
    .set({ accessToken: t.access_token, expiresAt, updatedAt: new Date() })
    .where(eq(schema.oauthAccounts.id, row.id));
  return t.access_token;
}

// --- Photos Picker API -----------------------------------------------------
export type PickerSession = { id: string; pickerUri: string; mediaItemsSet: boolean };

export async function createPickerSession(token: string): Promise<PickerSession> {
  const res = await fetch(`${PICKER}/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`picker session failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return { id: j.id, pickerUri: j.pickerUri, mediaItemsSet: !!j.mediaItemsSet };
}

export async function getPickerSession(token: string, sessionId: string): Promise<PickerSession> {
  const res = await fetch(`${PICKER}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  const j = await res.json();
  return { id: j.id, pickerUri: j.pickerUri, mediaItemsSet: !!j.mediaItemsSet };
}

export type PickedItem = { baseUrl: string; mimeType: string; filename: string; isVideo: boolean };

export async function listPickedItems(token: string, sessionId: string): Promise<PickedItem[]> {
  const items: PickedItem[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({ sessionId, pageSize: "100" });
    if (pageToken) p.set("pageToken", pageToken);
    const res = await fetch(`${PICKER}/mediaItems?${p.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`list media failed: ${res.status}`);
    const j = await res.json();
    for (const m of j.mediaItems ?? []) {
      const f = m.mediaFile ?? {};
      items.push({
        baseUrl: f.baseUrl,
        mimeType: f.mimeType ?? "application/octet-stream",
        filename: f.filename ?? `${m.id}`,
        isVideo: (m.type === "VIDEO") || String(f.mimeType ?? "").startsWith("video/"),
      });
    }
    pageToken = j.nextPageToken;
  } while (pageToken);
  return items;
}

export async function downloadPicked(token: string, item: PickedItem): Promise<Uint8Array> {
  // Photos Picker download params: =d for images, =dv for videos.
  const url = `${item.baseUrl}=${item.isVideo ? "dv" : "d"}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
