import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { decryptToken, encryptToken } from "./crypto";
import { CLOUD_PROVIDERS, type CloudProviderId, type FolderLayout, type Tokens } from "./types";
import { provider } from "./providers";

// Cloud storage connections live in oauth_accounts (provider = google_drive | onedrive | dropbox | box).

export type Connection = {
  provider: CloudProviderId;
  accountLabel: string | null;
  autoSave: boolean;
  folderLayout: FolderLayout;
  lastError: string | null;
  connectedAt: string;
};

const expiry = (t: Tokens) => (t.expiresIn ? new Date(Date.now() + (t.expiresIn - 60) * 1000) : null);

export async function listConnections(userId: string): Promise<Connection[]> {
  const rows = await db
    .select()
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.userId, userId), inArray(schema.oauthAccounts.provider, [...CLOUD_PROVIDERS])));
  return rows.map((r) => ({
    provider: r.provider as CloudProviderId,
    accountLabel: r.accountLabel,
    autoSave: r.autoSave,
    folderLayout: (r.folderLayout as FolderLayout) || "category",
    lastError: r.lastError,
    connectedAt: r.createdAt.toISOString(),
  }));
}

/** Store tokens after a successful OAuth exchange (new connection, or a reconnect that clears the error). */
export async function saveConnection(userId: string, p: CloudProviderId, t: Tokens, label: string | null) {
  const [existing] = await db
    .select({ id: schema.oauthAccounts.id, refreshToken: schema.oauthAccounts.refreshToken })
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.provider, p)));
  const values = {
    accessToken: encryptToken(t.accessToken),
    refreshToken: t.refreshToken ? encryptToken(t.refreshToken) : existing?.refreshToken ?? null,
    expiresAt: expiry(t),
    scope: t.scope ?? null,
    accountLabel: label,
    autoSave: true, // connected from Cloud storage → that's what the user is asking for
    lastError: null,
    updatedAt: new Date(),
  };
  if (existing) await db.update(schema.oauthAccounts).set(values).where(eq(schema.oauthAccounts.id, existing.id));
  else await db.insert(schema.oauthAccounts).values({ id: randomUUID(), userId, provider: p, ...values });
}

export async function disconnect(userId: string, p: CloudProviderId) {
  await db.delete(schema.oauthAccounts).where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.provider, p)));
}

export async function updateConnection(userId: string, p: CloudProviderId, patch: { autoSave?: boolean; folderLayout?: FolderLayout; lastError?: string | null }) {
  await db
    .update(schema.oauthAccounts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.provider, p)));
}

// One refresh at a time per connection (two uploads finishing together must not both spend a rotating refresh token).
const refreshing = new Map<string, Promise<string>>();

/** A valid access token, refreshing (and storing a rotated refresh token) when it has expired. */
export async function accessToken(userId: string, p: CloudProviderId): Promise<string> {
  const k = `${userId}:${p}`;
  const inflight = refreshing.get(k);
  if (inflight) return inflight;
  const [row] = await db
    .select()
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.provider, p)));
  if (!row) throw new Error("not connected");
  const current = decryptToken(row.accessToken);
  if (current && row.expiresAt && row.expiresAt.getTime() > Date.now()) return current;
  const rt = decryptToken(row.refreshToken);
  if (!rt) throw new Error("the connection has expired — reconnect it in Cloud storage");
  const job = (async () => {
    let t: Tokens;
    try {
      t = await provider(p).refresh(rt);
    } catch (e) {
      throw new Error(`the connection has expired — reconnect it in Cloud storage (${(e as Error).message})`);
    }
    await db
      .update(schema.oauthAccounts)
      .set({
        accessToken: encryptToken(t.accessToken),
        refreshToken: t.refreshToken ? encryptToken(t.refreshToken) : encryptToken(rt), // re-encrypts legacy plaintext
        expiresAt: expiry(t),
        updatedAt: new Date(),
      })
      .where(eq(schema.oauthAccounts.id, row.id));
    return t.accessToken;
  })();
  refreshing.set(k, job);
  try {
    return await job;
  } finally {
    refreshing.delete(k);
  }
}
