// Waltz Image job (generation_jobs.job_type = 'image', plan §4.5): one AI picture on the ComfyUI box (D1), run by the
// generation worker (worker/generation-worker.mjs → processJob). Also run directly by scripts/verify-image-presets.mjs,
// so the verification exercises this exact code.
//
//   request_json: { brief, style, format, enhance, designId?, imageId?, socialPostId? }
//
// Where the picture goes:
//   • designId + imageId → MinIO images/<ws>/<designId>/pic/<imageId>.png, and the image_design_images row is filled in
//     (the editor polls it). Text is never drawn here — the app composites it later (worker/image/compose.mjs).
//   • socialPostId → a social_media row (source 'ai') attached to the post, then the post is released back to the
//     scheduler ('rendering' → 'scheduled', due now) so the next sweep publishes it with the picture.
// A failed job is refunded by the credit ledger (status 'failed'); `afterImageJobFailure` releases a waiting post so it
// publishes without the picture rather than waiting forever.
import { randomUUID } from "node:crypto";
import { renderComfyImage, writeImagePrompt } from "./comfy.mjs";

const ID = /^[a-f0-9-]{36}$/i;

/**
 * @param {{ sql: any, putBytes: (key: string, body: Buffer, type: string) => Promise<unknown>,
 *           setStatus: (id: string, fields: Record<string, unknown>) => Promise<void>,
 *           wasCancelled: (id: string) => Promise<boolean> }} ctx
 * @param {any} j generation_jobs row
 */
export async function runImageJob(ctx, j) {
  const { sql, putBytes, setStatus, wasCancelled } = ctx;
  const req = j.request_json ?? {};
  await setStatus(j.id, { status: "generating", progress: 10, started_at: new Date() });

  const brief = String(req.brief ?? j.prompt ?? "").trim();
  if (!brief) throw new Error("No description for the picture.");
  const prompt = req.enhance === false ? brief : await writeImagePrompt(brief, req.style);
  if (await wasCancelled(j.id)) return null;

  let last = 0;
  const r = await renderComfyImage({
    prompt,
    style: req.style,
    format: req.format,
    jobId: j.id,
    isCancelled: () => wasCancelled(j.id),
    onProgress: (pct) => {
      if (pct - last >= 10) {
        last = pct;
        setStatus(j.id, { progress: pct }).catch(() => {});
      }
    },
  });
  if (!r) return null; // cancelled mid-render
  if (await wasCancelled(j.id)) return null;
  await setStatus(j.id, { status: "uploading_output", progress: 90 });

  let key = null;
  if (req.socialPostId && ID.test(String(req.socialPostId))) {
    key = await attachToPost(ctx, j, req.socialPostId, r.png);
  } else if (req.designId && req.imageId && ID.test(String(req.designId)) && ID.test(String(req.imageId))) {
    key = `images/${j.workspace_id}/${req.designId}/pic/${req.imageId}.png`;
    await putBytes(key, r.png, "image/png");
    const done = await sql`update image_design_images set storage_key = ${key}, width = ${req.width ?? null}, height = ${req.height ?? null},
      prompt = ${prompt.slice(0, 2000)} where id = ${req.imageId} and design_id = ${req.designId} returning id`;
    if (!done.length) console.warn(`[image] ${j.id}: design picture row is gone (design deleted?) — result kept at ${key}`);
  } else {
    throw new Error("Image job has nowhere to put the picture.");
  }

  await sql`update generation_jobs set status = 'completed', progress = 100, completed_at = now(), updated_at = now(),
    request_json = ${sql.json({ ...req, seed: r.seed, ckpt: r.ckpt, finalPrompt: prompt.slice(0, 2000), outputKey: key })}
    where id = ${j.id} and status not in ('cancelled', 'retried')`;
  console.log(`[image] ${j.id} done → ${key} (${req.format}, seed ${r.seed})`);
  return { key, png: r.png, seed: r.seed };
}

async function attachToPost({ sql, putBytes }, j, postId, png) {
  const [p] = await sql`select id, workspace_id, created_by from social_posts where id = ${postId}`;
  if (!p) throw new Error("The post was deleted.");
  const mediaId = randomUUID();
  const key = `social/${p.workspace_id}/${mediaId}`;
  await putBytes(key, png, "image/png");
  await sql`insert into social_media ${sql({ id: mediaId, workspace_id: p.workspace_id, created_by: j.requested_by ?? p.created_by, post_id: postId,
    kind: "image", filename: "ai-image.png", mime: "image/png", size: png.length, storage_key: key, source: "ai" })}`;
  await releasePost(sql, postId);
  return key;
}

/** Hand a post that waited for its picture back to the scheduler: due now, so the next sweep (≤ 60 s) publishes it. */
async function releasePost(sql, postId) {
  await sql`update social_posts set status = 'scheduled', scheduled_at = now(), updated_at = now()
    where id = ${postId} and status = 'rendering'`;
}

/** Called by the generation worker after a job's attempt failed. Releases a waiting post once the job is final. */
export async function afterImageJobFailure(sql, id) {
  const [j] = await sql`select job_type, status, request_json from generation_jobs where id = ${id}`;
  if (!j || j.job_type !== "image" || j.status !== "failed") return;
  const postId = j.request_json?.socialPostId;
  if (postId && ID.test(String(postId))) await releasePost(sql, postId);
}
