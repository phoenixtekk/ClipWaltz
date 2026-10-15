"use server";
import { randomUUID } from "crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { toResult, type ActionResult } from "./action-result";
import { userCanAccessProject } from "./workspace";
import { enqueueGeneration } from "./queue";
import { spendCredits } from "./credits-server";
import { getEffectiveTier } from "./tier";
import { shouldWatermark } from "./watermark";
import { LANGUAGES } from "./deck/types";
import { TRANSLATE_MAX_SECONDS, presenterCredits } from "./presenters";

// Waltz Avatar Phase 3 — translate a video of yourself. Step 1 (`translate_prep`, free): the video's speech is transcribed
// (whisper-small on AISERVER) and translated (the deck LLM) for the user to review. Step 2 (`translate_video`): the
// reviewed text is spoken in the user's own cloned voice, fitted to the video's length, and the video's own frames are
// lip-synced to it (MuseTalk) — after checking the video is the same person as their consented presenter. Output: a new
// version under Generated versions, labelled AI-generated. worker/generation-worker.mjs runTranslatePrep / runTranslateVideo.

export type TranslationPrep = {
  status: string;
  error: string | null;
  source?: string;
  sourceLang?: string | null;
  translation?: string;
  seconds?: number;
  lang: string;
  presenterId: string;
  sourceAssetId: string;
};

// The free step still runs Whisper + the LLM on AISERVER: at most PREP_ACTIVE at once and PREP_PER_DAY a day per user.
const PREP_ACTIVE = 2;
const PREP_PER_DAY = 20;

async function ownVoicePresenter(userId: string, id: string) {
  const [p] = await db.select().from(schema.presenters)
    .where(and(eq(schema.presenters.id, id), eq(schema.presenters.userId, userId), eq(schema.presenters.kind, "twin")));
  if (!p || p.status !== "ready") throw new Error("Pick one of your ready presenters");
  if (p.voiceStatus !== "ready") throw new Error("Set up your own voice first (Avatars → Use my own voice)");
  return p;
}

/** Step 1: transcribe + translate a video in this project (free). → the prep job id; poll getTranslationPrep. */
export async function prepareTranslation(input: { projectId: string; assetId: string; presenterId: string; lang: string }): Promise<ActionResult<string>> {
  return toResult(async () => {
    const userId = await requireUserId();
    if (!(await userCanAccessProject(userId, input.projectId, "editor"))) throw new Error("Project not found");
    if (!LANGUAGES.some((l) => l.code === input.lang)) throw new Error("Pick a language");
    await ownVoicePresenter(userId, input.presenterId);
    const [a] = await db.select({ id: schema.assets.id, kind: schema.assets.kind, durationSec: schema.assets.durationSec, workspaceId: schema.projects.workspaceId })
      .from(schema.assets).innerJoin(schema.projects, eq(schema.projects.id, schema.assets.projectId))
      .where(and(eq(schema.assets.id, input.assetId), eq(schema.assets.projectId, input.projectId)));
    if (!a || a.kind !== "video") throw new Error("Pick a video from this project");
    if (!a.durationSec) throw new Error("We couldn't read this video's length — upload it again");
    if (a.durationSec > TRANSLATE_MAX_SECONDS + 1) throw new Error(`Videos up to ${TRANSLATE_MAX_SECONDS / 60} minutes can be translated — trim it first`);
    const mine = and(eq(schema.generationJobs.requestedBy, userId), eq(schema.generationJobs.jobType, "translate_prep"));
    const [{ active }] = await db.select({ active: sql<number>`count(*)::int` }).from(schema.generationJobs)
      .where(and(mine, inArray(schema.generationJobs.status, ["queued", "running"])));
    if (active >= PREP_ACTIVE) throw new Error("Wait for your other translations to finish transcribing");
    const [{ today }] = await db.select({ today: sql<number>`count(*)::int` }).from(schema.generationJobs)
      .where(and(mine, gt(schema.generationJobs.createdAt, new Date(Date.now() - 24 * 3600_000))));
    if (today >= PREP_PER_DAY) throw new Error(`You can transcribe ${PREP_PER_DAY} videos a day — try again tomorrow`);
    const id = randomUUID();
    await db.insert(schema.generationJobs).values({
      id, projectId: input.projectId, workspaceId: a.workspaceId ?? null, requestedBy: userId, jobType: "translate_prep", status: "queued",
      credits: 0, modelName: "whisper-small", workflowName: "voice-transcribe-v1",
      requestJson: { sourceAssetId: a.id, presenterId: input.presenterId, lang: input.lang },
    });
    try {
      await enqueueGeneration(id, { priority: 1 });
    } catch {
      await db.update(schema.generationJobs).set({ status: "failed", errorMessage: "Couldn't reach the AI queue", failedAt: new Date() }).where(eq(schema.generationJobs.id, id));
      throw new Error("Couldn't reach the AI queue — try again in a moment");
    }
    return id;
  });
}

export async function getTranslationPrep(jobId: string): Promise<ActionResult<TranslationPrep>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const [j] = await db.select().from(schema.generationJobs)
      .where(and(eq(schema.generationJobs.id, jobId), eq(schema.generationJobs.requestedBy, userId), eq(schema.generationJobs.jobType, "translate_prep")));
    if (!j) throw new Error("Not found");
    const r = (j.requestJson ?? {}) as Record<string, unknown> & { prep?: { source: string; sourceLang: string | null; translation: string; seconds: number } };
    return {
      status: j.status, error: j.errorMessage, lang: String(r.lang), presenterId: String(r.presenterId), sourceAssetId: String(r.sourceAssetId),
      ...(r.prep ?? {}),
    };
  });
}

/** Step 2: the (edited) translation → the translated video. Credits: speech + lip-sync, 2 × the presenter rate. */
export async function createTranslatedVideo(input: { prepJobId: string; text: string }): Promise<ActionResult<string>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const [prep] = await db.select().from(schema.generationJobs)
      .where(and(eq(schema.generationJobs.id, input.prepJobId), eq(schema.generationJobs.requestedBy, userId), eq(schema.generationJobs.jobType, "translate_prep")));
    if (!prep || prep.status !== "completed") throw new Error("Transcribe the video first");
    const r = (prep.requestJson ?? {}) as { sourceAssetId: string; presenterId: string; lang: string; prep?: { seconds: number } };
    if (!prep.projectId || !(await userCanAccessProject(userId, prep.projectId, "editor"))) throw new Error("Project not found");
    await ownVoicePresenter(userId, r.presenterId);
    const text = String(input.text ?? "").trim().slice(0, 6000);
    if (!text) throw new Error("The translation is empty");
    const seconds = Math.min(TRANSLATE_MAX_SECONDS, r.prep?.seconds ?? TRANSLATE_MAX_SECONDS);
    const credits = presenterCredits(seconds * 2);
    const priority = (await getEffectiveTier(userId)) === "free" ? 0 : 10;
    const watermark = await shouldWatermark(userId);
    const id = randomUUID();
    await spendCredits(userId, credits, (tx) => tx.insert(schema.generationJobs).values({
      id, projectId: prep.projectId, workspaceId: prep.workspaceId ?? null, requestedBy: userId, jobType: "translate_video", status: "queued",
      credits, priority, modelName: "musetalk-1.5", workflowName: "presenter-dub-v1",
      requestJson: {
        sourceAssetId: r.sourceAssetId, presenterId: r.presenterId, lang: r.lang, text, durationSec: seconds, watermark, aiLabel: true,
        prepJobId: prep.id,
      },
    }));
    try {
      await enqueueGeneration(id, { priority: priority >= 10 ? 1 : 5 });
    } catch {
      await db.update(schema.generationJobs).set({ status: "failed", errorMessage: "Couldn't reach the AI queue", failedAt: new Date() }).where(eq(schema.generationJobs.id, id));
      throw new Error("Couldn't reach the AI queue — try again in a moment. No credits were used.");
    }
    revalidatePath(`/projects/${prep.projectId}/edit`);
    return id;
  });
}
