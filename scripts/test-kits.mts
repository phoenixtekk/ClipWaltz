// Post kits acceptance test. DEV ONLY: refuses unless DATABASE_URL is clipwaltz_dev. Uses the real AI Box and MinIO.
//
//   node --env-file=.env.local --import ./scripts/lib/server-only-stub.mjs --import tsx scripts/test-kits.mts
//
// Creates a throwaway user + workspace, makes a text kit, an upload kit and a design kit, checks sizes, captions, edits
// under a concurrent build, the atomic "writing" claim, cross-workspace isolation and clean-up; removes everything.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

if (!/\/clipwaltz_dev(\?|$)/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL is not the clipwaltz_dev database.");
  process.exit(1);
}
const sharp = (await import("sharp")).default;
const { db, schema } = await import("@/db");
const { eq, inArray } = await import("drizzle-orm");
const { createMedia } = await import("@/lib/social/posts");
const { readMedia } = await import("@/lib/social/media");
const K = await import("@/lib/kits/kits");
const { defaultData } = await import("@/lib/image-ad/designs");

// Keep the process alive across awaits whose handles are unref'd (canvas / pg idle sockets); exit() ends it.
setInterval(() => {}, 1000);
let pass = 0;
const ok = (name: string) => { pass++; console.log(`  ✓ ${name}`); };

const userId = `kits-test-${randomUUID()}`;
const ws = randomUUID();
const ws2 = randomUUID();
await db.insert(schema.user).values({ id: userId, name: "Kits test", email: `${userId}@example.invalid`, emailVerified: true });
await db.insert(schema.workspaces).values([{ id: ws, name: "Kits test", ownerUserId: userId, isPersonal: false }, { id: ws2, name: "Kits test 2", ownerUserId: userId, isPersonal: false }]);
await db.insert(schema.workspaceMembers).values({ id: randomUUID(), workspaceId: ws, userId, role: "owner" });
const madeMedia: string[] = [];

try {
  // 1. Text-only kit
  const textId = await K.createKit(userId, ws, { title: "Spring sale", brief: "Our spring sale starts Monday: 20% off every plan for a week.", link: "https://www.clipwaltz.com/pricing", networks: ["linkedin", "x", "instagram"] });
  let row = (await K.getKitRow(ws, textId))!;
  assert.equal(row.networks, "linkedin,x", "instagram dropped: it needs media");
  ok("text kit drops networks that need media");
  await K.buildKit(textId);
  row = (await K.getKitRow(ws, textId))!;
  assert.equal(row.status, "ready", `status ${row.status} ${row.error}`);
  const ti = row.items as { provider: string; caption: string }[];
  assert.equal(ti.length, 2);
  for (const i of ti) assert.ok(i.caption.length > 20, `${i.provider} caption empty`);
  assert.ok(ti.find((i) => i.provider === "x")!.caption.length <= 280, "X caption over 280");
  ok(`text kit captions written (x ${ti.find((i) => i.provider === "x")!.caption.length} chars)`);

  // 2. Upload kit — a 1600×1000 photo cropped per network
  const png = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: 40, g: 90, b: 200 } } }).png().toBuffer();
  const up = await createMedia(ws, userId, { name: "photo.png", type: "image/png", bytes: new Uint8Array(png) });
  madeMedia.push(up.id);
  const upId = await K.createKit(userId, ws, { title: "", brief: "A calm blue background for our new wallpaper pack.", link: null, networks: ["instagram", "pinterest", "x", "youtube"], mediaIds: [up.id] });
  row = (await K.getKitRow(ws, upId))!;
  assert.equal(row.networks, "instagram,x,pinterest", "youtube dropped for images; catalogue order kept");
  await K.buildKit(upId);
  row = (await K.getKitRow(ws, upId))!;
  assert.equal(row.status, "ready", `status ${row.status} ${row.error}`);
  const ua = row.assets as { format: string; mediaId: string; width: number | null; height: number | null }[];
  const want: Record<string, [number, number]> = { "4:5": [1080, 1350], "2:3": [1000, 1500], "1.91:1": [1200, 628] };
  for (const [f, [w, h]] of Object.entries(want)) {
    const a = ua.find((x) => x.format === f);
    assert.ok(a, `no ${f} asset`);
    const meta = await sharp(await readMedia(a.mediaId, ws)).metadata();
    assert.deepEqual([meta.width, meta.height], [w, h], `${f} is ${meta.width}x${meta.height}`);
  }
  assert.ok(ua.some((x) => x.format === "original" && x.mediaId === up.id), "original kept");
  ok("upload kit: 4:5 1080×1350, 2:3 1000×1500, 1.91:1 1200×628 + original");
  const pin = (row.items as { provider: string; title: string; format: string }[]).find((i) => i.provider === "pinterest")!;
  assert.ok(pin.title.length > 0 && pin.title.length <= 100, "pinterest title");
  assert.equal(pin.format, "2:3");
  ok(`pinterest title "${pin.title}"`);

  // 3. Design kit — redrawn per format, not cropped
  const designId = randomUUID();
  await db.insert(schema.imageDesigns).values({ id: designId, workspaceId: ws, createdBy: userId, kind: "image", title: "Launch ad", format: "1:1", data: { ...defaultData("image"), headline: "Launch day", subhead: "Make videos in minutes", cta: "Try it free" } });
  const dId = await K.createKit(userId, ws, { title: "", brief: "", link: null, networks: ["instagram", "linkedin", "tiktok"], design: designId });
  await K.buildKit(dId);
  row = (await K.getKitRow(ws, dId))!;
  assert.equal(row.status, "ready", `status ${row.status} ${row.error}`);
  const da = row.assets as { format: string; width: number; height: number }[];
  assert.deepEqual(da.map((a) => `${a.format}=${a.width}x${a.height}`).sort(), ["1:1=1080x1080", "4:5=1080x1350", "9:16=1080x1920"]);
  assert.equal(row.title, "Launch ad");
  ok("design kit redrawn at 1:1, 4:5, 9:16; title taken from the design");

  // 4. Edits during a running build survive (row lock)
  const build = K.buildKit(textId, { only: "linkedin" });
  await K.updateKitItem(ws, textId, "x", { posted: true, postedUrl: "https://x.com/clipwaltz/status/1" });
  await build;
  row = (await K.getKitRow(ws, textId))!;
  const x = (row.items as { provider: string; postedAt: string | null; postedUrl: string | null }[]).find((i) => i.provider === "x")!;
  assert.ok(x.postedAt && x.postedUrl === "https://x.com/clipwaltz/status/1", "posted mark lost during build");
  ok("Posted mark made during a build is kept");
  await assert.rejects(K.updateKitItem(ws, textId, "x", { postedUrl: "javascript:alert(1)" }), /http/);
  ok("non-http post link refused");

  // 5. Atomic claim
  const claims = await Promise.allSettled([K.markWriting(ws, textId), K.markWriting(ws, textId)]);
  assert.equal(claims.filter((c) => c.status === "fulfilled").length, 1, "two builds claimed");
  ok("only one of two simultaneous Write again clicks starts a build");
  await db.update(schema.postKits).set({ status: "ready" }).where(eq(schema.postKits.id, textId));

  // 6. Isolation + kind filter
  assert.equal(await K.getKitRow(ws2, textId), null);
  ok("another workspace can't read the kit");
  const audioId = randomUUID();
  await db.insert(schema.socialMedia).values({ id: audioId, workspaceId: ws, createdBy: userId, kind: "audio", filename: "a.mp3", mime: "audio/mpeg", size: 1, storageKey: `social/${ws}/${audioId}` });
  madeMedia.push(audioId);
  await assert.rejects(K.createKit(userId, ws, { title: "t", brief: "b", link: null, networks: ["facebook"], mediaIds: [audioId] }), /not found/);
  ok("audio media can't be put in a kit");

  // 7. Delete removes the kit's pictures
  const before = (row = (await K.getKitRow(ws, upId))!).assets as { mediaId: string }[];
  await K.deleteKit(ws, upId);
  const left = await db.select({ id: schema.socialMedia.id }).from(schema.socialMedia).where(inArray(schema.socialMedia.id, before.map((a) => a.mediaId)));
  assert.equal(left.length, 0, `${left.length} media rows left`);
  assert.equal(await K.getKitRow(ws, upId), null);
  ok("deleting a kit removes its pictures and upload");

  console.log(`\n${pass} checks passed`);
} catch (e) {
  process.exitCode = 1;
  const err = e as Error & { cause?: { message?: string } };
  console.error(`\nFAILED: ${err?.message ?? String(e)}${err?.cause?.message ? `\n  cause: ${err.cause.message}` : ""}`);
} finally {
  for (const k of await db.select({ id: schema.postKits.id }).from(schema.postKits).where(inArray(schema.postKits.workspaceId, [ws, ws2]))) await K.deleteKit(ws, k.id).catch(() => {});
  await db.delete(schema.socialMedia).where(inArray(schema.socialMedia.id, madeMedia)).catch(() => {});
  await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [ws, ws2]));
  await db.delete(schema.user).where(eq(schema.user.id, userId));
  process.exit(process.exitCode ?? 0);
}
