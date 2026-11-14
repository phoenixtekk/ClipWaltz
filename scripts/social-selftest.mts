// Social Publishing P1 self-test. NO live network posting: `fetch` is stubbed for every network call.
//
//   node --env-file=.env.local --import tsx scripts/social-selftest.mts
//
// 1. preflight: a Bluesky target over 300 graphemes is reported, an Instagram target with no media is blocked.
// 2. adapter payload: BlueskyProvider.publish against a stubbed PDS — checks the createRecord payload (text trimmed
//    to Bluesky's limit, link facet) without reaching bsky.social.
// 3. orchestrator guard: a target with no connection is refused, never handed to an adapter.
// 4. DB round trip on the DEV database (DATABASE_URL must point at clipwaltz_dev — the script refuses anything else):
//    a temporary Discord connection is stored ENCRYPTED, a post is published twice (double-submit) → ONE target row
//    and ONE enqueue; the publish-target job runs against a stubbed Discord webhook → published; running the same job
//    again is a no-op. Everything created is deleted at the end.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL ?? "";
if (!/\/clipwaltz_dev(\?|$)/.test(url)) {
  console.error("Refusing to run: DATABASE_URL is not the clipwaltz_dev database.");
  process.exit(1);
}

const { preflight } = await import("@/lib/social/publishing/preflight");
const { BlueskyProvider } = await import("@/lib/social/publishing/providers/bluesky");
const { publishToTargets } = await import("@/lib/social/publishing");

type Call = { url: string; init?: RequestInit };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
function stubFetch(handler: (url: string, init?: RequestInit) => Response | null) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url: u, init });
    const r = handler(u, init);
    if (r) return r;
    throw new Error(`selftest: unexpected network call to ${u}`);
  }) as typeof fetch;
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const results: string[] = [];
const ok = (name: string) => {
  results.push(`PASS ${name}`);
  console.log(`PASS ${name}`);
};

// ── 1. preflight ─────────────────────────────────────────────────────────────
{
  const long = "x".repeat(320);
  const out = preflight({
    text: long,
    media: [],
    targets: [
      { key: "bluesky#a", provider: "bluesky", label: "Bluesky" },
      { key: "instagram#b", provider: "instagram", label: "Instagram" },
      { key: "telegram#c", provider: "telegram", label: "Telegram" },
    ],
  });
  const by = Object.fromEntries(out.map((t) => [t.provider, t]));
  console.log("preflight:", JSON.stringify(out.map((t) => ({ p: t.provider, sev: t.severity, count: t.count, limit: t.limit, findings: t.findings.map((f) => f.message.slice(0, 90)) }))));
  assert.equal(by.bluesky.limit, 300, "bluesky limit");
  assert.ok(by.bluesky.severity !== null, "bluesky over-limit is reported");
  assert.equal(by.instagram.severity, "blocked", "instagram without media is blocked");
  ok("preflight flags Bluesky over 300 and blocks Instagram without media");
}

// ── 2. Bluesky adapter payload ───────────────────────────────────────────────
{
  calls.length = 0;
  stubFetch((u) => {
    if (u.endsWith("/xrpc/com.atproto.server.createSession")) return json({ accessJwt: "jwt", did: "did:plc:test", handle: "test.bsky.social" });
    if (u.endsWith("/xrpc/com.atproto.repo.createRecord")) return json({ uri: "at://did:plc:test/app.bsky.feed.post/3abc", cid: "cid" });
    // Link-card fetches are best effort in the adapter; refuse them so the test stays offline.
    return new Response("no", { status: 404 });
  });
  const text = "Hello from the ClipWaltz self-test. " + "word ".repeat(80);
  const r = await new BlueskyProvider().publish({
    text,
    link: "https://www.clipwaltz.com/",
    credentials: { bluesky: { accessToken: "app-password", externalId: "did:plc:test" } },
  });
  globalThis.fetch = realFetch;
  const rec = calls.find((c) => c.url.endsWith("createRecord"));
  assert.ok(rec, "createRecord was called");
  const body = JSON.parse(String(rec!.init!.body)) as { repo: string; record: { text: string; facets?: unknown[] } };
  console.log("bluesky createRecord payload:", JSON.stringify({ repo: body.repo, graphemes: [...body.record.text].length, bytes: Buffer.byteLength(body.record.text), facets: body.record.facets?.length ?? 0, tail: body.record.text.slice(-60) }));
  assert.equal(r.ok, true, `bluesky result ok (${r.error ?? ""})`);
  assert.equal(body.repo, "did:plc:test");
  assert.ok([...body.record.text].length <= 300, "post text within 300 graphemes");
  assert.ok(Buffer.byteLength(body.record.text) <= 3000, "post text within 3000 bytes");
  ok("Bluesky adapter builds a createRecord payload within limits (stubbed network)");
}

// ── 3. orchestrator refuses connection-less targets ──────────────────────────
{
  calls.length = 0;
  stubFetch(() => null); // any network call would throw
  const out = await publishToTargets({
    text: "should never be sent",
    targets: [{ key: "facebook", provider: "facebook", connectionId: null, label: "Facebook Page" }],
  });
  globalThis.fetch = realFetch;
  assert.equal(out.length, 1);
  assert.equal(out[0].ok, false);
  assert.equal(calls.length, 0, "no network call for a refused target");
  ok("publishToTargets refuses a target without a workspace connection (no env-credential fallback)");
}

// ── 4. DB round trip: encryption, double-submit, idempotent job ──────────────
{
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { addConnection } = await import("@/lib/social/connections");
  const { publishPost, publishTargetJob } = await import("@/lib/social/publish-post");

  const [ws] = await db.select({ id: schema.workspaces.id, owner: schema.workspaces.ownerUserId }).from(schema.workspaces).limit(1);
  assert.ok(ws, "dev db has a workspace");
  const webhook = `https://discord.com/api/webhooks/123456789/selftest-${randomUUID()}`;
  const connId = await addConnection("discord", { accessToken: webhook, externalId: "123456789", displayName: "selftest" }, ws.id, ws.owner);
  const postId = randomUUID();
  try {
    const [raw] = await db.select({ t: schema.socialConnections.accessToken }).from(schema.socialConnections).where(eq(schema.socialConnections.id, connId));
    assert.ok(raw.t.startsWith("enc1:"), "token stored encrypted");
    assert.ok(!raw.t.includes("selftest"), "plaintext not present in the stored value");
    ok("connection credentials are stored encrypted (enc1:…)");

    await db.insert(schema.socialPosts).values({
      id: postId, workspaceId: ws.id, createdBy: ws.owner, text: "ClipWaltz self-test post", status: "draft", providers: `discord#${connId}`,
    });
    const enqueued: string[] = [];
    const enqueue = async (id: string) => {
      enqueued.push(id);
    };
    const [a, b] = await Promise.all([publishPost(postId, { enqueue }), publishPost(postId, { enqueue })]);
    const targets = await db.select().from(schema.socialPostTargets).where(eq(schema.socialPostTargets.postId, postId));
    console.log("double-submit:", JSON.stringify({ a: { ok: a.ok, status: a.status, error: a.error }, b: { ok: b.ok, status: b.status, error: b.error }, targets: targets.length, enqueued: enqueued.length }));
    assert.equal([a.ok, b.ok].filter(Boolean).length, 1, "exactly one publish call claims the post");
    assert.equal(targets.length, 1, "one target row");
    assert.equal(enqueued.length, 1, "one publish-target job");
    ok("double-submit publishes once (one target row, one job)");

    calls.length = 0;
    stubFetch((u) => (u.startsWith(webhook) ? json({ id: "999" }) : null));
    const j1 = await publishTargetJob(targets[0].id);
    const j2 = await publishTargetJob(targets[0].id);
    globalThis.fetch = realFetch;
    const [after] = await db.select().from(schema.socialPostTargets).where(eq(schema.socialPostTargets.id, targets[0].id));
    const [p] = await db.select({ status: schema.socialPosts.status }).from(schema.socialPosts).where(eq(schema.socialPosts.id, postId));
    const sent = calls.find((c) => c.url.startsWith(webhook));
    console.log("publish-target:", JSON.stringify({ j1, j2, target: after.status, externalId: after.externalId, post: p.status, webhookCalls: calls.filter((c) => c.url.startsWith(webhook)).length, payload: sent ? JSON.parse(String(sent.init!.body)) : null }));
    assert.equal(j1.claimed, true);
    assert.equal(j2.claimed, false, "second run of the same job is a no-op");
    assert.equal(after.status, "published");
    assert.equal(p.status, "published");
    assert.equal(calls.filter((c) => c.url.startsWith(webhook)).length, 1, "webhook called once");
    ok("publish-target job publishes once and is idempotent on the target row");
  } finally {
    await db.delete(schema.socialPosts).where(eq(schema.socialPosts.id, postId));
    await db.delete(schema.socialConnections).where(eq(schema.socialConnections.id, connId));
    const left = await db.select({ id: schema.socialConnections.id }).from(schema.socialConnections).where(eq(schema.socialConnections.id, connId));
    console.log(`cleanup: test connection removed=${left.length === 0}`);
  }
}

console.log(`\n${results.length} checks passed`);
process.exit(0);
