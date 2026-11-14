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
// 5. security regressions (2026-11-14): safeFetch refuses loopback / RFC1918 / metadata / [::1] and a redirect into a
//    private address (against a loopback test server), pins the connection to the vetted IP; the Teams URL check
//    rejects look-alikes; a tampered OAuth state cookie is refused; a cross-network connection id does not skip the
//    channel limit; a thumbnail id from outside the workspace is refused; the email cap reads from the DB.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

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

// ── 5a. security regressions (no DB) ─────────────────────────────────────────
{
  const { safeFetch, createSafeFetch, isBlockedAddress, UnsafeUrlError } = await import("@/lib/social/safe-fetch");
  const { isTeamsWebhookUrl } = await import("@/lib/social/publishing/webhook-urls");
  const { sealState, openState } = await import("@/lib/social/oauth/state-cookie");

  // Direct private targets: refused before any socket is opened.
  for (const u of ["http://127.0.0.1/", "http://10.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "https://localhost/"]) {
    await assert.rejects(safeFetch(u, { signal: AbortSignal.timeout(5_000) }), UnsafeUrlError, `safeFetch must refuse ${u}`);
  }
  for (const ip of ["::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "fd00:ec2::254", "fe80::1", "100.64.0.1", "0.0.0.0", "64:ff9b::a00:1"]) {
    assert.equal(isBlockedAddress(ip), true, `${ip} is blocked`);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isBlockedAddress(ip), false, `${ip} is public`);
  ok("safeFetch refuses 127.0.0.1, 10.x, 169.254.169.254, [::1], localhost (+ mapped/ULA/CGNAT/NAT64 addresses blocked)");

  // A loopback server stands in for "a public server that redirects inward". The test policy allows 127.0.0.1 ONLY so
  // the first hop can connect; every other address goes through the production block list.
  const server: Server = createServer((req, res) => {
    if (req.url === "/to-private") return void res.writeHead(302, { location: "http://10.0.0.5/admin" }).end();
    if (req.url === "/to-metadata") return void res.writeHead(307, { location: "http://169.254.169.254/latest/meta-data/" }).end();
    if (req.url === "/loop") return void res.writeHead(302, { location: "/loop" }).end();
    if (req.url === "/hop") return void res.writeHead(303, { location: "/ok" }).end();
    if (req.url === "/echo") {
      let n = 0;
      req.on("data", (c: Buffer) => (n += c.length));
      req.on("end", () =>
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ method: req.method, bytes: n, type: req.headers["content-type"] ?? "" })),
      );
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const allowLoopback = (ip: string) => ip !== "127.0.0.1" && isBlockedAddress(ip);
  const testFetch = createSafeFetch({ isBlocked: allowLoopback });
  try {
    const base = `http://127.0.0.1:${port}`;
    await assert.rejects(testFetch(`${base}/to-private`), UnsafeUrlError, "302 to 10.0.0.5 refused");
    await assert.rejects(testFetch(`${base}/to-metadata`), UnsafeUrlError, "307 to 169.254.169.254 refused");
    await assert.rejects(testFetch(`${base}/loop`), /Too many redirects/, "redirect loop stops after 3 hops");
    const hop = await testFetch(`${base}/hop`, { method: "POST", body: "x" });
    assert.equal(await hop.text(), "ok", "a same-host redirect is followed");
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(1234)], { type: "image/png" }), "a.png");
    const echo = (await (await testFetch(`${base}/echo`, { method: "POST", body: form })).json()) as { method: string; bytes: number; type: string };
    assert.equal(echo.method, "POST");
    assert.ok(echo.bytes > 1234 && echo.type.startsWith("multipart/form-data"), "FormData body is sent intact");
    // Pinning: a name that does not exist in DNS connects only because the vetted address is handed to the socket.
    const pinned = createSafeFetch({ isBlocked: allowLoopback, resolve: async () => [{ address: "127.0.0.1", family: 4 }] });
    assert.equal(await (await pinned(`http://pinned.selftest.invalid:${port}/ok`)).text(), "ok", "connection uses the vetted IP");
    const rebinding = createSafeFetch({ resolve: async () => [{ address: "93.184.215.14", family: 4 }, { address: "10.1.2.3", family: 4 }] });
    await assert.rejects(rebinding("https://mixed.selftest.invalid/"), UnsafeUrlError, "any private answer in the set is refused");
  } finally {
    server.close();
  }
  ok("safeFetch re-vets every redirect hop (302→10.x, 307→metadata refused; max 3), pins the socket to the vetted IP");

  for (const bad of [
    "https://10.0.0.5:8443?office.com",
    "https://attackeroffice.com/",
    "https://evil.com/x.webhook.office.com",
    "http://x.webhook.office.com/a",
    "https://webhook.office.com.evil.com/",
    "https://a.logic.azure.com:8443/x",
  ]) {
    assert.equal(isTeamsWebhookUrl(bad), false, `Teams check must reject ${bad}`);
  }
  for (const good of ["https://contoso.webhook.office.com/webhookb2/abc", "https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x"]) {
    assert.equal(isTeamsWebhookUrl(good), true, `Teams check must accept ${good}`);
  }
  ok("Teams webhook check rejects https://10.0.0.5:8443?office.com and https://attackeroffice.com/");

  const cookie = sealState("mastodon", { s: "state-1", w: "ws-1", x: { instance: "https://mastodon.social" } });
  assert.deepEqual(openState("mastodon", cookie), { s: "state-1", w: "ws-1", x: { instance: "https://mastodon.social" } });
  const [payload, sig] = cookie.split(".");
  const evil = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  evil.v.x.instance = "https://10.0.0.5";
  assert.equal(openState("mastodon", `${Buffer.from(JSON.stringify(evil)).toString("base64url")}.${sig}`), null, "edited payload refused");
  assert.equal(openState("mastodon", JSON.stringify({ s: "state-1", w: "ws-1" })), null, "an unsigned (old-format) cookie is refused");
  assert.equal(openState("x", cookie), null, "a cookie sealed for another provider is refused");
  assert.equal(openState("mastodon", cookie, Date.now() + 11 * 60_000), null, "an expired cookie is refused");
  ok("tampered / unsigned / cross-provider / expired OAuth state cookies are refused");
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

    // 5b. security regressions that need the DB.
    const { isInPlaceUpdate } = await import("@/lib/social/connections");
    assert.equal(await isInPlaceUpdate("discord", connId, ws.id), true, "same network + same workspace = in-place update");
    assert.equal(await isInPlaceUpdate("teams", connId, ws.id), false, "a Discord id must not let a Teams connect skip the limit");
    assert.equal(await isInPlaceUpdate("discord", connId, randomUUID()), false, "another workspace's id is not an update");
    assert.equal(await isInPlaceUpdate("discord", "new", ws.id), false);
    ok("a cross-network (or foreign) connection id does not bypass the channel limit");

    const { assertPerNetworkMediaOwned, PostInputError } = await import("@/lib/social/posts");
    await assert.rejects(
      assertPerNetworkMediaOwned(ws.id, { [`youtube#${connId}`]: { meta: { thumbnailMediaId: randomUUID() } } }),
      PostInputError,
      "a thumbnail id that is not this workspace's media is refused",
    );
    await assert.rejects(assertPerNetworkMediaOwned(ws.id, { k: { meta: { thumbnailMediaId: "../x" } } }), PostInputError);
    await assertPerNetworkMediaOwned(ws.id, { k: { text: "no thumbnail" } });
    ok("thumbnailMediaId outside the workspace is refused at create/update");

    const { emailDailyCap, emailSendsLast24h, DEFAULT_EMAIL_DAILY_CAP } = await import("@/lib/social/email-cap");
    const savedCap = process.env.SOCIAL_EMAIL_DAILY_CAP;
    delete process.env.SOCIAL_EMAIL_DAILY_CAP;
    assert.equal(emailDailyCap(), DEFAULT_EMAIL_DAILY_CAP);
    process.env.SOCIAL_EMAIL_DAILY_CAP = "5";
    assert.equal(emailDailyCap(), 5);
    if (savedCap === undefined) delete process.env.SOCIAL_EMAIL_DAILY_CAP;
    else process.env.SOCIAL_EMAIL_DAILY_CAP = savedCap;
    const sentCount = await emailSendsLast24h(ws.id);
    assert.ok(Number.isInteger(sentCount) && sentCount >= 0);
    const { listUnsubscribe } = await import("@/lib/social/publishing/providers/email");
    assert.equal(listUnsubscribe("ClipWaltz <noreply@clipwaltz.com>"), "<mailto:noreply@clipwaltz.com?subject=unsubscribe>");
    ok(`email daily cap reads env (default ${DEFAULT_EMAIL_DAILY_CAP}) and counts sends from the DB (${sentCount} in 24 h); List-Unsubscribe built`);

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
