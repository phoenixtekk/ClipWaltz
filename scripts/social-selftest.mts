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
// 6. P6: G9 approval gate (pending / never-approved refused by publishPost and the scheduler; review-link token scoped
//    and revocable), G15 cross-workspace isolation, G6 best-slot fixture, G14 dedupe (< 0.94), G4 hashtags, G8
//    checklist + Spearman, G3 product parse + SSRF refusals.
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

// ── 6. P6 (2026-11-14): G9 approval gate, G15 workspace scoping, G6 best time, G14 dedupe, G4 hashtags, G8, G3 ──────
// DEV DB only. Creates two throwaway users + workspaces (A, B), never posts to a network (no enqueue, no connection
// has real credentials), and deletes everything at the end. Notifications are switched off for the run.
{
  process.env.SOCIAL_NOTIFY_DISABLED = "1";
  const { db, schema } = await import("@/db");
  const { eq, inArray } = await import("drizzle-orm");
  const { addConnection } = await import("@/lib/social/connections");
  const { publishPost } = await import("@/lib/social/publish-post");
  const { createPost, getPost, decideApproval } = await import("@/lib/social/posts");
  const { approvalBlock, decide, memberCanApprove } = await import("@/lib/social/approval");
  const { dueScheduledPosts } = await import("@/lib/social/scheduler");

  const tag = randomUUID().slice(0, 8);
  const editor = `p6-editor-${tag}`;
  const owner = `p6-owner-${tag}`;
  const wsA = `p6-wsA-${tag}`;
  const wsB = `p6-wsB-${tag}`;
  await db.insert(schema.user).values([
    { id: owner, name: "P6 owner", email: `${owner}@selftest.invalid` },
    { id: editor, name: "P6 editor", email: `${editor}@selftest.invalid` },
  ]);
  try {
    await db.insert(schema.workspaces).values([
      { id: wsA, name: "P6 A", ownerUserId: owner, isPersonal: false, socialRequireApproval: true },
      { id: wsB, name: "P6 B", ownerUserId: owner, isPersonal: false },
    ]);
    await db.insert(schema.workspaceMembers).values([
      { id: randomUUID(), workspaceId: wsA, userId: owner, role: "owner" },
      { id: randomUUID(), workspaceId: wsA, userId: editor, role: "editor" },
      { id: randomUUID(), workspaceId: wsB, userId: owner, role: "owner" },
    ]);
    const connA = await addConnection("discord", { accessToken: `https://discord.com/api/webhooks/1/p6-${tag}`, externalId: "1", displayName: "p6" }, wsA, owner);
    const enqueued: string[] = [];
    const enqueue = async (id: string) => {
      enqueued.push(id);
    };

    // G9 (1): with approval on, an editor's scheduled post is held — createPost makes it `pending`, publishPost refuses,
    // and the scheduler's due query does not even pick it.
    const past = new Date(Date.now() - 60_000);
    const p1 = await createPost(wsA, editor, { text: "P6 editor post", providers: [`discord#${connA}`], status: "scheduled", scheduledAt: past });
    const [r1] = await db.select({ a: schema.socialPosts.approvalStatus }).from(schema.socialPosts).where(eq(schema.socialPosts.id, p1));
    assert.equal(r1.a, "pending", "an editor's scheduled post in an approval workspace is pending");
    const pub1 = await publishPost(p1, { enqueue });
    assert.equal(pub1.ok, false, "publishPost refuses a pending post");
    // A client that skips the composer: force approval_status back to 'none' — still refused (workspace rule).
    await db.update(schema.socialPosts).set({ approvalStatus: "none" }).where(eq(schema.socialPosts.id, p1));
    const pub1b = await publishPost(p1, { enqueue });
    assert.equal(pub1b.ok, false, "publishPost refuses a never-approved post when the workspace requires approval");
    assert.match(pub1b.error ?? "", /approved/i);
    const due1 = await dueScheduledPosts(new Date(), 100, wsA);
    assert.ok(!due1.some((d) => d.id === p1), "the scheduler never picks an unapproved post");
    assert.equal(enqueued.length, 0, "nothing was enqueued");
    assert.equal(await approvalBlock({ workspaceId: wsB, approvalStatus: "none" }), null, "workspace B (no rule) does not block");
    ok("G9: approval on → editor's post is pending; publishPost refuses pending AND never-approved; scheduler skips it; 0 jobs");

    // G9 (2): an editor is not an approver; the owner is. Approving releases it to the scheduler.
    assert.equal(await memberCanApprove(editor, wsA), false);
    assert.equal(await memberCanApprove(owner, wsA), true);
    await db.update(schema.socialPosts).set({ approvalStatus: "pending" }).where(eq(schema.socialPosts.id, p1));
    assert.equal(await decideApproval(wsB, p1, owner, "approved"), false, "a decision from workspace B does not touch A's post");
    assert.equal(await decideApproval(wsA, p1, owner, "approved", "ok"), true);
    const due2 = await dueScheduledPosts(new Date(), 100, wsA);
    assert.ok(due2.some((d) => d.id === p1), "approved + due → the scheduler picks it");
    assert.equal(await decideApproval(wsA, p1, owner, "approved"), false, "deciding twice is refused (only pending can be decided)");
    const reviews = await db.select().from(schema.socialPostReviews).where(eq(schema.socialPostReviews.postId, p1));
    assert.ok(reviews.some((r) => r.decision === "submitted") && reviews.some((r) => r.decision === "approved"), "history has submitted + approved");
    ok("G9: editor is not an approver, owner is; B can't decide A's post; approved → due; history recorded");

    // G9 (3): the review-link token approves exactly its own post, and stops working once the link is turned off.
    const p2 = await createPost(wsA, editor, { text: "P6 token post", providers: [`discord#${connA}`], status: "scheduled", scheduledAt: past });
    const p3 = await createPost(wsA, editor, { text: "P6 other post", providers: [`discord#${connA}`], status: "scheduled", scheduledAt: past });
    const token = `p6tok${randomUUID().replace(/-/g, "")}`.slice(0, 32);
    await db.update(schema.socialPosts).set({ shareToken: token }).where(eq(schema.socialPosts.id, p2));
    const { POST: reviewRoute } = await import("@/app/api/social/review/[token]/route");
    const call = (t: string, body: unknown) =>
      reviewRoute(new Request(`http://x/api/social/review/${t}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ token: t }) });
    assert.equal((await call(token, { decision: "changes_requested" })).status, 400, "changes requested needs a note");
    const okRes = await call(token, { decision: "approved", name: "Client" });
    assert.equal(okRes.status, 200);
    const [s2] = await db.select({ a: schema.socialPosts.approvalStatus }).from(schema.socialPosts).where(eq(schema.socialPosts.id, p2));
    const [s3] = await db.select({ a: schema.socialPosts.approvalStatus }).from(schema.socialPosts).where(eq(schema.socialPosts.id, p3));
    assert.equal(s2.a, "approved", "the token's post is approved");
    assert.equal(s3.a, "pending", "another post is untouched");
    await db.update(schema.socialPosts).set({ approvalStatus: "pending", shareToken: null }).where(eq(schema.socialPosts.id, p2));
    assert.equal((await call(token, { decision: "approved" })).status, 404, "a revoked link answers 404");
    ok("G9: review link approves only its own post; note required for changes; revoked link → 404");

    // G15: a post of workspace A is never readable, decidable or publishable through workspace B.
    assert.equal(await getPost(wsB, p3), null, "getPost with B's context → null");
    assert.equal(await decide({ workspaceId: wsB, postId: p3, decision: "approved" }), false, "decide with B's context → no-op");
    const bWithA = await createPost(wsB, owner, { text: "x", providers: [`discord#${connA}`] }).then(() => "created", (e: Error) => e.message);
    assert.match(bWithA, /Not a channel of this workspace/, "B cannot post through A's channel");
    ok("G15: A's post / channel is invisible and unusable from workspace B");

    // G6: seeded fixture — Tuesday 10:00 (UTC) clearly best on discord → it is the top slot; under 10 posts → general.
    const { rankSlots, MIN_POSTS } = await import("@/lib/social/best-time");
    const base = Date.UTC(2026, 9, 6, 10, 0, 0); // Tue 2026-10-06 10:00 UTC
    const samples = [
      ...Array.from({ length: 6 }, (_, i) => ({ provider: "discord", at: new Date(base + i * 7 * 86_400_000), engagement: 50 })),
      ...Array.from({ length: 6 }, (_, i) => ({ provider: "discord", at: new Date(base + 86_400_000 * 2 + 4 * 3_600_000 + i * 7 * 86_400_000), engagement: 5 })),
    ];
    const ranked = rankSlots(samples, "UTC", new Date(Date.UTC(2026, 10, 14)));
    assert.equal(ranked.personalised, true);
    assert.deepEqual([ranked.slots[0].weekday, ranked.slots[0].hour], [2, 10], "top slot = Tue 10:00");
    const thin = rankSlots(samples.slice(0, MIN_POSTS - 1), "UTC", new Date());
    assert.equal(thin.personalised, false, "below the minimum → not personalised");
    ok(`G6: fixture's best bucket (Tue 10:00) ranks first (lift ${ranked.slots[0].lift}); < ${MIN_POSTS} posts → general guidance`);

    // G14: the dedupe loop — a writer that repeats itself is re-rolled; a slot that stays too similar is dropped.
    const { writeDistinct, cosine, SIM_THRESHOLD } = await import("@/lib/social/content-plan");
    const vec = (t: string) => {
      const v = new Array(26).fill(0);
      for (const ch of t.toLowerCase()) if (ch >= "a" && ch <= "z") v[ch.charCodeAt(0) - 97]++;
      return v;
    };
    let writes = 0;
    const res = await writeDistinct(
      ["a", "b", "c", "d"],
      async (slot, nudge) => {
        writes++;
        if (slot === "b" && nudge === 0) return "apple apple apple"; // duplicate of a → must re-roll
        if (slot === "d") return "apple apple apple"; // always a duplicate → dropped after 3 tries
        return { a: "apple apple apple", b: "zebra quartz jumps", c: "mighty oven kite" }[slot as "a" | "b" | "c"]!;
      },
      async (t) => vec(t),
    );
    assert.deepEqual(res.kept.map((k) => k.slot), ["a", "b", "c"]);
    assert.deepEqual(res.dropped.map((d) => d.slot), ["d"]);
    for (let i = 0; i < res.kept.length; i++)
      for (let j = i + 1; j < res.kept.length; j++)
        assert.ok(cosine(vec(res.kept[i].text), vec(res.kept[j].text)) < SIM_THRESHOLD, "no kept pair at ≥ 0.94");
    assert.equal(writes, 1 + 2 + 1 + 3, "b re-rolled once, d tried 3 times");
    const { planCredits } = await import("@/lib/social/content-plan");
    assert.equal(planCredits(7, false), 0);
    assert.equal(planCredits(7, true), 14);
    ok("G14: duplicates are re-written (b) or dropped after 3 tries (d); kept pairs all < 0.94; plan credits 0 / 7×2");

    // G4: hashtags deduplicated, no spaces, within each network's count.
    const { normalizeHashtags, hashtagMax, withHashtags } = await import("@/lib/social/hashtags");
    const tags = normalizeHashtags("#Coffee #coffee  #Cold Brew, #cold_brew #2026 #café #a-b", hashtagMax("x"));
    assert.deepEqual(tags, ["#Coffee", "#Cold"], "X takes 2, deduped case-insensitively, digits-only dropped");
    const ig = normalizeHashtags(Array.from({ length: 40 }, (_, i) => `#tag${i}`).join(" "), hashtagMax("instagram"));
    assert.equal(ig.length, 30, "Instagram capped at 30");
    assert.ok(ig.every((t) => !/\s/.test(t)), "no spaces");
    assert.equal(hashtagMax("email"), 0);
    const fitted = withHashtags("x".repeat(270), ["#one", "#two"], 280);
    assert.ok([...fitted].length <= 280, "tags dropped rather than overflowing X");
    ok("G4: hashtags deduped, no spaces, per-network caps (X 2, IG 30, email 0), never overflow the text limit");

    // G8: the checklist is explainable and bounded; Spearman sanity.
    const { scoreChecks, spearman } = await import("@/lib/social/score-checks");
    const good = scoreChecks({ text: "Short hook?\n\nBody #a #b", hasImage: true, hasVideo: false, providers: ["x"], timing: "personalised" });
    const bad = scoreChecks({ text: "x".repeat(400), hasImage: false, hasVideo: false, providers: ["x"], timing: "other" });
    assert.ok(good.total > bad.total && good.total <= 100 && bad.total >= 0);
    assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
    assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
    ok(`G8: checklist ${good.total} vs ${bad.total}; Spearman ±1 on monotone data`);

    // G3: product page parsing + the SSRF guard on the same fetcher.
    const { readProduct, fetchPublic } = await import("../worker/deck/importer.mjs");
    const prod = readProduct(
      `<script type="application/ld+json">{"@type":"Product","name":"Mug","image":"/m.jpg","offers":{"price":"12.50","priceCurrency":"USD"}}</script>`,
      "https://shop.test/p",
    );
    assert.deepEqual([prod.name, prod.price, prod.currency, prod.images[0], prod.source], ["Mug", "12.50", "USD", "https://shop.test/m.jpg", "jsonld"]);
    for (const u of ["http://127.0.0.1/", "http://10.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/"]) {
      await assert.rejects(fetchPublic(u), /public website|isn't a public|Couldn't find/, `fetchPublic must refuse ${u}`);
    }
    ok("G3: JSON-LD product read (name/price/currency/image); fetchPublic refuses loopback / RFC1918 / metadata / [::1]");
  } finally {
    await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [wsA, wsB]));
    await db.delete(schema.user).where(inArray(schema.user.id, [owner, editor]));
    const left = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(inArray(schema.workspaces.id, [wsA, wsB]));
    console.log(`cleanup: P6 test workspaces removed=${left.length === 0}`);
  }
}

console.log(`\n${results.length} checks passed`);
process.exit(0);
