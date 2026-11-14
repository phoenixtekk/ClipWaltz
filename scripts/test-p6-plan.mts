// P6 G14 acceptance on the DEV database with the real AI Box: write a 7-day plan (nothing saved) and report every
// pair's cosine similarity — none may be ≥ 0.94. 0 credits (no image option), no rows written.
//   node --env-file=.env.local --import tsx scripts/test-p6-plan.mts
const url = process.env.DATABASE_URL ?? "";
if (!/\/clipwaltz_dev(\?|$)/.test(url)) {
  console.error("Refusing to run: DATABASE_URL is not the clipwaltz_dev database.");
  process.exit(1);
}
const { db, schema } = await import("@/db");
const { buildPlan, embed, cosine, SIM_THRESHOLD } = await import("@/lib/social/content-plan");
const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).limit(1);
const t0 = Date.now();
const plan = await buildPlan(ws.id, {
  brief: "ClipWaltz turns your phone clips into beat-synced music videos in minutes. New: post them straight to TikTok, Instagram and YouTube from the app.",
  days: 7,
  perDay: 1,
  angles: ["problem", "educational", "proof", "minimal"],
  keys: [],
  providers: ["linkedin", "x"],
  autoImage: false,
});
console.log(`wrote ${plan.drafts.length} drafts, dropped ${plan.dropped.length}, in ${Math.round((Date.now() - t0) / 1000)} s; credits ${plan.credits}`);
const vecs: number[][] = [];
for (const d of plan.drafts) {
  const v = await embed(d.text);
  if (!v) throw new Error("embedding unavailable");
  vecs.push(v);
  console.log(`- [${d.angle}] ${d.at} sim=${d.similarity} :: ${d.text.replace(/\s+/g, " ").slice(0, 110)}`);
}
let max = 0;
for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) max = Math.max(max, cosine(vecs[i], vecs[j]));
console.log(`max pairwise cosine = ${max.toFixed(4)} (threshold ${SIM_THRESHOLD}) → ${max < SIM_THRESHOLD ? "PASS" : "FAIL"}`);
for (const d of plan.dropped) console.log(`dropped [${d.angle}] ${d.reason}`);
process.exit(max < SIM_THRESHOLD && plan.drafts.length > 0 ? 0 : 1);
