// P6 dev UI seed (DEV DB only): in the test account's "P6 Client Test" workspace, add a fake Discord channel (never
// published to — the post is only approved, not published) and one post awaiting approval with a review link.
//   node --env-file=.env.local --import tsx scripts/test-p6-ui-seed.mts [--cleanup]
import { randomUUID } from "node:crypto";
const url = process.env.DATABASE_URL ?? "";
if (!/\/clipwaltz_dev(\?|$)/.test(url)) {
  console.error("Refusing to run: DATABASE_URL is not the clipwaltz_dev database.");
  process.exit(1);
}
const { db, schema } = await import("@/db");
const { and, eq } = await import("drizzle-orm");
const [u] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, "p2-publish-test@clipwaltz.test"));
const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(and(eq(schema.workspaces.ownerUserId, u.id), eq(schema.workspaces.name, "P6 Client Test")));
if (!ws) throw new Error("create the P6 Client Test workspace first");
if (process.argv.includes("--cleanup")) {
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
  console.log("deleted P6 Client Test workspace (cascade)");
  process.exit(0);
}
const { addConnection } = await import("@/lib/social/connections");
const conn = await addConnection("discord", { accessToken: `https://discord.com/api/webhooks/1/p6-ui-${randomUUID()}`, externalId: "1", displayName: "P6 test channel" }, ws.id, u.id);
const id = randomUUID();
const token = randomUUID().replace(/-/g, "").slice(0, 24);
await db.insert(schema.socialPosts).values({
  id, workspaceId: ws.id, createdBy: u.id, text: "Our new cold brew lands Friday. Want first dibs? #coffee #coldbrew", status: "scheduled",
  scheduledAt: new Date(Date.now() + 3 * 86_400_000), providers: `discord#${conn}`, approvalStatus: "pending", shareToken: token,
});
await db.insert(schema.socialPostReviews).values({ id: randomUUID(), postId: id, workspaceId: ws.id, reviewerUserId: u.id, decision: "submitted" });
console.log(JSON.stringify({ post: id, token }));
process.exit(0);
