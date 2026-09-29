// WaltzDeck background jobs on the "clipwaltz-deck" BullMQ queue (consumed by the generation worker).
//   describe {assetId}              — vision description of one photo/video, cached on assets.ai_description
//   plan     {projectId}            — describe what's missing, then (re)plan the storyboard around locked scenes
//   scene    {sceneId, instruction} — rewrite one scene's on-screen text
// Progress and results live in the DB (projects.deck.plan, deck_scenes) so the editor just polls.
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import IORedis from "ioredis";
import { Worker } from "bullmq";
import { describeMedia, planStoryboard, rewriteScene, VISION_MODEL } from "./planner.mjs";

// DECK_QUEUE override: local dev uses its own queue so the prod worker never sees dev-DB jobs.
export const DECK_QUEUE = process.env.DECK_QUEUE || "clipwaltz-deck";

export function startDeckWorker({ sql, getBytes, run, redisUrl }) {
  // Frames for the vision model: 3 across a video (20/50/80 %), 1 for a photo; 512 px wide JPEGs.
  async function framesOf(asset) {
    const dir = mkdtempSync(join(tmpdir(), "cw-deck-"));
    try {
      const src = join(dir, "src");
      writeFileSync(src, await getBytes(asset.converted_key ?? asset.storage_key));
      const ats = asset.kind === "video" ? [0.2, 0.5, 0.8].map((f) => f * (asset.duration_sec || 3)) : [0];
      const out = [];
      for (const [i, at] of ats.entries()) {
        const f = join(dir, `f${i}.jpg`);
        try {
          await run("ffmpeg", ["-v", "error", "-y", "-ss", at.toFixed(2), "-i", src, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "4", f]);
          out.push(readFileSync(f).toString("base64"));
        } catch { /* skip an unreadable frame */ }
      }
      return out;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async function describe(assetId) {
    const [a] = await sql`select id, kind, storage_key, converted_key, duration_sec, note, ai_description from assets where id = ${assetId}`;
    if (!a) return null;
    if (a.ai_description?.model === VISION_MODEL && a.ai_description?.summary) return a.ai_description;
    const frames = await framesOf(a);
    if (!frames.length) throw new Error("could not read any frame from this file");
    const desc = { ...(await describeMedia(frames, { kind: a.kind, note: a.note, durationSec: a.duration_sec })), at: new Date().toISOString() };
    await sql`update assets set ai_description = ${sql.json(desc)} where id = ${assetId}`;
    return desc;
  }

  const setPlan = (projectId, plan) =>
    sql`update projects set deck = jsonb_set(coalesce(deck, '{}'::jsonb), '{plan}', ${sql.json(plan)}), updated_at = now() where id = ${projectId}`;

  async function loadMedia(projectId) {
    return sql`select id, kind, original_name, duration_sec, note, ai_description from assets
      where project_id = ${projectId} and upload_state = 'uploaded' and not hidden
        and (source_format is null or conversion_state = 'ready')
      order by order_index asc, created_at asc`;
  }

  async function plan(projectId) {
    const [p] = await sql`select id, deck from projects where id = ${projectId} and kind = 'deck'`;
    if (!p) return;
    const brief = p.deck?.brief ?? {};
    const started = new Date().toISOString();
    try {
      const assets = await loadMedia(projectId);
      if (!assets.length) throw new Error("Add some photos or videos first.");
      const todo = assets.filter((a) => !(a.ai_description?.model === VISION_MODEL && a.ai_description?.summary));
      for (const [i, a] of todo.entries()) {
        await setPlan(projectId, { status: "describing", done: i, total: todo.length, startedAt: started });
        try {
          a.ai_description = await describe(a.id);
        } catch (e) {
          console.error(`[deck] describe ${a.id} failed: ${e.message}`); // planned without a description
        }
      }
      await setPlan(projectId, { status: "planning", startedAt: started });
      const locked = await sql`select * from deck_scenes where project_id = ${projectId} and locked order by order_index`;
      const media = assets.map((a) => ({ id: a.id, kind: a.kind, durationSec: a.duration_sec, note: a.note, desc: a.ai_description }));
      const result = await planStoryboard(
        brief,
        media,
        locked.map((l) => ({ orderIndex: l.order_index, role: l.role, assetId: l.asset_id, durationSec: l.duration_sec, text: l.text })),
      );
      // New scenes fill the slots around the locked ones; locked scenes keep their position.
      const order = result.scenes.map((s) => ({ ...s, locked: false }));
      for (const l of locked) order.splice(Math.min(l.order_index, order.length), 0, { lockedRow: l });
      await sql.begin(async (tx) => {
        await tx`delete from deck_scenes where project_id = ${projectId} and not locked`;
        for (const [i, s] of order.entries()) {
          if (s.lockedRow) {
            await tx`update deck_scenes set order_index = ${i}, updated_at = now() where id = ${s.lockedRow.id}`;
            continue;
          }
          const textMode = brief.textMode === "off" && s.role !== "cta" ? "none" : "auto";
          await tx`insert into deck_scenes ${tx({
            id: randomUUID(), project_id: projectId, order_index: i, role: s.role, asset_id: s.assetId,
            duration_sec: s.durationSec, text_mode: textMode, text: tx.json(s.text), layout: s.layout,
            why: s.flags?.includes("removed-unverified-number") ? `${s.why} (Removed a number that wasn't in your brief.)`.trim() : s.why,
          })}`;
        }
      });
      const used = new Set(result.scenes.map((s) => s.assetId).filter(Boolean));
      for (const l of locked) if (l.asset_id) used.add(l.asset_id);
      await setPlan(projectId, {
        status: "ready", title: result.title, startedAt: started, finishedAt: new Date().toISOString(),
        unusedAssetIds: assets.filter((a) => !used.has(a.id)).map((a) => a.id), stats: result.stats,
      });
      console.log(`[deck] planned ${projectId}: ${order.length} scenes (${locked.length} locked) in ${result.stats.ms} ms`);
    } catch (e) {
      console.error(`[deck] plan ${projectId} failed: ${e.message}`);
      await setPlan(projectId, { status: "failed", error: String(e.message).slice(0, 300), startedAt: started });
    }
  }

  async function scene(sceneId, instruction) {
    const [s] = await sql`select ds.*, p.deck from deck_scenes ds join projects p on p.id = ds.project_id where ds.id = ${sceneId}`;
    if (!s) return;
    await sql`update deck_scenes set why = ${"Rewriting…"}, updated_at = now() where id = ${sceneId}`;
    try {
      const [a] = s.asset_id ? await sql`select id, kind, duration_sec, note, ai_description from assets where id = ${s.asset_id}` : [];
      const others = await sql`select text from deck_scenes where project_id = ${s.project_id} and id <> ${sceneId}`;
      const text = await rewriteScene(
        s.deck?.brief ?? {},
        { role: s.role, durationSec: s.duration_sec, layout: s.layout, text: s.text },
        a ? { id: a.id, kind: a.kind, durationSec: a.duration_sec, note: a.note, desc: a.ai_description } : null,
        instruction,
        others.map((o) => o.text?.headline).filter(Boolean),
      );
      const { flags, ...clean } = text;
      await sql`update deck_scenes set text = ${sql.json(clean)}, text_mode = 'auto',
        why = ${flags ? "Rewritten (removed a number that wasn't in your brief)." : "Rewritten."}, updated_at = now() where id = ${sceneId}`;
    } catch (e) {
      await sql`update deck_scenes set why = ${`Couldn't rewrite: ${String(e.message).slice(0, 120)}`}, updated_at = now() where id = ${sceneId}`;
    }
  }

  const w = new Worker(
    DECK_QUEUE,
    async (job) => {
      const d = job.data ?? {};
      if (job.name === "describe") await describe(d.assetId);
      else if (job.name === "plan") await plan(d.projectId);
      else if (job.name === "scene") await scene(d.sceneId, d.instruction);
    },
    // One at a time: the Ollama box is shared, parallel calls only queue there and evict models.
    { connection: new IORedis(redisUrl, { maxRetriesPerRequest: null }), concurrency: 1, lockDuration: 15 * 60 * 1000 },
  );
  w.on("failed", (job, err) => console.error(`[deck] job ${job?.name} ${job?.id} failed: ${err?.message}`));
  console.log(`[deck] WaltzDeck worker up (queue=${DECK_QUEUE}, model=${VISION_MODEL})`);
  return w;
}
