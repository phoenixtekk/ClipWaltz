import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { enqueueGeneration } from "@/lib/queue";
import { spendCredits } from "@/lib/credits-ledger";
import { IMAGE_COST } from "@/lib/credits";
import { getEffectiveTier } from "@/lib/tier";
import { imageFormat, imageStyle, TEXT_LIMITS } from "../../../worker/image/presets.mjs";

// No `server-only` here: publishPost (run by the social worker under tsx) creates Auto AI Image jobs through it.
//
// One AI picture = one `generation_jobs` row with job_type 'image' on the generation queue (plan §4.5), so it shares
// the GPU job's credits, status, retry and refund path: the worker (worker/image/job.mjs) renders it on the ComfyUI box
// (D1, 192.168.166.183); a job that ends failed / cancelled / retried is refunded by the credit ledger automatically.

export const IMAGE_JOB_TYPE = "image";
export const IMAGE_WORKFLOW = "comfy-image";

export type ImageJobInput = {
  userId: string;
  workspaceId: string;
  /** What the picture should show (a brief, or a post's text). */
  brief: string;
  style?: string | null;
  format: string;
  /** Rewrite the brief into an image prompt with the AI Box first (default true). */
  enhance?: boolean;
  /** Waltz Image: the design + the image_design_images row the result fills. */
  design?: { designId: string; imageId: string };
  /** Auto AI Image on a social post: the result is attached to this post, which is then released to publish. */
  socialPostId?: string;
  /** Shown when the user lacks credits (e.g. "Upload a picture instead — that's free."). */
  creditHint?: string;
};

/**
 * Charge IMAGE_COST, insert the job (and the design's pending picture row in the same transaction) and enqueue it.
 * Throws the user-facing "not enough credits" message, or "couldn't reach the AI queue" (the job is then marked failed,
 * which refunds it).
 */
export async function createImageJob(input: ImageJobInput): Promise<string> {
  const brief = input.brief.trim().slice(0, TEXT_LIMITS.prompt);
  if (!brief) throw new Error("Describe the picture first.");
  const fmt = imageFormat(input.format);
  const style = imageStyle(input.style);
  const priority = (await getEffectiveTier(input.userId)) === "free" ? 0 : 10;
  const id = randomUUID();
  await spendCredits(
    input.userId,
    IMAGE_COST,
    async (tx) => {
      await tx.insert(schema.generationJobs).values({
        id,
        credits: IMAGE_COST,
        projectId: null,
        workspaceId: input.workspaceId,
        requestedBy: input.userId,
        jobType: IMAGE_JOB_TYPE,
        status: "queued",
        modelName: "flux-schnell",
        workflowName: IMAGE_WORKFLOW,
        prompt: brief,
        requestJson: {
          workflow: IMAGE_WORKFLOW,
          brief,
          style: style.key,
          format: fmt.key,
          width: fmt.width,
          height: fmt.height,
          enhance: input.enhance !== false,
          ...(input.design ? { designId: input.design.designId, imageId: input.design.imageId } : {}),
          ...(input.socialPostId ? { socialPostId: input.socialPostId } : {}),
        },
        priority,
      });
      if (input.design) {
        await tx.insert(schema.imageDesignImages).values({
          id: input.design.imageId,
          designId: input.design.designId,
          workspaceId: input.workspaceId,
          source: "ai",
          generationJobId: id,
          prompt: brief,
        });
      }
    },
    input.creditHint ?? "Upload a picture instead — that's free.",
  );
  try {
    await enqueueGeneration(id, { priority: priority >= 10 ? 1 : 5 });
  } catch (e) {
    console.error(`[image] enqueue ${id} failed:`, (e as Error).message);
    await db
      .update(schema.generationJobs)
      .set({ status: "failed", errorMessage: "Couldn't reach the AI queue", failedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.generationJobs.id, id))
      .catch(() => {});
    throw new Error("Couldn't reach the AI queue — try again in a moment. No credits were used.");
  }
  return id;
}
