// G8: report the engagement-estimate calibration for a workspace — READ-ONLY (computeCalibration writes nothing).
//   node --env-file=.env.local --import tsx scripts/score-calibration.mts <owner email>
const email = process.argv[2];
if (!email) {
  console.error("usage: score-calibration.mts <owner email>");
  process.exit(1);
}
const { db, schema } = await import("@/db");
const { and, eq } = await import("drizzle-orm");
const { computeCalibration } = await import("@/lib/social/score");
const [u] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email));
if (!u) throw new Error("no such user");
const ws = await db.select({ id: schema.workspaces.id, name: schema.workspaces.name }).from(schema.workspaces).where(and(eq(schema.workspaces.ownerUserId, u.id)));
for (const w of ws) {
  const c = await computeCalibration(w.id);
  console.log(JSON.stringify({ workspace: w.name, posts: c.posts, rho: c.rho, showScore: c.showScore }));
}
process.exit(0);
