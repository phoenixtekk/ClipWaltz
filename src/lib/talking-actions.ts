"use server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { userCanAccessProject } from "./workspace";
import { enqueueGeneration } from "./queue";
import { getEffectiveTier } from "./tier";
import { spendCredits } from "./credits-server";
import { shouldWatermark } from "./watermark";
import { toResult, type ActionResult } from "./action-result";
import { headObject } from "./storage";
import { resolveEnhanceWorkflow } from "./ai/routing";
import { VOICES } from "./deck/types";
import {
  TALKING_ASPECTS, TALKING_CONSENT_TEXT, TALKING_WORKFLOW, TALKING_MAX_SECONDS, TALKING_SCRIPT_MAX,
  estimateScriptSeconds, talkingCost, talkingQualityOf, type TalkingAspect, type TalkingQuality,
} from "./talking-photo";

// Waltz AI → Talking photo (Phase C2). A `talking_photo` job on the GPU queue: the worker stages the photo (and the
// recording) on AISERVER, the clipwaltz-talking service renders it (worker/generation-worker.mjs → runTalking), and it
// lands as a new version labelled AI-generated. Consent is automatic (owner decision 2026-10-13): the user confirms
// "this is me / I have their permission" and that confirmation is stored with the job.

export type TalkingPhotoInput = {
  projectId: string;
  sourceAssetId: string;
  /** A typed script (spoken by `voice`) — or `audioKey` from POST /api/projects/:id/talking-audio. */
  script?: string;
  voice?: string;
  speed?: number;
  audioKey?: string;
  aspect?: TalkingAspect;
  /** standard = Real-ESRGAN 2× (1 credit/s); high = SeedVR2 restore (2 credits/s). */
  quality?: TalkingQuality;
  consent: boolean;
};

/** Is talking photo switched on (workflow + model enabled in the AI registry)? */
async function talkingEnabled(): Promise<boolean> {
  const [r] = await db.select({ wf: schema.workflowRegistry.enabled, model: schema.modelRegistry.enabled })
    .from(schema.workflowRegistry)
    .innerJoin(schema.modelRegistry, eq(schema.workflowRegistry.modelName, schema.modelRegistry.name))
    .where(eq(schema.workflowRegistry.id, TALKING_WORKFLOW));
  return !!r?.wf && !!r?.model;
}

async function createTalkingPhotoImpl(input: TalkingPhotoInput): Promise<string> {
  const userId = await requireUserId();
  const [proj] = await db.select({ id: schema.projects.id, workspaceId: schema.projects.workspaceId })
    .from(schema.projects).where(eq(schema.projects.id, input.projectId));
  if (!proj || !(await userCanAccessProject(userId, input.projectId, "editor"))) throw new Error("Project not found");
  if (!(await talkingEnabled())) throw new Error("Talking photo is switched off right now");
  if (input.consent !== true) throw new Error("Please confirm this is you, or that you have this person's permission");

  const [photo] = await db.select({ id: schema.assets.id, kind: schema.assets.kind }).from(schema.assets)
    .where(and(eq(schema.assets.id, input.sourceAssetId), eq(schema.assets.projectId, input.projectId)));
  if (!photo || photo.kind !== "photo") throw new Error("Pick a photo from this project");

  const quality = talkingQualityOf(input.quality);
  if (quality === "high" && !(await resolveEnhanceWorkflow("restore"))) throw new Error("High quality is switched off right now — try Standard");
  const aspect: TalkingAspect = TALKING_ASPECTS.some((a) => a.key === input.aspect) ? input.aspect! : "photo";
  let seconds: number;
  let speech: Record<string, unknown>;
  if (input.audioKey) {
    // Only POST /api/projects/:id/talking-audio writes under this prefix, with the measured length in the name.
    const m = new RegExp(`^talking/${input.projectId}/[0-9a-f-]{36}-(\\d{1,6})ms\\.m4a$`).exec(input.audioKey);
    if (!m) throw new Error("That recording isn't from this project — upload it again");
    await headObject(input.audioKey).catch(() => { throw new Error("That recording is gone — upload it again"); });
    seconds = Math.min(TALKING_MAX_SECONDS, Number(m[1]) / 1000);
    speech = { audioKey: input.audioKey };
  } else {
    const script = (input.script ?? "").trim();
    if (!script) throw new Error("Type what the photo should say, or upload a recording");
    if (script.length > TALKING_SCRIPT_MAX) throw new Error(`Scripts are limited to ${TALKING_SCRIPT_MAX} characters (about 30 seconds)`);
    const voice = VOICES.some((v) => v.id === input.voice) ? input.voice! : "af_heart";
    const speed = Math.min(1.4, Math.max(0.7, Number(input.speed) || 1));
    seconds = estimateScriptSeconds(script, speed);
    speech = { script, voice, speed };
  }

  const credits = talkingCost(seconds, quality);
  const priority = (await getEffectiveTier(userId)) === "free" ? 0 : 10;
  const watermark = await shouldWatermark(userId);
  const id = randomUUID();
  await spendCredits(userId, credits, (tx) => tx.insert(schema.generationJobs).values({
    id,
    credits,
    projectId: input.projectId,
    workspaceId: proj.workspaceId ?? null,
    requestedBy: userId,
    jobType: "talking_photo",
    status: "queued",
    routingProfile: null,
    modelName: "echomimic-v3",
    workflowName: TALKING_WORKFLOW,
    workflowVersion: "v1",
    prompt: null,
    requestJson: {
      workflow: TALKING_WORKFLOW,
      sourceAssetId: photo.id,
      ...speech,
      aspect,
      quality,
      durationSec: Math.round(seconds * 10) / 10,
      seed: null,
      watermark,
      aiLabel: true, // EU AI Act Art. 50: talking-photo outputs carry a visible "AI-generated" label
      consent: { confirmed: true, text: TALKING_CONSENT_TEXT, at: new Date().toISOString(), userId },
    },
    priority,
  }));
  try {
    await enqueueGeneration(id, { priority: priority >= 10 ? 1 : 5 });
  } catch (e) {
    console.error(`[talking] enqueue ${id} failed:`, (e as Error).message);
    await db.update(schema.generationJobs).set({ status: "failed", errorMessage: "Couldn't reach the AI queue", failedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.generationJobs.id, id)).catch(() => {});
    throw new Error("Couldn't reach the AI queue — try again in a moment. No credits were used.");
  }
  revalidatePath(`/projects/${input.projectId}/edit`);
  return id;
}

export async function createTalkingPhoto(input: TalkingPhotoInput): Promise<ActionResult<string>> {
  return toResult(() => createTalkingPhotoImpl(input));
}

export async function getTalkingAvailable(): Promise<ActionResult<{ enabled: boolean; high: boolean }>> {
  return toResult(async () => {
    await requireUserId();
    const [enabled, restore] = await Promise.all([talkingEnabled(), resolveEnhanceWorkflow("restore")]);
    return { enabled, high: enabled && !!restore };
  });
}
