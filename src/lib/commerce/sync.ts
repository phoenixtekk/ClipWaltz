import { randomBytes, randomUUID } from "crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { decryptToken, encryptToken } from "@/lib/cloud/crypto";
import {
  CatalogError, fetchCatalog, mapWebhookProduct, probeStore, storeOrigin, verifyWebhookSignature,
  type CatalogProduct, type Platform, type WixCreds,
} from "@/lib/commerce/catalog";

// G10 store catalog connections + sync (plan §6 G10). Products land in `product_sources` (the same table as G3's
// pasted product links), keyed by (connection_id, external_id), so "Make a pack" works on any synced product.
// Credentials (Wix API key) and webhook secrets are encrypted at rest with TOKEN_ENC_KEY and never leave the server.
// Deleting a connection deletes its credentials and every product it synced (FK cascade).
//
// No `server-only`: scripts/test-p6b-*.mts import it under tsx. Never import it from a client component.

export const MAX_CONNECTIONS = 10;

export interface ConnectInput {
  platform: Platform;
  storeUrl: string;
  label?: string | null;
  /** Wix only. */
  apiKey?: string | null;
  siteId?: string | null;
}

export function isPlatform(p: unknown): p is Platform {
  return p === "shopify" || p === "woocommerce" || p === "wix";
}

export async function connectStore(workspaceId: string, userId: string, input: ConnectInput) {
  if (!isPlatform(input.platform)) throw new CatalogError("Pick Shopify, WooCommerce or Wix.");
  const origin = storeOrigin(input.storeUrl);
  const creds: WixCreds | null =
    input.platform === "wix" ? { apiKey: String(input.apiKey ?? "").trim(), siteId: String(input.siteId ?? "").trim() } : null;
  if (creds && (!creds.apiKey || !/^[a-f0-9-]{36}$/i.test(creds.siteId))) {
    throw new CatalogError("Paste the Wix API key and the site id (the id in your Wix dashboard address, like 1a2b3c4d-…).");
  }
  const existing = await db
    .select({ id: schema.commerceConnections.id, platform: schema.commerceConnections.platform, url: schema.commerceConnections.storeUrl })
    .from(schema.commerceConnections)
    .where(eq(schema.commerceConnections.workspaceId, workspaceId));
  if (existing.some((c) => c.platform === input.platform && c.url === origin)) throw new CatalogError("That store is already connected.");
  if (existing.length >= MAX_CONNECTIONS) throw new CatalogError(`A workspace can connect up to ${MAX_CONNECTIONS} stores.`);
  const info = await probeStore(input.platform, origin, creds);
  const id = randomUUID();
  await db.insert(schema.commerceConnections).values({
    id,
    workspaceId,
    createdBy: userId,
    platform: input.platform,
    storeUrl: origin,
    label: (input.label?.trim() || info.name || new URL(origin).hostname).slice(0, 80),
    currency: info.currency,
    credentials: creds ? encryptToken(JSON.stringify(creds)) : null,
  });
  return { id, name: info.name, currency: info.currency };
}

function credsOf(row: { credentials: string | null }): WixCreds | null {
  if (!row.credentials) return null;
  try {
    const j = JSON.parse(decryptToken(row.credentials) ?? "null");
    return j && typeof j.apiKey === "string" && typeof j.siteId === "string" ? j : null;
  } catch {
    return null;
  }
}

async function upsertProducts(connectionId: string, workspaceId: string, userId: string | null, products: CatalogProduct[]) {
  const now = new Date();
  for (let i = 0; i < products.length; i += 50) {
    const chunk = products.slice(i, i + 50);
    await db
      .insert(schema.productSources)
      .values(
        chunk.map((p) => ({
          id: randomUUID(), workspaceId, createdBy: userId, url: p.url, title: p.title, description: p.description || null,
          price: p.price, currency: p.currency, brand: p.brand, images: p.images, source: "catalog", connectionId,
          externalId: p.externalId, available: p.available, fetchedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.productSources.connectionId, schema.productSources.externalId],
        set: {
          url: sql`excluded.url`, title: sql`excluded.title`, description: sql`excluded.description`, price: sql`excluded.price`,
          currency: sql`excluded.currency`, brand: sql`excluded.brand`, images: sql`excluded.images`, available: sql`excluded.available`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }
}

/** Re-read the whole catalog (≤ MAX_SYNC). Products the store no longer lists are removed when the read was complete. */
export async function syncStore(workspaceId: string, connectionId: string) {
  const [c] = await db
    .select()
    .from(schema.commerceConnections)
    .where(and(eq(schema.commerceConnections.id, connectionId), eq(schema.commerceConnections.workspaceId, workspaceId)));
  if (!c) throw new CatalogError("That store is not connected to this workspace.");
  if (!isPlatform(c.platform)) throw new CatalogError("Unknown store type.");
  try {
    const { products, complete } = await fetchCatalog(c.platform, c.storeUrl, { currency: c.currency, creds: credsOf(c) });
    const seen = [...new Set(products.map((p) => p.externalId))];
    const unique = seen.map((id) => products.find((p) => p.externalId === id)!);
    await upsertProducts(c.id, workspaceId, c.createdBy, unique);
    let removed = 0;
    if (complete) {
      const gone = await db
        .delete(schema.productSources)
        .where(
          and(
            eq(schema.productSources.connectionId, c.id),
            seen.length ? notInArray(schema.productSources.externalId, seen) : sql`true`,
          ),
        )
        .returning({ id: schema.productSources.id });
      removed = gone.length;
    }
    await db
      .update(schema.commerceConnections)
      .set({ lastSyncedAt: new Date(), lastSyncCount: unique.length, lastError: null, updatedAt: new Date() })
      .where(eq(schema.commerceConnections.id, c.id));
    return { synced: unique.length, removed, complete };
  } catch (e) {
    const msg = e instanceof CatalogError ? e.message : "The sync failed — try again in a minute.";
    await db.update(schema.commerceConnections).set({ lastError: msg.slice(0, 300), updatedAt: new Date() }).where(eq(schema.commerceConnections.id, c.id));
    if (!(e instanceof CatalogError)) console.error("[commerce] sync", c.id, e);
    throw new CatalogError(msg);
  }
}

/** Disconnect: deletes the stored credentials, the webhook secret and every product it synced (cascade). */
export async function disconnectStore(workspaceId: string, connectionId: string): Promise<boolean> {
  const rows = await db
    .delete(schema.commerceConnections)
    .where(and(eq(schema.commerceConnections.id, connectionId), eq(schema.commerceConnections.workspaceId, workspaceId)))
    .returning({ id: schema.commerceConnections.id });
  return rows.length > 0;
}

/**
 * Turn on store webhooks. WooCommerce: ClipWaltz makes the secret (the owner pastes it into the webhook form).
 * Shopify: the owner pastes the signing secret Shopify shows under Settings → Notifications → Webhooks.
 * Returns the secret for WooCommerce (shown once), and the endpoint URL.
 */
export async function enableWebhooks(workspaceId: string, connectionId: string, shopifySecret?: string | null) {
  const [c] = await db
    .select({ id: schema.commerceConnections.id, platform: schema.commerceConnections.platform })
    .from(schema.commerceConnections)
    .where(and(eq(schema.commerceConnections.id, connectionId), eq(schema.commerceConnections.workspaceId, workspaceId)));
  if (!c) throw new CatalogError("That store is not connected to this workspace.");
  if (c.platform === "wix") throw new CatalogError("Wix webhooks need a registered Wix app — use Sync now instead.");
  let secret: string;
  if (c.platform === "shopify") {
    secret = String(shopifySecret ?? "").trim();
    if (secret.length < 16) throw new CatalogError("Paste the signing secret Shopify shows under Settings → Notifications → Webhooks.");
  } else {
    secret = randomBytes(24).toString("base64url");
  }
  await db.update(schema.commerceConnections).set({ webhookSecret: encryptToken(secret), updatedAt: new Date() }).where(eq(schema.commerceConnections.id, c.id));
  return { secret: c.platform === "woocommerce" ? secret : null, path: `/api/commerce/${c.platform}/webhook/${c.id}` };
}

export async function disableWebhooks(workspaceId: string, connectionId: string) {
  await db
    .update(schema.commerceConnections)
    .set({ webhookSecret: null, updatedAt: new Date() })
    .where(and(eq(schema.commerceConnections.id, connectionId), eq(schema.commerceConnections.workspaceId, workspaceId)));
}

/**
 * Handle a signed store webhook. Returns the HTTP status: 401 bad/missing signature (or webhooks off), 404 unknown
 * connection, 200 handled (create/update upserts the product, delete removes it).
 */
export async function handleStoreWebhook(platform: Platform, connectionId: string, raw: Uint8Array, headers: Headers): Promise<number> {
  const [c] = await db
    .select()
    .from(schema.commerceConnections)
    .where(and(eq(schema.commerceConnections.id, connectionId), eq(schema.commerceConnections.platform, platform)));
  if (!c) return 404;
  const secret = c.webhookSecret ? decryptToken(c.webhookSecret) : null;
  const sigHeader = platform === "shopify" ? headers.get("x-shopify-hmac-sha256") : headers.get("x-wc-webhook-signature");
  const text = Buffer.from(raw).toString("utf8");
  // WooCommerce pings a new webhook with a form body `webhook_id=<n>` and no signature; answer 200 so it can be saved.
  if (platform === "woocommerce" && !sigHeader && /^webhook_id=\d+$/.test(text.trim())) return 200;
  if (!secret || !verifyWebhookSignature(raw, secret, sigHeader)) return 401;
  const topic = (platform === "shopify" ? headers.get("x-shopify-topic") : headers.get("x-wc-webhook-topic")) ?? "";
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return 400;
  }
  const ext = String(body.id ?? "");
  if (!ext) return 200;
  if (/delete/.test(topic)) {
    await db.delete(schema.productSources).where(and(eq(schema.productSources.connectionId, c.id), eq(schema.productSources.externalId, ext)));
    return 200;
  }
  const p = mapWebhookProduct(platform, body, c.storeUrl, c.currency);
  if (!p) {
    // Unpublished / draft: hide it.
    await db.delete(schema.productSources).where(and(eq(schema.productSources.connectionId, c.id), eq(schema.productSources.externalId, ext)));
    return 200;
  }
  await upsertProducts(c.id, c.workspaceId, c.createdBy, [p]);
  return 200;
}

export async function listStores(workspaceId: string) {
  const conns = await db
    .select({
      id: schema.commerceConnections.id, platform: schema.commerceConnections.platform, storeUrl: schema.commerceConnections.storeUrl,
      label: schema.commerceConnections.label, currency: schema.commerceConnections.currency, lastSyncedAt: schema.commerceConnections.lastSyncedAt,
      lastSyncCount: schema.commerceConnections.lastSyncCount, lastError: schema.commerceConnections.lastError,
      webhooks: sql<boolean>`${schema.commerceConnections.webhookSecret} is not null`,
    })
    .from(schema.commerceConnections)
    .where(eq(schema.commerceConnections.workspaceId, workspaceId))
    .orderBy(schema.commerceConnections.createdAt);
  return conns;
}

export async function listCatalogProducts(workspaceId: string, connectionIds: string[]) {
  if (!connectionIds.length) return [];
  return db
    .select({
      id: schema.productSources.id, connectionId: schema.productSources.connectionId, title: schema.productSources.title,
      url: schema.productSources.url, price: schema.productSources.price, currency: schema.productSources.currency,
      brand: schema.productSources.brand, images: schema.productSources.images, available: schema.productSources.available,
      description: schema.productSources.description, source: schema.productSources.source,
    })
    .from(schema.productSources)
    .where(and(eq(schema.productSources.workspaceId, workspaceId), inArray(schema.productSources.connectionId, connectionIds)))
    .orderBy(schema.productSources.title)
    .limit(1000);
}
