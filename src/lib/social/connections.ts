import { randomUUID } from "crypto";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { decryptToken, encryptToken } from "@/lib/cloud/crypto";
import { listProviders } from "@/lib/social/publishing";
import type { ProviderId } from "@/lib/social/publishing/types";

// ─── Connections are PRIVATE to the workspace that made them ─────────────────
//
// Ported from SP `src/lib/connections.ts`. History that still applies:
//
// Until 2026-09-14 SP's `social_connection` had no owner column: every signed-in account shared one global set of
// connected networks, so any user could see every connected channel on the installation, publish through it, and
// disconnect it. SP fixed that by scoping every read and write by user. ClipWaltz scopes by WORKSPACE (ADR-0004 /
// ADR-0011): members of a workspace share its channels, editors+ may publish through them, admins+ may connect and
// disconnect (enforced by the callers in src/lib/social/access.ts).
//
// Differences from SP, all deliberate:
//
//  • `workspaceId` is a REQUIRED argument everywhere. SP resolved the owner from the session when omitted and threw for
//    background callers that forgot it; here there is no implicit scope at all, so the scheduler, the worker and the
//    request handlers all name the workspace and nothing can fall back to "every connection on the installation".
//  • No installation-owner env credentials. SP's `FACEBOOK_PAGE_ID` / `FACEBOOK_PAGE_ACCESS_TOKEN` belonged to the
//    oldest account; in ClipWaltz that Page becomes an ordinary connection row in the owner's workspace (plan §4.2).
//  • Tokens are encrypted at rest (R6) with the existing helper (src/lib/cloud/crypto.ts, TOKEN_ENC_KEY). Rows are
//    decrypted here and only here; the `Connection` objects this module returns hold plaintext and must never be
//    returned to a client component — use `publicConnection()` for that.
//  • This file is the only place that touches the table for application work.

export interface ProviderStatus {
  id: ProviderId;
  configured: boolean; // at least one usable connection
  connected: boolean; // at least one stored connection
  displayName: string | null;
  expiresAt: Date | null;
  instanceCount: number;
}

export interface Connection {
  id: string;
  workspaceId: string;
  provider: string;
  label: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  externalId: string | null;
  displayName: string | null;
  aiContext: string | null;
  /** Parked: kept, but never published to. */
  paused: boolean;
  /** Free-form per-connection mode (e.g. dev.to draft vs published). */
  scope: string | null;
  createdAt: Date;
}

/** What may be shown in the UI: no credentials. */
export type PublicConnection = Omit<Connection, "accessToken" | "refreshToken">;

/**
 * Webhook networks whose URL IS the credential. Their externalId is never shown: TxtYa rows connected before
 * 2026-11-14 stored the hook's secret path segment there (new rows store a hash — credentials.ts webhookFingerprint).
 */
const SECRET_EXTERNAL_ID = new Set(["txtya"]);

export function publicConnection(c: Connection): PublicConnection {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { accessToken, refreshToken, ...rest } = c;
  return SECRET_EXTERNAL_ID.has(c.provider) ? { ...rest, externalId: null } : rest;
}

/**
 * Does saving this connect skip the plan's channel check? Only when it updates a connection this workspace already
 * has FOR THE SAME NETWORK. Any other id (another network's row, another workspace's row, "new", unknown) is saved as a
 * new connection by persistConnection, so it must pass assertChannelCapacity first.
 */
export async function isInPlaceUpdate(provider: string, id: string | undefined, workspaceId: string): Promise<boolean> {
  if (!id || id === "new") return false;
  const existing = await getConnectionById(id, workspaceId);
  return !!existing && existing.workspaceId === workspaceId && existing.provider === provider;
}

type Row = typeof schema.socialConnections.$inferSelect;

function toConn(row: Row): Connection {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider,
    label: row.label,
    accessToken: decryptToken(row.accessToken) ?? "",
    refreshToken: decryptToken(row.refreshToken),
    expiresAt: row.expiresAt,
    externalId: row.externalId,
    displayName: row.displayName,
    aiContext: row.aiContext,
    scope: row.scope,
    paused: row.paused,
    createdAt: row.createdAt,
  };
}

/** Per-provider status for the Networks overview, for one workspace. */
export async function getProviderStatuses(workspaceId: string): Promise<ProviderStatus[]> {
  const all = await listConnections(workspaceId);
  return listProviders().map((p) => {
    const conns = all.filter((c) => c.provider === p.id);
    const usable = conns.filter((c) => c.accessToken && c.externalId && !c.paused);
    const primary = conns[0] ?? null;
    return {
      id: p.id,
      configured: usable.length > 0,
      connected: conns.length > 0,
      displayName: primary?.displayName ?? null,
      expiresAt: primary?.expiresAt ?? null,
      instanceCount: conns.length,
    };
  });
}

/** Every connection this workspace owns, oldest first. */
export async function listConnections(workspaceId: string): Promise<Connection[]> {
  const rows = await db
    .select()
    .from(schema.socialConnections)
    .where(eq(schema.socialConnections.workspaceId, workspaceId))
    .orderBy(asc(schema.socialConnections.createdAt));
  return rows.map(toConn);
}

/** How many channels the workspace has connected (plan limits, src/lib/social/limits.ts). */
export async function countConnections(workspaceId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(schema.socialConnections)
    .where(eq(schema.socialConnections.workspaceId, workspaceId));
  return Number(r?.n ?? 0);
}

/** This workspace's connection instances for one provider. */
export async function listConnectionsForProvider(provider: ProviderId, workspaceId: string): Promise<Connection[]> {
  const rows = await db
    .select()
    .from(schema.socialConnections)
    .where(and(eq(schema.socialConnections.provider, provider), eq(schema.socialConnections.workspaceId, workspaceId)))
    .orderBy(asc(schema.socialConnections.createdAt));
  return rows.map(toConn);
}

/**
 * One connection by id — **only if this workspace owns it**.
 *
 * The ownership half is the important one. Destination keys live on posts as `provider#connectionId`, so without it a
 * workspace could publish to somebody else's channel just by naming their connection id in a post.
 */
export async function getConnectionById(id: string, workspaceId: string): Promise<Connection | null> {
  const row = await db.query.socialConnections.findFirst({
    where: and(eq(schema.socialConnections.id, id), eq(schema.socialConnections.workspaceId, workspaceId)),
  });
  return row ? toConn(row) : null;
}

/** This workspace's primary (oldest) connection for a provider. */
export async function getConnection(provider: ProviderId, workspaceId: string): Promise<Connection | null> {
  const all = await listConnectionsForProvider(provider, workspaceId);
  return all[0] ?? null;
}

export interface ConnData {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  externalId?: string | null;
  displayName?: string | null;
  label?: string | null;
  scope?: string | null;
}

function writable(data: ConnData) {
  return {
    label: data.label ?? null,
    accessToken: encryptToken(data.accessToken) ?? "",
    refreshToken: encryptToken(data.refreshToken ?? null),
    expiresAt: data.expiresAt ?? null,
    externalId: data.externalId ?? null,
    displayName: data.displayName ?? null,
    scope: data.scope ?? null,
    updatedAt: new Date(),
  };
}

/**
 * Upsert this workspace's PRIMARY connection for a provider (its oldest instance).
 *
 * ⚠️ SP once used `id = provider` for primaries; that collides as soon as two owners connect the same provider. Every
 * row here has a UUID.
 */
export async function saveConnection(provider: ProviderId, data: ConnData, workspaceId: string, createdBy?: string | null) {
  const primary = await getConnection(provider, workspaceId);
  if (primary) {
    await db
      .update(schema.socialConnections)
      .set(writable(data))
      .where(and(eq(schema.socialConnections.id, primary.id), eq(schema.socialConnections.workspaceId, workspaceId)));
    return primary.id;
  }
  return addConnection(provider, data, workspaceId, createdBy);
}

/** Add a NEW connection instance. Returns its id. */
export async function addConnection(
  provider: ProviderId,
  data: ConnData,
  workspaceId: string,
  createdBy?: string | null,
): Promise<string> {
  const id = randomUUID();
  await db
    .insert(schema.socialConnections)
    .values({ id, workspaceId, createdBy: createdBy ?? null, provider, ...writable(data) });
  return id;
}

/** Update one of this workspace's instances by id. Only the fields given are changed. */
export async function updateConnectionById(id: string, data: Partial<ConnData>, workspaceId: string) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["expiresAt", "externalId", "displayName", "label", "scope"] as const) {
    if (data[k] !== undefined) set[k] = data[k];
  }
  if (data.accessToken !== undefined) set.accessToken = encryptToken(data.accessToken) ?? "";
  if (data.refreshToken !== undefined) set.refreshToken = encryptToken(data.refreshToken);
  await db
    .update(schema.socialConnections)
    .set(set)
    .where(and(eq(schema.socialConnections.id, id), eq(schema.socialConnections.workspaceId, workspaceId)));
}

/** Set the per-network AI brief. */
export async function setConnectionAiContext(id: string, aiContext: string | null, workspaceId: string) {
  await db
    .update(schema.socialConnections)
    .set({ aiContext: aiContext?.slice(0, 4000) || null, updatedAt: new Date() })
    .where(and(eq(schema.socialConnections.id, id), eq(schema.socialConnections.workspaceId, workspaceId)));
}

/**
 * OAuth upsert: reuse this workspace's instance for the same account (provider + externalId), otherwise add a new one.
 */
export async function saveOAuthConnection(
  provider: ProviderId,
  data: ConnData,
  workspaceId: string,
  createdBy?: string | null,
): Promise<string> {
  const existing = await listConnectionsForProvider(provider, workspaceId);
  const sameAccount = data.externalId ? existing.find((c) => c.externalId === data.externalId) : null;
  if (sameAccount) {
    await updateConnectionById(sameAccount.id, data, workspaceId);
    return sameAccount.id;
  }
  return addConnection(provider, data, workspaceId, createdBy);
}

/**
 * Persist a connection from a connect handler.
 *  - id === "new"  → add a new instance
 *  - id present    → update that instance, **only if this workspace owns it**
 *  - id absent     → upsert by account (provider + externalId), else add
 */
export async function persistConnection(
  provider: ProviderId,
  id: string | undefined,
  data: ConnData,
  workspaceId: string,
  createdBy?: string | null,
): Promise<string> {
  if (id === "new") return addConnection(provider, data, workspaceId, createdBy);
  if (id) {
    // The id arrives in a request body, so it is caller-controlled. Updating a row this workspace does not own would
    // let one account overwrite another's credentials; an unowned id becomes a new connection of their own instead.
    const owned = await getConnectionById(id, workspaceId);
    if (!owned || owned.provider !== provider) return addConnection(provider, data, workspaceId, createdBy);
    await updateConnectionById(id, data, workspaceId);
    return id;
  }
  return saveOAuthConnection(provider, data, workspaceId, createdBy);
}

export async function deleteConnectionById(id: string, workspaceId: string): Promise<boolean> {
  const rows = await db
    .delete(schema.socialConnections)
    .where(and(eq(schema.socialConnections.id, id), eq(schema.socialConnections.workspaceId, workspaceId)))
    .returning({ id: schema.socialConnections.id });
  return rows.length > 0;
}

/** Park or un-park one of this workspace's destinations. */
export async function setConnectionPaused(id: string, paused: boolean, workspaceId: string): Promise<boolean> {
  const rows = await db
    .update(schema.socialConnections)
    .set({ paused, updatedAt: new Date() })
    .where(and(eq(schema.socialConnections.id, id), eq(schema.socialConnections.workspaceId, workspaceId)))
    .returning({ id: schema.socialConnections.id });
  return rows.length > 0;
}

/**
 * Background maintenance only (token refresh, platform deauthorize webhooks): every connection of one provider across
 * ALL workspaces. Never call this from a request on behalf of a user.
 */
export async function listAllConnectionsForMaintenance(provider?: ProviderId): Promise<Connection[]> {
  // Connections imported from Social Publishing (migration_hold set) are skipped: until the cut-over SP refreshes
  // those tokens, and a refresh here could rotate a token out from under it.
  const held = isNull(schema.socialConnections.migrationHold);
  const rows = provider
    ? await db
        .select()
        .from(schema.socialConnections)
        .where(and(eq(schema.socialConnections.provider, provider), held))
    : await db.select().from(schema.socialConnections).where(held);
  return rows.map(toConn);
}

/** Background maintenance: write refreshed tokens to a connection found by `listAllConnectionsForMaintenance`. */
export async function updateConnectionTokens(
  c: Pick<Connection, "id" | "workspaceId">,
  data: Partial<ConnData>,
): Promise<void> {
  await updateConnectionById(c.id, data, c.workspaceId);
}
