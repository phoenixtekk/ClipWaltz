// P5 end-to-end check on the DEV database (never prod): a podcast show, one explainer episode published to it, and one
// review-first Short — rendered by the AI-box render worker (`--social-once` against clipwaltz_dev), finalized and
// published by the social sweep. No external network is published to: the explainer's only destination is the dev
// podcast show (an internal feed), and the Short is held as a draft.
//
//   node --env-file=.env.local --import tsx scripts/test-p5-render.mts create <account-email>
//   node --env-file=.env.local --import tsx scripts/test-p5-render.mts status
//   node --env-file=.env.local --import tsx worker/social-worker.mjs --sweep-once --inline     # finalize + publish
//   node --env-file=.env.local --import tsx scripts/test-p5-render.mts cleanup
//
// State (ids) is kept in .p5-test.json in the repo root; `cleanup` deletes everything the test made and the file.
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { saveShow } from "@/lib/podcast/shows";
import { startExplainer, startShort } from "@/lib/social/render-jobs";
import { deleteMedia } from "@/lib/social/media";

const STATE = ".p5-test.json";
const [cmd, email] = process.argv.slice(2);
if (!/clipwaltz_dev/.test(process.env.DATABASE_URL ?? "")) throw new Error("DEV database only (DATABASE_URL must be clipwaltz_dev)");

async function create() {
  if (!email) throw new Error("usage: create <account-email>");
  const [u] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);
  if (!u) throw new Error(`no account ${email}`);
  const [ws] = await db.select().from(schema.workspaces).where(and(eq(schema.workspaces.ownerUserId, u.id), eq(schema.workspaces.isPersonal, true))).limit(1);
  const slug = `p5-dev-test-${Date.now().toString(36)}`;
  const show = await saveShow(ws.id, u.id, {
    title: "ClipWaltz P5 Dev Test", description: "Dev-only test show for the P5 explainer → podcast pipeline.", author: "ClipWaltz",
    category: "Technology", slug,
  });
  if (!show.ok) throw new Error(show.error);
  const [conn] = await db.select().from(schema.socialConnections).where(and(eq(schema.socialConnections.workspaceId, ws.id), eq(schema.socialConnections.externalId, show.id)));
  const ex = await startExplainer({
    workspaceId: ws.id, userId: u.id, keys: [`podcast#${conn.id}`], reviewFirst: false,
    topic: "Why a backup you have never restored is not a backup",
    seedPrompt: "A practical channel for small-business IT owners. Plain, calm, specific. Close by telling the viewer to test one restore this week.",
  });
  // The Short's destination: an existing (paused) connection of this workspace — review-first, so it is never sent.
  const [anyConn] = await db.select().from(schema.socialConnections).where(and(eq(schema.socialConnections.workspaceId, ws.id), eq(schema.socialConnections.provider, "youtube")));
  const sh = await startShort({
    workspaceId: ws.id, userId: u.id, keys: anyConn ? [`youtube#${anyConn.id}`] : [], source: "seed", reviewFirst: true,
    topic: "Three checks before you trust a restore", seedPrompt: "Small-business IT owners. Concrete steps only.",
  });
  writeFileSync(STATE, JSON.stringify({ workspaceId: ws.id, showId: show.id, slug, connId: conn.id, explainer: ex, short: sh }, null, 2));
  console.log({ feed: show.feedUrl, explainer: ex, short: sh });
}

async function status() {
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  const jobs = await db.select({ id: schema.socialRenderJobs.id, kind: schema.socialRenderJobs.kind, status: schema.socialRenderJobs.status, stage: schema.socialRenderJobs.stage, progress: schema.socialRenderJobs.progress, error: schema.socialRenderJobs.error, finalizedAt: schema.socialRenderJobs.finalizedAt, chargeId: schema.socialRenderJobs.chargeId })
    .from(schema.socialRenderJobs).where(inArray(schema.socialRenderJobs.id, [st.explainer.jobId, st.short.jobId]));
  const posts = await db.select({ id: schema.socialPosts.id, status: schema.socialPosts.status, text: schema.socialPosts.text, perNetwork: schema.socialPosts.perNetwork, warnings: schema.socialPosts.warnings })
    .from(schema.socialPosts).where(inArray(schema.socialPosts.id, [st.explainer.postId, st.short.postId]));
  const charges = await db.select({ id: schema.generationJobs.id, status: schema.generationJobs.status, credits: schema.generationJobs.credits }).from(schema.generationJobs).where(inArray(schema.generationJobs.id, jobs.map((j) => j.chargeId!).filter(Boolean)));
  const media = await db.select({ id: schema.socialMedia.id, kind: schema.socialMedia.kind, filename: schema.socialMedia.filename, size: schema.socialMedia.size, postId: schema.socialMedia.postId }).from(schema.socialMedia).where(eq(schema.socialMedia.workspaceId, st.workspaceId));
  const eps = await db.select().from(schema.podcastEpisodes).where(eq(schema.podcastEpisodes.showId, st.showId));
  const targets = await db.select({ provider: schema.socialPostTargets.provider, status: schema.socialPostTargets.status, url: schema.socialPostTargets.url, error: schema.socialPostTargets.error }).from(schema.socialPostTargets).where(inArray(schema.socialPostTargets.postId, [st.explainer.postId, st.short.postId]));
  console.log(JSON.stringify({ jobs, posts, charges, media, episodes: eps, targets }, null, 2));
}

async function cleanup() {
  if (!existsSync(STATE)) return console.log("nothing to clean");
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  // Extra runs recorded in the state file (e.g. a second explainer) are cleaned the same way.
  const extra = Object.keys(st).filter((k) => /^(explainer|short)\d+$/.test(k)).map((k) => st[k] as { postId: string; jobId: string });
  const jobs = await db.select({ chargeId: schema.socialRenderJobs.chargeId, payload: schema.socialRenderJobs.payload }).from(schema.socialRenderJobs).where(inArray(schema.socialRenderJobs.id, [st.explainer.jobId, st.short.jobId, ...extra.map((e) => e.jobId)]));
  // Only this test's files: the posts' media, the show cover, and any narration parts still listed on the job.
  const [show] = await db.select({ cover: schema.podcastShows.coverMediaId }).from(schema.podcastShows).where(eq(schema.podcastShows.id, st.showId));
  const postIds = [st.explainer.postId, st.short.postId, ...extra.map((e) => e.postId)];
  const postMedia = await db.select({ id: schema.socialMedia.id }).from(schema.socialMedia).where(inArray(schema.socialMedia.postId, postIds));
  const narration = jobs.flatMap((j) => ((j.payload as { narrationMediaIds?: string[] }).narrationMediaIds ?? []));
  const ids = [...new Set([...postMedia.map((m) => m.id), ...(show?.cover ? [show.cover] : []), ...narration])];
  await db.delete(schema.podcastShows).where(eq(schema.podcastShows.id, st.showId)); // episodes + listens cascade
  await db.delete(schema.socialConnections).where(eq(schema.socialConnections.id, st.connId));
  await db.delete(schema.socialPosts).where(inArray(schema.socialPosts.id, postIds)); // jobs + targets cascade
  for (const id of ids) {
    await deleteMedia(id).catch(() => {});
    await db.delete(schema.socialMedia).where(and(eq(schema.socialMedia.id, id), eq(schema.socialMedia.workspaceId, st.workspaceId)));
  }
  const media = ids;
  const charges = jobs.map((j) => j.chargeId).filter((x): x is string => Boolean(x));
  if (charges.length) await db.delete(schema.generationJobs).where(inArray(schema.generationJobs.id, charges));
  rmSync(STATE);
  console.log(`cleaned: show, connection, ${postIds.length} posts (+ jobs/targets), ${media.length} media rows + objects, ${charges.length} charge rows`);
}

try {
  if (cmd === "create") await create();
  else if (cmd === "status") await status();
  else if (cmd === "cleanup") await cleanup();
  else console.log("usage: create <email> | status | cleanup");
} finally {
  process.exit(0);
}
