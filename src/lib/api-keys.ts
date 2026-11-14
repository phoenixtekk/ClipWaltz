import { createHash, randomBytes, randomUUID } from "crypto";
import { and, count, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { getEffectiveTier } from "@/lib/tier";
import { getWorkspaceRole, roleAtLeast, type WorkspaceRole } from "@/lib/workspace";

// G12 / G13 — per-workspace API keys for the public API (/api/v1/*) and the MCP endpoint (/mcp). Plan §6 G12, §4.7.
//
//   • A key is `cwk_` + 43 base64url chars (32 random bytes). It is shown ONCE; only its SHA-256 is stored, plus the
//     first 12 characters (`prefix`) so the owner can tell keys apart. A fast hash is enough: the secret has 256 bits.
//   • Scopes: `read` (list/get), `generate` (AI copy + AI images — images cost credits like the UI), `publish` (create,
//     schedule and publish posts; upload media). A missing scope → 403.
//   • Pro only (§4.7, approved): the WORKSPACE OWNER's effective tier is checked on every request, so a downgrade turns
//     the keys off without deleting them.
//   • A key acts as the member who created it: that member must still belong to the workspace with editor+ (read-only
//     keys: viewer+). Credits are charged to that member, exactly as if they had clicked the button.
//   • Rate limits are counted from `api_requests` rows (60 / minute and 1,000 / hour per key), so a restart cannot reset
//     them. Rows older than 7 days are pruned now and then.
//
// No `server-only`: scripts/social-selftest.mts imports this under tsx. Never import it from a client component.

export const API_SCOPES = ["read", "generate", "publish"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const RATE_PER_MINUTE = 60;
export const RATE_PER_HOUR = 1000;
export const MAX_KEYS_PER_WORKSPACE = 20;

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Pro-only gate: true when the workspace's owner is on Pro (effective tier). */
export async function workspaceHasApi(workspaceId: string): Promise<boolean> {
  const [w] = await db.select({ owner: schema.workspaces.ownerUserId }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  if (!w) return false;
  return (await getEffectiveTier(w.owner)) === "pro";
}

export function cleanScopes(raw: unknown): ApiScope[] {
  const list = Array.isArray(raw) ? raw : [];
  return API_SCOPES.filter((s) => list.includes(s));
}

export class ApiKeyError extends Error {}

/** Create a key (caller has already checked the actor is admin+ of the workspace). Returns the secret ONCE. */
export async function createApiKey(workspaceId: string, createdBy: string, name: string, scopesIn: unknown) {
  const label = String(name ?? "").trim().slice(0, 60);
  if (!label) throw new ApiKeyError("Give the key a name (e.g. “Zapier” or “my script”).");
  const scopes = cleanScopes(scopesIn);
  if (!scopes.length) throw new ApiKeyError("Pick at least one permission.");
  if (!(await workspaceHasApi(workspaceId))) throw new ApiKeyError("The API is part of the Pro plan. Upgrade the workspace owner's plan to create keys.");
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.workspaceId, workspaceId), isNull(schema.apiKeys.revokedAt)));
  if (n >= MAX_KEYS_PER_WORKSPACE) throw new ApiKeyError(`A workspace can have up to ${MAX_KEYS_PER_WORKSPACE} active keys. Revoke one first.`);
  const secret = `cwk_${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  await db.insert(schema.apiKeys).values({ id, workspaceId, createdBy, name: label, prefix: secret.slice(0, 12), hash: hashSecret(secret), scopes });
  return { id, secret, prefix: secret.slice(0, 12), scopes, name: label };
}

export async function listApiKeys(workspaceId: string) {
  return db
    .select({
      id: schema.apiKeys.id, name: schema.apiKeys.name, prefix: schema.apiKeys.prefix, scopes: schema.apiKeys.scopes,
      lastUsedAt: schema.apiKeys.lastUsedAt, revokedAt: schema.apiKeys.revokedAt, createdAt: schema.apiKeys.createdAt,
      createdBy: schema.apiKeys.createdBy,
    })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.workspaceId, workspaceId))
    .orderBy(desc(schema.apiKeys.createdAt));
}

/** Revoke (keeps the row for the audit trail; the key stops working at once). Only a key of THIS workspace. */
export async function revokeApiKey(workspaceId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.workspaceId, workspaceId), isNull(schema.apiKeys.revokedAt)))
    .returning({ id: schema.apiKeys.id });
  return rows.length > 0;
}

// ─── Request authentication ─────────────────────────────────────────────────────────────────────────────────

export interface ApiContext {
  keyId: string;
  workspaceId: string;
  scopes: ApiScope[];
  /** The member the key acts as (its creator). */
  userId: string;
  email: string;
  role: WorkspaceRole;
  requestId: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function bearerFrom(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  const raw = m?.[1] ?? req.headers.get("x-api-key")?.trim() ?? null;
  return raw && /^cwk_[A-Za-z0-9_-]{20,100}$/.test(raw) ? raw : null;
}

let lastPrune = 0;

/**
 * Authenticate an API / MCP request: key → workspace → Pro gate → acting member → rate limit. Records the request
 * (status filled in by `finishRequest`). Throws ApiError (401 / 403 / 429).
 */
export async function authenticateApi(req: Request, path: string): Promise<ApiContext> {
  const secret = bearerFrom(req);
  if (!secret) throw new ApiError(401, "unauthorized", "Send your API key as `Authorization: Bearer cwk_…`.");
  const [key] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.hash, hashSecret(secret)));
  if (!key || key.revokedAt) throw new ApiError(401, "unauthorized", "This API key is not valid (revoked or unknown).");
  if (!key.createdBy) throw new ApiError(401, "unauthorized", "The member who created this key no longer exists. Create a new key.");
  if (!(await workspaceHasApi(key.workspaceId))) throw new ApiError(403, "plan_required", "The ClipWaltz API is part of the Pro plan.");
  const role = await getWorkspaceRole(key.createdBy, key.workspaceId);
  if (!role) throw new ApiError(403, "forbidden", "The member who created this key is no longer in the workspace.");
  const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, key.createdBy));

  const now = Date.now();
  const [{ m }] = await db
    .select({ m: count() })
    .from(schema.apiRequests)
    .where(and(eq(schema.apiRequests.keyId, key.id), gte(schema.apiRequests.at, new Date(now - 60_000))));
  if (m >= RATE_PER_MINUTE) throw new ApiError(429, "rate_limited", `Rate limit: ${RATE_PER_MINUTE} requests a minute per key.`, { "retry-after": "60" });
  const [{ h }] = await db
    .select({ h: count() })
    .from(schema.apiRequests)
    .where(and(eq(schema.apiRequests.keyId, key.id), gte(schema.apiRequests.at, new Date(now - 3_600_000))));
  if (h >= RATE_PER_HOUR) throw new ApiError(429, "rate_limited", `Rate limit: ${RATE_PER_HOUR} requests an hour per key.`, { "retry-after": "600" });

  const requestId = randomUUID();
  await db.insert(schema.apiRequests).values({ id: requestId, keyId: key.id, workspaceId: key.workspaceId, method: req.method, path: path.slice(0, 200) });
  await db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, key.id));
  if (now - lastPrune > 3_600_000) {
    lastPrune = now;
    const cutoff = new Date(now - 7 * 86_400_000);
    void db.delete(schema.apiRequests).where(lt(schema.apiRequests.at, cutoff)).catch(() => {});
    void db.delete(schema.apiIdempotency).where(lt(schema.apiIdempotency.createdAt, new Date(now - 86_400_000))).catch(() => {});
  }
  return { keyId: key.id, workspaceId: key.workspaceId, scopes: cleanScopes(key.scopes), userId: key.createdBy, email: u?.email ?? "", role, requestId };
}

/** 403 unless the key has `scope` (and the acting member's role allows it: editor+ for generate / publish). */
export function requireScope(ctx: ApiContext, scope: ApiScope): void {
  if (!ctx.scopes.includes(scope)) throw new ApiError(403, "insufficient_scope", `This key does not have the \`${scope}\` permission.`);
  if (scope !== "read" && !roleAtLeast(ctx.role, "editor")) {
    throw new ApiError(403, "forbidden", "The member who created this key is a viewer in this workspace and cannot create content.");
  }
}

export async function finishRequest(ctx: ApiContext | null, status: number): Promise<void> {
  if (!ctx) return;
  await db.update(schema.apiRequests).set({ status }).where(eq(schema.apiRequests.id, ctx.requestId)).catch(() => {});
}

// ─── Idempotency ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Run `fn` once per (key, Idempotency-Key). A repeat with the same body returns the stored response; a repeat with a
 * different body → 422; a repeat while the first is still running → 409. No header = no idempotency.
 */
export async function withIdempotency(
  ctx: ApiContext,
  req: Request,
  bodyText: string,
  fn: () => Promise<{ status: number; body: unknown }>,
): Promise<{ status: number; body: unknown; replayed: boolean }> {
  const idem = req.headers.get("idempotency-key")?.trim();
  if (!idem) return { ...(await fn()), replayed: false };
  if (idem.length > 200) throw new ApiError(400, "bad_request", "Idempotency-Key is too long (max 200 characters).");
  const requestHash = hashSecret(`${req.method} ${new URL(req.url).pathname}\n${bodyText}`);
  const id = randomUUID();
  const inserted = await db
    .insert(schema.apiIdempotency)
    .values({ id, keyId: ctx.keyId, idemKey: idem, requestHash })
    .onConflictDoNothing()
    .returning({ id: schema.apiIdempotency.id });
  if (!inserted.length) {
    const [prev] = await db
      .select()
      .from(schema.apiIdempotency)
      .where(and(eq(schema.apiIdempotency.keyId, ctx.keyId), eq(schema.apiIdempotency.idemKey, idem)));
    if (!prev) throw new ApiError(409, "conflict", "Try again.");
    if (prev.requestHash !== requestHash) throw new ApiError(422, "idempotency_mismatch", "This Idempotency-Key was used with a different request.");
    if (prev.status == null) throw new ApiError(409, "in_progress", "The first request with this Idempotency-Key is still running.");
    return { status: prev.status, body: prev.body, replayed: true };
  }
  try {
    const r = await fn();
    if (r.status >= 500) await db.delete(schema.apiIdempotency).where(eq(schema.apiIdempotency.id, id));
    else await db.update(schema.apiIdempotency).set({ status: r.status, body: r.body as object }).where(eq(schema.apiIdempotency.id, id));
    return { ...r, replayed: false };
  } catch (e) {
    // A refused request (4xx) is remembered too, so a retry gets the same answer; anything else may be retried.
    if (e instanceof ApiError && e.status < 500) {
      const body = { error: { code: e.code, message: e.message } };
      await db.update(schema.apiIdempotency).set({ status: e.status, body }).where(eq(schema.apiIdempotency.id, id));
    } else {
      await db.delete(schema.apiIdempotency).where(eq(schema.apiIdempotency.id, id));
    }
    throw e;
  }
}
