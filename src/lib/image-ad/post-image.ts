import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { NotEnoughCredits } from "@/lib/credits-ledger";
import { createImageJob, IMAGE_JOB_TYPE } from "./jobs";

// Auto AI Image for social posts (P1's warning path, wired in P3). A post that asks for an AI picture and carries none
// gets ONE image job on the generation queue (2 credits from the post's author, refunded if it fails). The post waits
// in status 'rendering'; the worker attaches the picture and hands the post back to the scheduler (worker/image/job.mjs),
// whose next sweep publishes it. A post whose picture failed publishes without one and says so — never a second try,
// so a broken GPU can't loop a post through the queue (or through the author's credits).
//
// Free of `server-only` / next/*: publishPost runs inside the social worker too.

type PostRow = typeof schema.socialPosts.$inferSelect;

const ACTIVE = ["queued", "preparing", "generating", "uploading_output"];
const FAILED = ["failed", "cancelled", "retried"];

export type PostImageOutcome =
  | { state: "rendering" } // a picture is on its way; don't publish yet
  | { state: "skip"; warning: string }; // publish without a picture, with this note

export async function requestPostImage(post: PostRow): Promise<PostImageOutcome> {
  const [job] = await db
    .select({ id: schema.generationJobs.id, status: schema.generationJobs.status, error: schema.generationJobs.errorMessage })
    .from(schema.generationJobs)
    .where(and(eq(schema.generationJobs.jobType, IMAGE_JOB_TYPE), sql`${schema.generationJobs.requestJson}->>'socialPostId' = ${post.id}`))
    .orderBy(desc(schema.generationJobs.createdAt))
    .limit(1);

  if (job && ACTIVE.includes(job.status)) return { state: "rendering" };
  if (job && FAILED.includes(job.status)) {
    return { state: "skip", warning: `Auto AI Image failed (${(job.error ?? "the image server didn't answer").slice(0, 140)}) — the post was published without a picture. The credits were refunded.` };
  }
  if (job) return { state: "skip", warning: "Auto AI Image finished but its picture couldn't be read — the post was published without it." };

  if (!post.createdBy) return { state: "skip", warning: "Auto AI Image needs the post's author to pay the AI credits; this post has none, so it was published without a picture." };
  const brief = post.text.trim();
  if (!brief) return { state: "skip", warning: "Auto AI Image needs post text to describe the picture — the post was published without one." };

  // Claim first: only a post still waiting to publish moves to 'rendering', so two sweeps can't both start a job.
  const claimed = await db
    .update(schema.socialPosts)
    .set({ status: "rendering", updatedAt: new Date() })
    .where(and(eq(schema.socialPosts.id, post.id), inArray(schema.socialPosts.status, ["draft", "queued", "scheduled", "failed"])))
    .returning({ id: schema.socialPosts.id });
  if (!claimed.length) return { state: "rendering" };

  try {
    await createImageJob({
      userId: post.createdBy,
      workspaceId: post.workspaceId,
      brief,
      style: "photographic",
      format: "1:1",
      socialPostId: post.id,
      creditHint: "Turn off Auto AI Image or attach a picture.",
    });
    return { state: "rendering" };
  } catch (e) {
    // Put the post back where it was so the caller can publish it now.
    await db.update(schema.socialPosts).set({ status: post.status, updatedAt: new Date() }).where(eq(schema.socialPosts.id, post.id));
    const why = e instanceof NotEnoughCredits ? "not enough AI credits" : (e as Error).message.slice(0, 140);
    return { state: "skip", warning: `Auto AI Image couldn't start (${why}) — the post was published without a picture.` };
  }
}
