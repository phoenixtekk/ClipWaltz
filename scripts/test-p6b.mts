// P6 batch B acceptance test (G12 API keys + API, G13 MCP, G10 store webhooks + catalog mapping, G11 CSV columns,
// G7 feed parsing + robots). DEV ONLY: refuses unless DATABASE_URL is clipwaltz_dev; talks to a running dev server.
//
//   npm run dev -- -p 3010            (in another terminal)
//   node --env-file=.env.local --import tsx scripts/test-p6b.mts [http://localhost:3010]
//
// Creates throwaway users / workspaces / keys / a dummy Discord channel (never published to: every post is a draft or
// scheduled in 2030 and deleted at the end), and removes everything it made. No AI picture job is started (that
// spends credits and needs the GPU queue); only its refusal paths are checked.
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";

const BASE = process.argv[2] ?? "http://localhost:3010";
if (!/\/clipwaltz_dev(\?|$)/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL is not the clipwaltz_dev database.");
  process.exit(1);
}
process.env.SOCIAL_NOTIFY_DISABLED = "1";

const { db, schema } = await import("@/db");
const { eq, and, sql } = await import("drizzle-orm");
const { createApiKey, revokeApiKey, hashSecret, RATE_PER_MINUTE } = await import("@/lib/api-keys");
const { addConnection } = await import("@/lib/social/connections");
const { createPost } = await import("@/lib/social/posts");
const { enableWebhooks, disconnectStore, syncStore } = await import("@/lib/commerce/sync");
const { fetchCatalog, mapShopify, mapWoo, wooPrice, verifyWebhookSignature } = await import("@/lib/commerce/catalog");
const { buildGoogleCsv, buildMetaCsv, GOOGLE_COLUMNS, META_COLUMNS, withUtm } = await import("@/lib/image-ad/ads-export");
const { parseFeed, robotsAllows, normalizeRef, parseBluesky } = await import("@/lib/competitors");

let pass = 0;
const ok = (name: string) => {
  pass++;
  console.log(`PASS ${name}`);
};
const call = async (path: string, init: RequestInit & { key?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.key) headers.set("authorization", `Bearer ${init.key}`);
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are read loosely
  return { status: res.status, body: body as Record<string, any>, headers: res.headers };
};
const mcp = (key: string | null, msg: unknown, extra: Record<string, string> = {}) =>
  call("/mcp", {
    method: "POST",
    key: key ?? undefined,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...extra },
    body: JSON.stringify(msg),
  });

const tag = randomUUID().slice(0, 8);
const ids = {
  pro: `p6b-pro-${tag}`, viewer: `p6b-viewer-${tag}`, free: `p6b-free-${tag}`,
  wsP: `p6b-wsP-${tag}`, wsF: `p6b-wsF-${tag}`,
};

await db.insert(schema.user).values([
  { id: ids.pro, name: "P6b pro", email: `${ids.pro}@selftest.invalid` },
  { id: ids.viewer, name: "P6b viewer", email: `${ids.viewer}@selftest.invalid` },
  { id: ids.free, name: "P6b free", email: `${ids.free}@selftest.invalid` },
]);
try {
  await db.insert(schema.subscriptions).values({ id: randomUUID(), userId: ids.pro, tier: "pro", status: "active" });
  await db.insert(schema.workspaces).values([
    { id: ids.wsP, name: "P6b Pro WS", ownerUserId: ids.pro, isPersonal: false },
    { id: ids.wsF, name: "P6b Free WS", ownerUserId: ids.free, isPersonal: false },
  ]);
  await db.insert(schema.workspaceMembers).values([
    { id: randomUUID(), workspaceId: ids.wsP, userId: ids.pro, role: "owner" },
    { id: randomUUID(), workspaceId: ids.wsP, userId: ids.viewer, role: "viewer" },
    { id: randomUUID(), workspaceId: ids.wsF, userId: ids.free, role: "owner" },
  ]);
  const connP = await addConnection("discord", { accessToken: `https://discord.com/api/webhooks/1/p6b-${tag}`, externalId: "1", displayName: "p6b" }, ids.wsP, ids.pro);
  const connF = await addConnection("discord", { accessToken: `https://discord.com/api/webhooks/2/p6b-${tag}`, externalId: "2", displayName: "p6b-f" }, ids.wsF, ids.free);
  const chanP = `discord#${connP}`;
  const chanF = `discord#${connF}`;

  // ── G12 keys: hash at rest, shown once ──────────────────────────────────────────────────────────────────
  const kAll = await createApiKey(ids.wsP, ids.pro, "all", ["read", "generate", "publish"]);
  const kRead = await createApiKey(ids.wsP, ids.pro, "read", ["read"]);
  const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, kAll.id));
  assert.equal(row.hash, createHash("sha256").update(kAll.secret).digest("hex"));
  assert.equal(row.hash, hashSecret(kAll.secret));
  assert.equal(row.prefix, kAll.secret.slice(0, 12));
  assert.ok(!JSON.stringify(row).includes(kAll.secret.slice(12)), "the secret is not stored");
  assert.match(kAll.secret, /^cwk_[A-Za-z0-9_-]{43}$/);
  ok("G12 key stored as SHA-256 only (prefix 12 chars, no secret in the row)");
  await assert.rejects(() => createApiKey(ids.wsF, ids.free, "x", ["read"]), /Pro plan/);
  ok("G12 key creation refused for a non-Pro workspace");

  // ── G12 HTTP ────────────────────────────────────────────────────────────────────────────────────────────
  const spec = await call("/api/v1/openapi.json");
  assert.equal(spec.status, 200);
  assert.equal(spec.body.openapi, "3.1.0");
  assert.ok(spec.body.paths["/posts"] && spec.body.paths["/images"] && spec.body.paths["/connections"]);
  ok("G12 /api/v1/openapi.json 200 (OpenAPI 3.1.0)");

  assert.equal((await call("/api/v1/posts")).status, 401);
  assert.equal((await call("/api/v1/posts", { key: "cwk_" + "x".repeat(43) })).status, 401);
  ok("G12 no key / unknown key → 401");

  const me = await call("/api/v1/me", { key: kAll.secret });
  assert.equal(me.status, 200);
  assert.equal(me.body.workspace.id, ids.wsP);
  ok("G12 /me → the key's workspace");

  const chans = await call("/api/v1/connections", { key: kRead.secret });
  assert.equal(chans.status, 200);
  assert.deepEqual(chans.body.channels.map((c: { key: string }) => c.key), [chanP]);
  assert.ok(!JSON.stringify(chans.body).includes("webhooks/1"), "no credentials in the response");
  ok("G12 /connections lists only this workspace's channel, no credentials");

  const draftBody = JSON.stringify({ text: `p6b draft ${tag}`, channels: [chanP], mode: "draft" });
  const refused = await call("/api/v1/posts", { method: "POST", key: kRead.secret, headers: { "content-type": "application/json" }, body: draftBody });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.code, "insufficient_scope");
  ok("G12 read-only key cannot create a post (403 insufficient_scope)");

  const idem = `idem-${tag}`;
  const created = await call("/api/v1/posts", { method: "POST", key: kAll.secret, headers: { "content-type": "application/json", "idempotency-key": idem }, body: draftBody });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, "draft");
  const again = await call("/api/v1/posts", { method: "POST", key: kAll.secret, headers: { "content-type": "application/json", "idempotency-key": idem }, body: draftBody });
  assert.equal(again.status, 201);
  assert.equal(again.body.id, created.body.id);
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.socialPosts).where(and(eq(schema.socialPosts.workspaceId, ids.wsP), eq(schema.socialPosts.text, `p6b draft ${tag}`)));
  assert.equal(n, 1);
  const diff = await call("/api/v1/posts", { method: "POST", key: kAll.secret, headers: { "content-type": "application/json", "idempotency-key": idem }, body: draftBody.replace("draft ", "other ") });
  assert.equal(diff.status, 422);
  ok("G12 same Idempotency-Key twice → one post (replayed); different body → 422");

  const sched = await call(`/api/v1/posts/${created.body.id}/schedule`, { method: "POST", key: kAll.secret, headers: { "content-type": "application/json" }, body: JSON.stringify({ scheduled_at: "2030-01-01T12:00:00Z" }) });
  assert.equal(sched.status, 200);
  assert.equal(sched.body.status, "scheduled");
  assert.equal(sched.body.scheduled_at, "2030-01-01T12:00:00.000Z");
  ok("G12 schedule a post (2030, never due during the test)");

  const foreignChannel = await call("/api/v1/posts", { method: "POST", key: kAll.secret, headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x", channels: [chanF] }) });
  assert.equal(foreignChannel.status, 400);
  const postF = await createPost(ids.wsF, ids.free, { text: `p6b F ${tag}`, providers: [chanF], status: "draft" });
  assert.equal((await call(`/api/v1/posts/${postF}`, { key: kAll.secret })).status, 404);
  assert.equal((await call(`/api/v1/posts/${postF}/schedule`, { method: "POST", key: kAll.secret, headers: { "content-type": "application/json" }, body: JSON.stringify({ scheduled_at: "2030-01-01T12:00:00Z" }) })).status, 404);
  const [pf] = await db.select({ s: schema.socialPosts.status }).from(schema.socialPosts).where(eq(schema.socialPosts.id, postF));
  assert.equal(pf.s, "draft");
  const listed = await call("/api/v1/posts", { key: kRead.secret });
  assert.ok(!listed.body.posts.some((p: { id: string }) => p.id === postF));
  ok("G12 cross-workspace: another workspace's post → 404 (read and schedule), its channel → 400, never listed");

  // Pro gate on every request: a key row in the free workspace (inserted directly) → 403 plan_required.
  const freeSecret = `cwk_${"F".repeat(20)}${tag}${"f".repeat(15)}`;
  await db.insert(schema.apiKeys).values({ id: randomUUID(), workspaceId: ids.wsF, createdBy: ids.free, name: "free", prefix: freeSecret.slice(0, 12), hash: hashSecret(freeSecret), scopes: ["read"] });
  const gate = await call("/api/v1/me", { key: freeSecret });
  assert.equal(gate.status, 403);
  assert.equal(gate.body.error.code, "plan_required");
  ok("G12 Pro-only gate: a key in a non-Pro workspace → 403 plan_required");

  // A key made by a viewer can read but never create.
  const viewerSecret = `cwk_${"V".repeat(20)}${tag}${"v".repeat(15)}`;
  await db.insert(schema.apiKeys).values({ id: randomUUID(), workspaceId: ids.wsP, createdBy: ids.viewer, name: "viewer", prefix: viewerSecret.slice(0, 12), hash: hashSecret(viewerSecret), scopes: ["read", "publish"] });
  assert.equal((await call("/api/v1/posts", { key: viewerSecret })).status, 200);
  assert.equal((await call("/api/v1/posts", { method: "POST", key: viewerSecret, headers: { "content-type": "application/json" }, body: draftBody })).status, 403);
  ok("G12 a viewer's key can read, cannot create (403)");

  // Generate scope refusals (no GPU job started).
  assert.equal((await call("/api/v1/images", { method: "POST", key: kRead.secret, headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: "x" }) })).status, 403);
  assert.equal((await call("/api/v1/images", { method: "POST", key: kAll.secret, headers: { "content-type": "application/json" }, body: JSON.stringify({}) })).status, 400);
  ok("G12 images: read-only key → 403; missing brief → 400");

  // ── G13 MCP ─────────────────────────────────────────────────────────────────────────────────────────────
  assert.equal((await mcp(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).status, 401);
  const init = await mcp(kAll.secret, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "p6b-test", version: "1" } } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.ok(init.body.result.capabilities.tools);
  assert.equal(init.body.result.serverInfo.name, "clipwaltz");
  const note = await mcp(kAll.secret, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);
  const tools = await mcp(kAll.secret, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = tools.body.result.tools.map((t: { name: string }) => t.name).sort();
  assert.deepEqual(names, ["create_post", "generate_image", "get_image_status", "get_post_status", "list_channels", "list_posts", "schedule_post", "write_post_copy"]);
  const lc = await mcp(kAll.secret, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_channels", arguments: {} } });
  assert.equal(lc.body.result.isError, false);
  assert.equal(lc.body.result.structuredContent.channels[0].key, chanP);
  const cp = await mcp(kAll.secret, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_post", arguments: { text: `p6b mcp ${tag}`, channels: [chanP] } } });
  assert.equal(cp.body.result.isError, false, JSON.stringify(cp.body));
  assert.equal(cp.body.result.structuredContent.status, "draft");
  const gs = await mcp(kAll.secret, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_post_status", arguments: { post_id: cp.body.result.structuredContent.id } } });
  assert.equal(gs.body.result.structuredContent.text, `p6b mcp ${tag}`);
  const denied = await mcp(kRead.secret, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "schedule_post", arguments: { post_id: cp.body.result.structuredContent.id, scheduled_at: "2030-01-01T12:00:00Z" } } });
  assert.equal(denied.body.result.isError, true);
  assert.match(denied.body.result.content[0].text, /insufficient_scope/);
  const unknown = await mcp(kAll.secret, { jsonrpc: "2.0", id: 7, method: "nope" });
  assert.equal(unknown.body.error.code, -32601);
  assert.equal((await mcp(kAll.secret, { jsonrpc: "2.0", id: 8, method: "ping" }, { "mcp-protocol-version": "1999-01-01" })).status, 400);
  assert.equal((await call("/mcp")).status, 405);
  ok("G13 MCP: initialize → notifications/initialized 202 → tools/list (8) → tools/call list_channels, create_post (draft), get_post_status; read-only key cannot schedule_post; no key 401; bad protocol 400; GET 405");

  // ── Rate limit (counted from the DB) ────────────────────────────────────────────────────────────────────
  const now = new Date();
  await db.insert(schema.apiRequests).values(Array.from({ length: RATE_PER_MINUTE }, () => ({ id: randomUUID(), keyId: kRead.id, workspaceId: ids.wsP, method: "GET", path: "/x", status: 200, at: now })));
  const limited = await call("/api/v1/me", { key: kRead.secret });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
  ok(`G12 rate limit: ${RATE_PER_MINUTE} requests in the last minute (rows in api_requests) → 429 with Retry-After`);

  // ── Revoke ──────────────────────────────────────────────────────────────────────────────────────────────
  assert.equal(await revokeApiKey(ids.wsF, kAll.id), false, "another workspace cannot revoke it");
  assert.equal(await revokeApiKey(ids.wsP, kAll.id), true);
  assert.equal((await call("/api/v1/me", { key: kAll.secret })).status, 401);
  assert.equal((await mcp(kAll.secret, { jsonrpc: "2.0", id: 9, method: "ping" })).status, 401);
  ok("G12 revoke: revoked key → 401 on the API and MCP; another workspace cannot revoke it");

  // ── G10 webhooks (HMAC) + disconnect ────────────────────────────────────────────────────────────────────
  const storeId = randomUUID();
  await db.insert(schema.commerceConnections).values({ id: storeId, workspaceId: ids.wsP, createdBy: ids.pro, platform: "woocommerce", storeUrl: "https://shop.selftest.invalid", label: "p6b", currency: "USD" });
  const wh = await enableWebhooks(ids.wsP, storeId);
  assert.ok(wh.secret && wh.secret.length >= 30);
  const [stored] = await db.select({ s: schema.commerceConnections.webhookSecret }).from(schema.commerceConnections).where(eq(schema.commerceConnections.id, storeId));
  assert.ok(stored.s?.startsWith("enc1:") && !stored.s.includes(wh.secret!), "webhook secret encrypted at rest");
  const payload = JSON.stringify({ id: 777, name: "Selftest Mug", permalink: "https://shop.selftest.invalid/product/mug/", price: "12.50", status: "publish", stock_status: "instock", images: [{ src: "https://shop.selftest.invalid/mug.jpg" }] });
  const sig = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64");
  const hookPath = `/api/commerce/woocommerce/webhook/${storeId}`;
  const bad = await call(hookPath, { method: "POST", headers: { "content-type": "application/json", "x-wc-webhook-signature": sig(payload, "wrong-secret"), "x-wc-webhook-topic": "product.created" }, body: payload });
  assert.equal(bad.status, 401);
  const none = await call(hookPath, { method: "POST", headers: { "content-type": "application/json", "x-wc-webhook-topic": "product.created" }, body: payload });
  assert.equal(none.status, 401);
  const good = await call(hookPath, { method: "POST", headers: { "content-type": "application/json", "x-wc-webhook-signature": sig(payload, wh.secret!), "x-wc-webhook-topic": "product.created" }, body: payload });
  assert.equal(good.status, 200);
  const [prod] = await db.select().from(schema.productSources).where(and(eq(schema.productSources.connectionId, storeId), eq(schema.productSources.externalId, "777")));
  assert.equal(prod.title, "Selftest Mug");
  assert.equal(prod.price, "12.50");
  const upd = payload.replace("Selftest Mug", "Selftest Mug v2").replace("12.50", "14.00");
  assert.equal((await call(hookPath, { method: "POST", headers: { "content-type": "application/json", "x-wc-webhook-signature": sig(upd, wh.secret!), "x-wc-webhook-topic": "product.updated" }, body: upd })).status, 200);
  const [prod2] = await db.select().from(schema.productSources).where(and(eq(schema.productSources.connectionId, storeId), eq(schema.productSources.externalId, "777")));
  assert.equal(prod2.title, "Selftest Mug v2");
  assert.equal(prod2.price, "14.00");
  const ping = await call(hookPath, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "webhook_id=12" });
  assert.equal(ping.status, 200);
  assert.ok(verifyWebhookSignature(payload, wh.secret!, sig(payload, wh.secret!)));
  assert.ok(!verifyWebhookSignature(payload, wh.secret!, "not-base64-!!"));
  ok("G10 webhook: bad / missing HMAC → 401; signed create → product stored; signed update → title + price changed; secret encrypted at rest");
  await db.update(schema.commerceConnections).set({ credentials: "enc1:dummy" }).where(eq(schema.commerceConnections.id, storeId));
  assert.equal(await disconnectStore(ids.wsF, storeId), false, "another workspace cannot disconnect it");
  assert.equal(await disconnectStore(ids.wsP, storeId), true);
  assert.equal((await db.select().from(schema.commerceConnections).where(eq(schema.commerceConnections.id, storeId))).length, 0);
  assert.equal((await db.select().from(schema.productSources).where(eq(schema.productSources.connectionId, storeId))).length, 0);
  assert.equal((await call(hookPath, { method: "POST", headers: { "x-wc-webhook-signature": sig(payload, wh.secret!) }, body: payload })).status, 404);
  ok("G10 disconnect deletes the credentials, webhook secret and synced products; its webhook URL then 404s");

  // ── G10 live WooCommerce sync (public Store API) + re-sync reflects a change ─────────────────────────────
  if (process.env.P6B_SKIP_LIVE !== "1") {
    const liveId = randomUUID();
    await db.insert(schema.commerceConnections).values({ id: liveId, workspaceId: ids.wsP, createdBy: ids.pro, platform: "woocommerce", storeUrl: "https://mercantile.wordpress.org", label: "WordPress Swag Store" });
    const s1 = await syncStore(ids.wsP, liveId);
    assert.ok(s1.synced >= 25, `synced ${s1.synced}`);
    const live = await db.select().from(schema.productSources).where(eq(schema.productSources.connectionId, liveId));
    assert.equal(live.length, s1.synced);
    assert.ok(live.every((p) => p.title && /^https:\/\/mercantile\.wordpress\.org\//.test(p.url) && p.currency === "USD"));
    assert.ok(live.filter((p) => p.price && /^\d+\.\d{2}$/.test(p.price)).length >= 25);
    const victim = live[0];
    await db.update(schema.productSources).set({ title: "STALE", price: "0.01" }).where(eq(schema.productSources.id, victim.id));
    await syncStore(ids.wsP, liveId);
    const [back] = await db.select().from(schema.productSources).where(eq(schema.productSources.id, victim.id));
    assert.equal(back.title, victim.title);
    assert.equal(back.price, victim.price);
    ok(`G10 live WooCommerce sync: ${s1.synced} products (≥ 25) with title / price / USD / product URL; re-sync restores a changed title + price`);
    await disconnectStore(ids.wsP, liveId);
  }

  // ── G10 mapping units (Shopify / Woo shapes) ────────────────────────────────────────────────────────────
  const sp = mapShopify({ id: 1, title: "Tee", handle: "tee", body_html: "<p>Soft &amp; warm</p>", vendor: "Acme", variants: [{ price: "20.00", available: false }, { price: "18.00", available: true }], images: [{ src: "//cdn.shopify.com/a.jpg" }] }, "https://shop.example", "USD");
  assert.deepEqual([sp.url, sp.price, sp.available, sp.images[0], sp.description], ["https://shop.example/products/tee", "18.00", true, "https://cdn.shopify.com/a.jpg", "Soft & warm"]);
  assert.equal(wooPrice("1999", 2), "19.99");
  assert.equal(wooPrice("5", 2), "0.05");
  assert.equal(wooPrice("1000", 0), "1000");
  const wp = mapWoo({ id: 9, name: "Cap", permalink: "https://w.example/p/cap/", prices: { price: "2500", currency_code: "EUR", currency_minor_unit: 2 }, is_in_stock: false, images: [{ src: "https://w.example/c.jpg" }] }, "https://w.example");
  assert.deepEqual([wp.price, wp.currency, wp.available], ["25.00", "EUR", false]);
  ok("G10 mapping: Shopify lowest variant price + availability + https images; Woo minor units");

  // Shopify live (public /products.json) — the workstation's IP is rate-limited by Shopify (429), so this is run on
  // linuxg1 separately (see ADMIN_DOCS). Here: one attempt, reported, not asserted.
  if (process.env.P6B_SHOPIFY_LIVE === "1") {
    const c = await fetchCatalog("shopify", "https://www.beardbrand.com", { currency: "USD", creds: null });
    assert.ok(c.products.length >= 25);
    ok(`G10 live Shopify catalog read: ${c.products.length} products`);
  }

  // ── G11 CSV columns ─────────────────────────────────────────────────────────────────────────────────────
  const input = {
    campaign: "Spring Sale", landingUrl: "https://www.example.com/sale?ref=x&utm_source=old", primaryText: "Fresh picks for spring, 20% off this week.",
    businessName: "Example Co", cta: "SHOP_NOW",
    creatives: [
      { file: "a-1x1.png", format: "1:1", width: 1080, height: 1080, headline: "Spring is here", body: "20% off everything" },
      { file: "a-1.91x1.png", format: "1.91:1", width: 1200, height: 628, headline: "Fresh for spring", body: "This week only" },
      { file: "a-9x16.png", format: "9:16", width: 1080, height: 1920, headline: "Swipe up", body: "" },
    ],
  };
  const meta = buildMetaCsv(input);
  const header = meta.csv.split("\r\n")[0];
  assert.equal(header, META_COLUMNS.map((c) => `"${c}"`).join(","));
  assert.equal(meta.rows.length, 3);
  for (const r of meta.rows) {
    assert.equal(r.length, META_COLUMNS.length);
    assert.equal(r[META_COLUMNS.indexOf("Campaign Status")], "PAUSED");
    assert.equal(r[META_COLUMNS.indexOf("Ad Status")], "PAUSED");
    const link = new URL(r[META_COLUMNS.indexOf("Link")]);
    assert.deepEqual(["utm_source", "utm_medium", "utm_campaign", "utm_content"].map((k) => link.searchParams.get(k) !== null), [true, true, true, true]);
    assert.equal(link.searchParams.get("utm_source"), "facebook");
    assert.equal(link.searchParams.get("ref"), "x");
    assert.ok(input.creatives.some((c) => c.file === r[META_COLUMNS.indexOf("Image File Name")]));
  }
  // Google: every header except "Asset group" is on Google Ads Editor's "CSV file columns" page (answer/57747).
  const googleDocumented = new Set(["Campaign", "Campaign type", "Final URL", "Business name", "Long headline",
    ...Array.from({ length: 15 }, (_, i) => `Headline ${i + 1}`), ...Array.from({ length: 15 }, (_, i) => `Description ${i + 1}`), ...Array.from({ length: 15 }, (_, i) => `Image ${i + 1}`)]);
  assert.deepEqual(GOOGLE_COLUMNS.filter((c) => !googleDocumented.has(c)), ["Asset group"]);
  const g = buildGoogleCsv(input);
  assert.equal(g.row.length, GOOGLE_COLUMNS.length);
  assert.deepEqual(g.images.map((c) => c.file).sort(), ["a-1.91x1.png", "a-1x1.png"]);
  assert.ok(g.row.slice(GOOGLE_COLUMNS.indexOf("Headline 1"), GOOGLE_COLUMNS.indexOf("Headline 1") + 5).filter(Boolean).every((h) => h.length <= 30));
  assert.ok(g.row.slice(GOOGLE_COLUMNS.indexOf("Headline 1"), GOOGLE_COLUMNS.indexOf("Headline 1") + 5).some((h) => h && h.length <= 15));
  assert.ok(g.row[GOOGLE_COLUMNS.indexOf("Long headline")].length <= 90);
  assert.ok(g.row[GOOGLE_COLUMNS.indexOf("Business name")].length <= 25);
  assert.equal(new URL(g.row[GOOGLE_COLUMNS.indexOf("Final URL")]).searchParams.get("utm_source"), "google");
  assert.ok(g.warnings.some((w) => /9:16/.test(w)));
  assert.equal(withUtm("https://x.example/?utm_source=a&k=1", "s", "m", "C C", "d").includes("k=1"), true);
  assert.ok(/^"'=cmd"/.test((await import("@/lib/image-ad/ads-export")).csv([["=cmd"]])));
  ok("G11 CSV: Meta header = documented column list, 1 row per image, PAUSED, all 4 UTMs; Google header uses Editor's documented names (+ Asset group), PMax limits, 9:16 left out with a warning; formula cells neutralised");

  // ── G7 parsing + robots ─────────────────────────────────────────────────────────────────────────────────
  const rss = `<rss><channel><item><title>A</title><link>https://b.example/a</link><guid>a1</guid><pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Hello <b>there</b></p>]]></description></item>
    <item><title>B</title><link>https://b.example/b</link><pubDate>Wed, 11 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const pr = parseFeed(rss);
  assert.deepEqual(pr.map((p) => p.title), ["B", "A"]);
  assert.equal(pr[1].publishedAt?.toISOString(), "2026-11-10T10:00:00.000Z");
  assert.equal(pr[1].text, "Hello there");
  const atom = `<feed><entry><id>urn:1</id><title>X</title><link rel="alternate" href="https://c.example/x"/><published>2026-11-12T08:30:00Z</published><summary>S</summary></entry></feed>`;
  assert.equal(parseFeed(atom)[0].url, "https://c.example/x");
  assert.equal(robotsAllows("User-agent: *\nDisallow: /feeds/", "/feeds/videos.xml"), false);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /feeds/\nAllow: /feeds/public", "/feeds/public.xml"), true);
  assert.equal(robotsAllows("User-agent: ClipWaltzCompetitorReader\nDisallow: /\n\nUser-agent: *\nAllow: /", "/rss"), false);
  assert.equal(robotsAllows("User-agent: GPTBot\nDisallow: /", "/rss"), true);
  assert.equal(normalizeRef("mastodon", "https://mastodon.social/@Gargron"), "@Gargron@mastodon.social");
  assert.equal(normalizeRef("bluesky", "@Bsky.App"), "bsky.app");
  assert.equal(parseBluesky({ feed: [{ post: { uri: "at://d/app.bsky.feed.post/k1", author: { handle: "h" }, record: { text: "t", createdAt: "2026-11-01T00:00:00Z" } } }, { reason: {}, post: { uri: "at://d/app.bsky.feed.post/k2" } }] }).length, 1);
  ok("G7 RSS/Atom parsing (dates, CDATA, newest first), robots.txt longest-match incl. our UA group, ref normalising, reposts skipped");

  console.log(`\nALL ${pass} CHECKS PASSED`);
} catch (e) {
  console.error("FAIL", e);
  process.exitCode = 1;
} finally {
  await db.delete(schema.workspaces).where(sql`${schema.workspaces.id} in (${ids.wsP}, ${ids.wsF})`);
  await db.delete(schema.user).where(sql`${schema.user.id} in (${ids.pro}, ${ids.viewer}, ${ids.free})`);
  process.exit(process.exitCode ?? 0);
}
