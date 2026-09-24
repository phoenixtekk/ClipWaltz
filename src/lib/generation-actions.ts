"use server";
import { randomUUID } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { enqueueGeneration, enqueueEnhance, generationQueue } from "./queue";
import { deleteObject } from "./storage";
import { userCanAccessProject } from "./workspace";
import { friendlyJobError } from "./ai/errors";
import { resolveGenerationRoute, resolveEnhanceWorkflow, getAiAvailability, RouteUnavailableError, QUALITIES, type Quality } from "./ai/routing";

const PROMPT_MAX = 2000;

// The wrapper accepts 0 … 2^53-1; anything else becomes null (the worker picks a random seed).
function validSeed(seed: unknown): number | null {
  return Number.isSafeInteger(seed) && (seed as number) >= 0 ? (seed as number) : null;
}

// Motion intensity (CW-MVP-053). Wan 2.2 has no motion-strength input, so the choice becomes a
// prompt phrase — the same approach the Generate tab uses for style and camera.
const MOTION_PHRASE: Record<string, string> = {
  subtle: "subtle, gentle, minimal movement",
  balanced: "",
  dynamic: "dynamic, energetic, fast movement",
};
function withMotion(prompt: string | undefined, motion: string): string | null {
  const parts = [prompt?.trim(), MOTION_PHRASE[motion]].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// Route via the DB rules; an unavailable route becomes a plain user-facing Error.
async function routeOrUserError(task: "text_to_video" | "image_to_video", quality: Quality) {
  try {
    return await resolveGenerationRoute(task, quality);
  } catch (e) {
    if (e instanceof RouteUnavailableError) throw new Error(e.message);
    throw e;
  }
}

/** What the Generate tab can offer right now (enabled workflows/models via the routing rules). */
export async function getGenerationAvailability() {
  await requireUserId();
  return getAiAvailability();
}

export type GenerationJobType = "text_to_video" | "image_to_video" | "montage" | "enhancement";

export type CreateGenerationInput = {
  projectId: string;
  /** Ignored — the routing engine picks the workflow from jobType + quality (ADR-0009). */
  workflow?: string;
  /** Quality profile → routing rule (workflow + sampler steps). Default "standard". */
  quality?: Quality;
  jobType: GenerationJobType;
  prompt?: string;
  negativePrompt?: string;
  /** Asset id whose stored image is the image-to-video source (optional). */
  sourceAssetId?: string;
  sceneId?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  motion?: string;
  seed?: number | null;
};

/**
 * Create an AI generation job for a project (owner-checked), persist it, and enqueue it to the
 * BullMQ generation queue. The generation worker (worker/generation-worker.mjs) claims it, submits
 * to the AISERVER wrapper, and writes the resulting generation_versions row. Returns the job id.
 */
export async function createGenerationJob(input: CreateGenerationInput): Promise<string> {
  const userId = await requireUserId();

  const [proj] = await db
    .select({ id: schema.projects.id, workspaceId: schema.projects.workspaceId })
    .from(schema.projects)
    .where(eq(schema.projects.id, input.projectId));
  if (!proj || !(await userCanAccessProject(userId, input.projectId, "editor"))) throw new Error("Project not found");

  if (input.jobType === "image_to_video" && !input.sourceAssetId) {
    throw new Error("Image-to-video needs a source image");
  }
  if (input.sourceAssetId) {
    // The source image must belong to THIS project (the worker loads it by id alone).
    const [a] = await db
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(and(eq(schema.assets.id, input.sourceAssetId), eq(schema.assets.projectId, input.projectId)));
    if (!a) throw new Error("Source image not found");
  }
  if (input.jobType === "text_to_video" && !input.prompt?.trim()) {
    throw new Error("Text-to-video needs a prompt");
  }
  if ((input.prompt?.length ?? 0) > PROMPT_MAX || (input.negativePrompt?.length ?? 0) > PROMPT_MAX) {
    throw new Error(`Prompts are limited to ${PROMPT_MAX} characters`);
  }
  if (input.jobType !== "text_to_video" && input.jobType !== "image_to_video") throw new Error("Unsupported job type");
  const quality: Quality = QUALITIES.includes(input.quality as Quality) ? (input.quality as Quality) : "standard";
  const motion = MOTION_PHRASE[input.motion ?? ""] !== undefined ? input.motion! : "balanced";
  const route = await routeOrUserError(input.jobType, quality);

  const id = randomUUID();
  await db.insert(schema.generationJobs).values({
    id,
    projectId: input.projectId,
    sceneId: input.sceneId ?? null,
    workspaceId: proj.workspaceId ?? null,
    requestedBy: userId,
    jobType: input.jobType,
    status: "queued",
    routingProfile: route.ruleId,
    modelName: route.modelName,
    workflowName: route.workflow,
    workflowVersion: route.workflowVersion,
    // Motion has no model input on Wan 2.2 — it is folded into the prompt, like style/camera.
    prompt: withMotion(input.prompt, motion),
    negativePrompt: input.negativePrompt?.trim() || null,
    // Everything the worker needs to build the provider request (kept off the hot columns).
    requestJson: {
      workflow: route.workflow,
      quality,
      steps: route.steps,
      sourceAssetId: input.sourceAssetId ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      durationSec: input.durationSec ?? null,
      motion,
      seed: validSeed(input.seed),
    },
  });

  await enqueueGeneration(id);
  revalidatePath(`/projects/${input.projectId}/edit`);
  return id;
}

export type GenerationVersionItem = {
  id: string;
  jobId: string;
  versionNumber: number;
  hasOutput: boolean;
  selected: boolean;
  favorite: boolean;
  createdAt: string;
};

/** List a project's generated versions, newest first (owner-checked) — for the version browser. */
export async function listGenerationVersions(projectId: string): Promise<GenerationVersionItem[]> {
  const userId = await requireUserId();
  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!proj || !(await userCanAccessProject(userId, projectId))) throw new Error("Project not found");
  const rows = await db
    .select({
      id: schema.generationVersions.id,
      jobId: schema.generationVersions.generationJobId,
      versionNumber: schema.generationVersions.versionNumber,
      outputKey: schema.generationVersions.outputKey,
      selected: schema.generationVersions.selected,
      favorite: schema.generationVersions.favorite,
      createdAt: schema.generationVersions.createdAt,
    })
    .from(schema.generationVersions)
    .where(eq(schema.generationVersions.projectId, projectId))
    .orderBy(desc(schema.generationVersions.createdAt));
  return rows.map((r) => ({
    id: r.id,
    jobId: r.jobId,
    versionNumber: r.versionNumber,
    hasOutput: !!r.outputKey,
    selected: r.selected,
    favorite: r.favorite,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Start a new generation job from an existing version's settings (owner-checked). `fresh=false`
 * duplicates it exactly (same seed → reproducible copy); `fresh=true` regenerates a variation with
 * a new random seed. Returns the new job id.
 */
export async function regenerateFromVersion(versionId: string, fresh: boolean): Promise<string> {
  const userId = await requireUserId();
  const [ver] = await db
    .select({
      jobId: schema.generationVersions.generationJobId,
      projectId: schema.generationVersions.projectId,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.generationVersions)
    .innerJoin(schema.projects, eq(schema.generationVersions.projectId, schema.projects.id))
    .where(eq(schema.generationVersions.id, versionId));
  if (!ver || !(await userCanAccessProject(userId, ver.projectId, "editor"))) throw new Error("Version not found");

  const [job] = await db
    .select()
    .from(schema.generationJobs)
    .where(eq(schema.generationJobs.id, ver.jobId));
  if (!job) throw new Error("Source job not found");

  const req = (job.requestJson ?? {}) as Record<string, unknown>;
  const id = await requeueGenerationCopy(job, userId, { ...req, seed: fresh ? null : (req.seed ?? null) });
  revalidatePath(`/projects/${job.projectId}/edit`);
  return id;
}

// Insert a new job copying `job`, re-resolving the route for generation jobs (a workflow disabled
// since the original run is replaced by the current rule), then enqueue it on the right queue.
async function requeueGenerationCopy(
  job: typeof schema.generationJobs.$inferSelect,
  userId: string,
  requestJson: Record<string, unknown>,
  retryCount = 0,
): Promise<string> {
  let routing = {
    routingProfile: job.routingProfile, modelName: job.modelName,
    workflowName: job.workflowName, workflowVersion: job.workflowVersion,
  };
  if (job.jobType === "text_to_video" || job.jobType === "image_to_video") {
    const q = requestJson.quality;
    const quality: Quality = QUALITIES.includes(q as Quality) ? (q as Quality) : "standard";
    const route = await routeOrUserError(job.jobType, quality);
    routing = { routingProfile: route.ruleId, modelName: route.modelName, workflowName: route.workflow, workflowVersion: route.workflowVersion };
    requestJson = { ...requestJson, workflow: route.workflow, quality, steps: route.steps };
  } else if (job.jobType === "enhancement") {
    // Re-check the registry and use the workflows enabled NOW (never the ones stored on the old
    // job — they may have been switched off, or predate the registry).
    const workflows = await assertEnhanceAvailable(
      String(requestJson.engine ?? "ffmpeg"), !!requestJson.interpolate, !!requestJson.upscale,
    );
    requestJson = { ...requestJson, workflows };
  }
  const id = randomUUID();
  await db.insert(schema.generationJobs).values({
    id,
    projectId: job.projectId,
    sceneId: job.sceneId ?? null,
    workspaceId: job.workspaceId ?? null,
    requestedBy: userId,
    jobType: job.jobType,
    status: "queued",
    ...routing,
    prompt: job.prompt ?? null,
    negativePrompt: job.negativePrompt ?? null,
    requestJson,
    retryCount,
  });
  if (job.jobType === "enhancement") await enqueueEnhance(id);
  else await enqueueGeneration(id);
  return id;
}

/**
 * Retry a failed or cancelled job (CW-MVP-181, editor-checked): a new job with the same prompt,
 * source and settings (same seed if one was recorded). Returns the new job id.
 */
export async function retryGenerationJob(jobId: string): Promise<string> {
  const userId = await requireUserId();
  const [job] = await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, jobId));
  if (!job || !(await userCanAccessProject(userId, job.projectId, "editor"))) throw new Error("Job not found");
  // Claim the failed job atomically so a double-click or repeated call retries it only once.
  const claimed = await db
    .update(schema.generationJobs)
    .set({ status: "retried", updatedAt: new Date() })
    .where(and(eq(schema.generationJobs.id, jobId), inArray(schema.generationJobs.status, ["failed", "cancelled"])))
    .returning({ id: schema.generationJobs.id });
  if (!claimed.length) throw new Error("This job was already retried or isn't finished");
  try {
    const id = await requeueGenerationCopy(job, userId, { ...((job.requestJson ?? {}) as Record<string, unknown>) }, job.retryCount + 1);
    revalidatePath(`/projects/${job.projectId}/edit`);
    return id;
  } catch (e) {
    // Couldn't start (e.g. workflow switched off) — release the claim so it can be retried later.
    await db.update(schema.generationJobs).set({ status: job.status }).where(eq(schema.generationJobs.id, jobId));
    throw e;
  }
}

// The AI enhancement workflows an engine needs must be enabled in the registry (CW-MVP-191).
async function assertEnhanceAvailable(engine: string, interpolate: boolean, upscale: boolean) {
  if (engine === "ffmpeg") return {};
  const need: { key: "upscale" | "interpolate" | "restore"; label: string }[] = [];
  if (engine === "restore") need.push({ key: "restore", label: "AI Restore" });
  else if (upscale || !interpolate) need.push({ key: "upscale", label: "AI upscale" });
  if (interpolate) need.push({ key: "interpolate", label: "AI smoother motion" });
  const out: Record<string, string> = {};
  for (const n of need) {
    const wf = await resolveEnhanceWorkflow(n.key);
    if (!wf) throw new Error(`${n.label} is temporarily unavailable. Try the Fast engine or check back soon.`);
    out[n.key] = wf;
  }
  return out;
}

/**
 * Enhance a version (editor-checked): queue an `enhancement` job that post-processes the source
 * clip (motion interpolation and/or 2× upscale) into a NEW version. Returns the new job id.
 */
export async function enhanceVersion(input: {
  versionId: string;
  interpolate: boolean;
  upscale: boolean;
  /**
   * "ffmpeg" = fast interpolate/upscale; "ai" = Real-ESRGAN 2× upscale on AISERVER;
   * "restore" = SeedVR2 diffusion restoration + 2× upscale on AISERVER (always upscales; ADR-0007).
   */
  engine?: "ffmpeg" | "ai" | "restore";
}): Promise<string> {
  const userId = await requireUserId();
  const engine = input.engine ?? "ffmpeg";
  if (!["ffmpeg", "ai", "restore"].includes(engine)) throw new Error("Unknown enhancement engine");
  const upscale = engine === "restore" ? true : input.upscale;
  if (!input.interpolate && !upscale) {
    throw new Error("Pick at least one enhancement");
  }
  const [ver] = await db
    .select({
      id: schema.generationVersions.id,
      projectId: schema.generationVersions.projectId,
      sceneId: schema.generationVersions.sceneId,
      outputKey: schema.generationVersions.outputKey,
      workspaceId: schema.projects.workspaceId,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.generationVersions)
    .innerJoin(schema.projects, eq(schema.generationVersions.projectId, schema.projects.id))
    .where(eq(schema.generationVersions.id, input.versionId));
  if (!ver || !(await userCanAccessProject(userId, ver.projectId, "editor"))) throw new Error("Version not found");
  if (!ver.outputKey) throw new Error("This version has no output to enhance yet");
  const workflows = await assertEnhanceAvailable(engine, input.interpolate, upscale);

  const id = randomUUID();
  await db.insert(schema.generationJobs).values({
    id,
    projectId: ver.projectId,
    sceneId: ver.sceneId ?? null,
    workspaceId: ver.workspaceId ?? null,
    requestedBy: userId,
    jobType: "enhancement",
    status: "queued",
    requestJson: {
      sourceVersionId: ver.id,
      sourceKey: ver.outputKey,
      engine,
      interpolate: input.interpolate,
      upscale,
      workflows, // resolved wrapper workflow ids for the AI steps (worker falls back to defaults)
    },
  });
  await enqueueEnhance(id);
  revalidatePath(`/projects/${ver.projectId}/edit`);
  return id;
}

// Owner-check a version and return its project id (shared guard for favorite/select).
async function ownedVersion(versionId: string, userId: string) {
  const [row] = await db
    .select({
      id: schema.generationVersions.id,
      projectId: schema.generationVersions.projectId,
      favorite: schema.generationVersions.favorite,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.generationVersions)
    .innerJoin(schema.projects, eq(schema.generationVersions.projectId, schema.projects.id))
    .where(eq(schema.generationVersions.id, versionId));
  if (!row || !(await userCanAccessProject(userId, row.projectId, "editor"))) throw new Error("Version not found");
  return row;
}

/** Toggle a version's favorite flag (owner-checked). */
export async function toggleVersionFavorite(versionId: string): Promise<void> {
  const userId = await requireUserId();
  const row = await ownedVersion(versionId, userId);
  await db
    .update(schema.generationVersions)
    .set({ favorite: !row.favorite })
    .where(eq(schema.generationVersions.id, versionId));
  revalidatePath(`/projects/${row.projectId}/edit`);
}

/**
 * Mark a version as the project's selected/preferred pick (owner-checked). One pick per project:
 * setting this clears `selected` on the project's other versions.
 */
export async function setVersionSelected(versionId: string): Promise<void> {
  const userId = await requireUserId();
  const row = await ownedVersion(versionId, userId);
  await db
    .update(schema.generationVersions)
    .set({ selected: false })
    .where(eq(schema.generationVersions.projectId, row.projectId));
  await db
    .update(schema.generationVersions)
    .set({ selected: true })
    .where(eq(schema.generationVersions.id, versionId));
  revalidatePath(`/projects/${row.projectId}/edit`);
}

/** Delete a generated version (owner-checked): its DB row + the MinIO output object. */
export async function deleteGenerationVersion(versionId: string): Promise<void> {
  const userId = await requireUserId();
  const [row] = await db
    .select({
      id: schema.generationVersions.id,
      key: schema.generationVersions.outputKey,
      projectId: schema.generationVersions.projectId,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.generationVersions)
    .innerJoin(schema.projects, eq(schema.generationVersions.projectId, schema.projects.id))
    .where(eq(schema.generationVersions.id, versionId));
  if (!row || !(await userCanAccessProject(userId, row.projectId, "editor"))) throw new Error("Version not found");
  await db.delete(schema.generationVersions).where(eq(schema.generationVersions.id, versionId));
  if (row.key) await deleteObject(row.key).catch(() => {});
  revalidatePath(`/projects/${row.projectId}/edit`);
}

/** Fetch a generation job (owner-checked) — for status polling in the editor. */
export async function getGenerationJob(jobId: string) {
  const userId = await requireUserId();
  const [row] = await db
    .select({
      id: schema.generationJobs.id,
      projectId: schema.generationJobs.projectId,
      status: schema.generationJobs.status,
      progress: schema.generationJobs.progress,
      jobType: schema.generationJobs.jobType,
      errorMessage: schema.generationJobs.errorMessage,
    })
    .from(schema.generationJobs)
    .where(eq(schema.generationJobs.id, jobId));
  if (!row || !(await userCanAccessProject(userId, row.projectId))) throw new Error("Job not found");
  return { ...row, errorMessage: friendlyJobError(row.errorMessage), errorDetail: row.errorMessage };
}

/**
 * Cancel a generation job (owner-checked). Removes it from the queue if still pending and marks it
 * cancelled; the worker also checks for cancellation and interrupts the provider job if it is
 * already running.
 */
export async function cancelGenerationJob(jobId: string): Promise<void> {
  const userId = await requireUserId();
  const [row] = await db
    .select({
      id: schema.generationJobs.id,
      projectId: schema.generationJobs.projectId,
      status: schema.generationJobs.status,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.generationJobs)
    .innerJoin(schema.projects, eq(schema.generationJobs.projectId, schema.projects.id))
    .where(eq(schema.generationJobs.id, jobId));
  if (!row || !(await userCanAccessProject(userId, row.projectId, "editor"))) throw new Error("Job not found");

  await db
    .update(schema.generationJobs)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(schema.generationJobs.id, jobId));
  // Remove it from BullMQ if it hasn't been claimed yet (best-effort).
  await generationQueue()
    .remove(jobId)
    .catch(() => {});
  revalidatePath(`/projects/${row.projectId}/edit`);
}
