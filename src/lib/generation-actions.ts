"use server";
import { randomUUID } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { enqueueGeneration, enqueueEnhance, generationQueue, enhanceQueue } from "./queue";
import { deleteObject } from "./storage";
import { userCanAccessProject } from "./workspace";
import { friendlyJobError } from "./ai/errors";
import { queuePositionOf } from "./ai/queue-position";
import { resolveGenerationRoute, resolveEnhanceWorkflow, getAiAvailability, RouteUnavailableError, QUALITIES, type Quality } from "./ai/routing";
import { normalizeSettings, type GenerationSettings } from "./generation-settings";
import { getEffectiveTier } from "./tier";
import { spendCredits } from "./credits-server";
import { toResult, type ActionResult } from "./action-result";
import { BACKDROP_COST, enhanceCost, generationCost, remixCost } from "./credits";
import { shouldWatermark } from "./watermark";

const PROMPT_MAX = 2000;

// CW-MVP-093: paid accounts go ahead of free ones in the GPU queue. Stored on the job (higher =
// sooner) and mapped to BullMQ's priority (lower number = sooner; 0 would bypass prioritisation).
async function priorityFor(userId: string): Promise<number> {
  return (await getEffectiveTier(userId)) === "free" ? 0 : 10;
}
function bullPriority(priority: number): number {
  return priority >= 10 ? 1 : 5;
}

// CW-MVP-172: one auto-saved "recent settings" row per user.
async function rememberRecentSettings(userId: string, raw: GenerationSettings): Promise<void> {
  const settings = normalizeSettings(raw);
  const updated = await db.update(schema.generationPresets).set({ settings, updatedAt: new Date() })
    .where(and(eq(schema.generationPresets.userId, userId), eq(schema.generationPresets.isRecent, true)))
    .returning({ id: schema.generationPresets.id });
  if (!updated.length) await db.insert(schema.generationPresets).values({ id: randomUUID(), userId, isRecent: true, settings });
}

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
async function getGenerationAvailabilityImpl() {
  await requireUserId();
  return getAiAvailability();
}

export type GenerationJobType = "text_to_video" | "image_to_video" | "montage" | "enhancement";

export type CreateGenerationInput = {
  projectId: string;
  /**
   * WaltzDeck AI fill (phase 5): when set, the finished clip becomes a project video and replaces that storyboard
   * scene's media (worker/generation-worker.mjs). The scene must belong to projectId (checked below).
   */
  deckFill?: { sceneId: string };
  /**
   * WaltzDeck AI backdrop: a single still (one frame of the text-to-video model) stored in the deck's backdrop library
   * and applied to that scene, or to the deck default when sceneId is null. Costs BACKDROP_COST, never watermarked.
   */
  deckBackdrop?: { sceneId: string | null; preset: string; intensity?: string };
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
  /** Style / camera chip keys and the raw prompt, kept so a version can be re-opened (CW-MVP-121). */
  style?: string | null;
  camera?: string | null;
  userPrompt?: string;
  /** Form settings to remember as this user's "recent settings" (CW-MVP-172). */
  settings?: GenerationSettings;
};

/**
 * Create an AI generation job for a project (owner-checked), persist it, and enqueue it to the
 * BullMQ generation queue. The generation worker (worker/generation-worker.mjs) claims it, submits
 * to the AISERVER wrapper, and writes the resulting generation_versions row. Returns the job id.
 */
async function createGenerationJobImpl(input: CreateGenerationInput): Promise<string> {
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
  if (input.deckFill) {
    const [sc] = await db.select({ id: schema.deckScenes.id }).from(schema.deckScenes)
      .where(and(eq(schema.deckScenes.id, input.deckFill.sceneId), eq(schema.deckScenes.projectId, input.projectId)));
    if (!sc) throw new Error("Scene not found");
    input = { ...input, deckFill: { sceneId: sc.id } };
  }
  if (input.deckBackdrop?.sceneId) {
    const [sc] = await db.select({ id: schema.deckScenes.id }).from(schema.deckScenes)
      .where(and(eq(schema.deckScenes.id, input.deckBackdrop.sceneId), eq(schema.deckScenes.projectId, input.projectId)));
    if (!sc) throw new Error("Scene not found");
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
  // CW-MVP-051: only lengths the routed workflow is validated for.
  if (input.durationSec != null && !input.deckBackdrop) {
    if ((route.durationMax != null && input.durationSec > route.durationMax) || (route.durationMin != null && input.durationSec < route.durationMin)) {
      throw new Error(`This model makes clips of ${route.durationMin ?? 1}–${route.durationMax ?? "any"} seconds. Pick a length in that range.`);
    }
  }
  const priority = await priorityFor(userId);
  // AI credits: seconds × quality (a clip with no length set gets the model's longest).
  const credits = input.deckBackdrop ? BACKDROP_COST : generationCost(input.durationSec ?? route.durationMax ?? 5, quality);
  const watermark = input.deckBackdrop ? false : await shouldWatermark(userId);

  const id = randomUUID();
  await spendCredits(userId, credits, (tx) => tx.insert(schema.generationJobs).values({
    id,
    credits,
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
      style: input.style ?? null,
      camera: input.camera ?? null,
      userPrompt: input.userPrompt?.slice(0, PROMPT_MAX) ?? null,
      watermark,
      ...(input.deckFill ? { deckFill: input.deckFill } : {}),
      ...(input.deckBackdrop ? { deckBackdrop: { sceneId: input.deckBackdrop.sceneId, preset: input.deckBackdrop.preset.slice(0, 40), intensity: input.deckBackdrop.intensity ?? "balanced" } } : {}),
    },
    priority,
  }));

  await enqueueOrRefund(id, () => enqueueGeneration(id, { priority: bullPriority(priority) }));
  if (input.settings) await rememberRecentSettings(userId, input.settings).catch(() => {});
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
  /** CW-MVP-112 output metadata — user-facing, no raw model parameters. */
  durationSec: number | null;
  width: number | null;
  height: number | null;
  mode: string; // "Image → video" | "Text → video" | "Enhanced — …"
  style: string | null;
  quality: string | null;
};

const STYLE_LABEL: Record<string, string> = {
  cinematic: "Cinematic", commercial: "Commercial", documentary: "Documentary",
  social: "Social", action: "Action", dreamlike: "Dreamlike",
};
const PRESET_LABEL: Record<string, string> = { clean: "Clean", smooth: "Smooth", sharp: "Sharp", max: "Max Quality" };
const ENGINE_LABEL: Record<string, string> = { ffmpeg: "Fast", ai: "AI upscale", restore: "AI Restore" };

/** List a project's generated versions, newest first (owner-checked) — for the version browser. */
async function listGenerationVersionsImpl(projectId: string): Promise<GenerationVersionItem[]> {
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
      durationSec: schema.generationVersions.durationSec,
      settings: schema.generationVersions.settings,
      jobType: schema.generationJobs.jobType,
      request: schema.generationJobs.requestJson,
    })
    .from(schema.generationVersions)
    .leftJoin(schema.generationJobs, eq(schema.generationVersions.generationJobId, schema.generationJobs.id))
    .where(eq(schema.generationVersions.projectId, projectId))
    .orderBy(desc(schema.generationVersions.createdAt));
  return rows.map((r) => {
    const st = (r.settings ?? {}) as Record<string, unknown>;
    const rq = (r.request ?? {}) as Record<string, unknown>;
    const mode = r.jobType === "text_to_video" ? "Text → video"
      : r.jobType === "image_to_video" ? "Image → video"
      : r.jobType === "montage" ? "Storyboard"
      : r.jobType === "remix" ? `Remix — ${String(((r.request ?? {}) as Record<string, unknown>).summary ?? "AI")}`
      : `Enhanced — ${PRESET_LABEL[String(rq.preset)] ?? ENGINE_LABEL[String(rq.engine)] ?? "Fast"}`;
    return {
      id: r.id,
      jobId: r.jobId,
      versionNumber: r.versionNumber,
      hasOutput: !!r.outputKey,
      selected: r.selected,
      favorite: r.favorite,
      createdAt: r.createdAt.toISOString(),
      durationSec: r.durationSec,
      width: typeof st.width === "number" ? st.width : null,
      height: typeof st.height === "number" ? st.height : null,
      mode,
      style: STYLE_LABEL[String(rq.style)] ?? null,
      quality: typeof rq.quality === "string" ? rq.quality[0].toUpperCase() + rq.quality.slice(1) : null,
    };
  });
}

/**
 * Start a new generation job from an existing version's settings (owner-checked). `fresh=false`
 * duplicates it exactly (same seed → reproducible copy); `fresh=true` regenerates a variation with
 * a new random seed. Returns the new job id.
 */
async function regenerateFromVersionImpl(versionId: string, fresh: boolean): Promise<string> {
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

  // A regenerate / duplicate is a new Waltz AI version — it must never re-fill a WaltzDeck scene (only a retry of a
  // failed fill does), so the deckFill target is dropped.
  const { deckFill: _fill, ...req } = (job.requestJson ?? {}) as Record<string, unknown>;
  void _fill;
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
  requestJson = { ...requestJson, watermark: await shouldWatermark(userId) };
  // The copy is priced from its own settings — never copied from the original (jobs made before credits existed are
  // stored with 0, which would make every regenerate / retry of them free).
  const credits = await costOfJob(job.jobType, requestJson);
  const id = randomUUID();
  await spendCredits(userId, credits, (tx) => tx.insert(schema.generationJobs).values({
    id,
    credits,
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
    priority: job.priority,
  }));
  if (job.jobType === "enhancement" || job.jobType === "montage" || job.jobType === "remix") await enqueueOrRefund(id, () => enqueueEnhance(id, { priority: bullPriority(job.priority) }));
  else await enqueueOrRefund(id, () => enqueueGeneration(id, { priority: bullPriority(job.priority) }));
  return id;
}

/** AI credits for a job from its stored settings (the same rules as when it was first created). */
async function costOfJob(jobType: string, req: Record<string, unknown>): Promise<number> {
  const quality = typeof req.quality === "string" ? req.quality : "standard";
  if (req.deckBackdrop) return BACKDROP_COST;
  if (jobType === "text_to_video" || jobType === "image_to_video") {
    let seconds = Number(req.durationSec) || 0;
    if (!seconds) seconds = (await routeOrUserError(jobType, (QUALITIES.includes(quality as Quality) ? quality : "standard") as Quality)).durationMax ?? 5;
    return generationCost(seconds, quality);
  }
  if (jobType === "remix") {
    const secs = (x: unknown) => Number((x as { seconds?: number } | null)?.seconds) || 0;
    const moments = Array.isArray(req.moments) ? (req.moments as unknown[]) : [];
    const ai = secs(req.leadIn) + secs(req.extend) + moments.reduce<number>((n, m) => n + secs(m), 0);
    return ai ? remixCost(ai, quality) : 0;
  }
  if (jobType === "enhancement") {
    const engine = String(req.engine ?? "ffmpeg");
    if (engine === "ffmpeg") return 0;
    const [v] = typeof req.sourceVersionId === "string"
      ? await db.select({ d: schema.generationVersions.durationSec }).from(schema.generationVersions).where(eq(schema.generationVersions.id, req.sourceVersionId))
      : [];
    return enhanceCost(engine, v?.d ?? 5);
  }
  return 0; // montage: no AI model runs
}

/**
 * Queue a just-charged job; if the queue can't be reached, fail the job (which refunds its credits — failed jobs don't
 * count) and tell the user nothing was spent.
 */
async function enqueueOrRefund(id: string, enqueue: () => Promise<unknown>): Promise<void> {
  try {
    await enqueue();
  } catch (e) {
    console.error(`[generation] enqueue ${id} failed:`, (e as Error).message);
    await db.update(schema.generationJobs).set({ status: "failed", errorMessage: "Couldn't reach the AI queue", failedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.generationJobs.id, id)).catch(() => {});
    throw new Error("Couldn't reach the AI queue — try again in a moment. No credits were used.");
  }
}

/**
 * Retry a failed or cancelled job (CW-MVP-181, editor-checked): a new job with the same prompt,
 * source and settings (same seed if one was recorded). Returns the new job id.
 */
async function retryGenerationJobImpl(jobId: string): Promise<string> {
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
async function enhanceVersionImpl(input: {
  versionId: string;
  interpolate: boolean;
  upscale: boolean;
  /**
   * "ffmpeg" = fast interpolate/upscale; "ai" = Real-ESRGAN 2× upscale on AISERVER;
   * "restore" = SeedVR2 diffusion restoration + 2× upscale on AISERVER (always upscales; ADR-0007).
   */
  engine?: "ffmpeg" | "ai" | "restore";
  /** Fast engine only: light denoise + sharpen (the "Clean" preset, CW-MVP-132). */
  denoise?: boolean;
  /** Preset name for display: clean | smooth | sharp | max. */
  preset?: string | null;
}): Promise<string> {
  const userId = await requireUserId();
  const engine = input.engine ?? "ffmpeg";
  if (!["ffmpeg", "ai", "restore"].includes(engine)) throw new Error("Unknown enhancement engine");
  if (input.preset != null && !["clean", "smooth", "sharp", "max"].includes(input.preset)) throw new Error("Unknown preset");
  if (input.denoise && engine !== "ffmpeg") throw new Error("Denoise is part of the Fast engine");
  const upscale = engine === "restore" ? true : input.upscale;
  if (!input.interpolate && !upscale && !input.denoise) {
    throw new Error("Pick at least one enhancement");
  }
  const [ver] = await db
    .select({
      id: schema.generationVersions.id,
      projectId: schema.generationVersions.projectId,
      sceneId: schema.generationVersions.sceneId,
      outputKey: schema.generationVersions.outputKey,
      cleanKey: schema.generationVersions.cleanKey,
      workspaceId: schema.projects.workspaceId,
      ownerId: schema.projects.ownerId,
      durationSec: schema.generationVersions.durationSec,
    })
    .from(schema.generationVersions)
    .innerJoin(schema.projects, eq(schema.generationVersions.projectId, schema.projects.id))
    .where(eq(schema.generationVersions.id, input.versionId));
  if (!ver || !(await userCanAccessProject(userId, ver.projectId, "editor"))) throw new Error("Version not found");
  if (!ver.outputKey) throw new Error("This version has no output to enhance yet");
  const workflows = await assertEnhanceAvailable(engine, input.interpolate, upscale);
  const priority = await priorityFor(userId);
  const credits = enhanceCost(engine, ver.durationSec ?? 5);
  const watermark = await shouldWatermark(userId);

  const id = randomUUID();
  await spendCredits(userId, credits, (tx) => tx.insert(schema.generationJobs).values({
    id,
    credits,
    projectId: ver.projectId,
    sceneId: ver.sceneId ?? null,
    workspaceId: ver.workspaceId ?? null,
    requestedBy: userId,
    jobType: "enhancement",
    status: "queued",
    requestJson: {
      sourceVersionId: ver.id,
      // Enhance the unwatermarked master when there is one (never upscale/smooth a logo).
      sourceKey: ver.cleanKey ?? ver.outputKey,
      watermark,
      engine,
      interpolate: input.interpolate,
      upscale,
      workflows, // resolved wrapper workflow ids for the AI steps (worker falls back to defaults)
      denoise: !!input.denoise,
      preset: input.preset ?? null,
    },
    priority,
  }));
  await enqueueOrRefund(id, () => enqueueEnhance(id, { priority: bullPriority(priority) }));
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
async function toggleVersionFavoriteImpl(versionId: string): Promise<void> {
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
async function setVersionSelectedImpl(versionId: string): Promise<void> {
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
async function deleteGenerationVersionImpl(versionId: string): Promise<void> {
  const userId = await requireUserId();
  const [row] = await db
    .select({
      id: schema.generationVersions.id,
      key: schema.generationVersions.outputKey,
      cleanKey: schema.generationVersions.cleanKey,
      projectId: schema.generationVersions.projectId,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.generationVersions)
    .innerJoin(schema.projects, eq(schema.generationVersions.projectId, schema.projects.id))
    .where(eq(schema.generationVersions.id, versionId));
  if (!row || !(await userCanAccessProject(userId, row.projectId, "editor"))) throw new Error("Version not found");
  await db.delete(schema.generationVersions).where(eq(schema.generationVersions.id, versionId));
  if (row.key) await deleteObject(row.key).catch(() => {});
  if (row.cleanKey) await deleteObject(row.cleanKey).catch(() => {});
  revalidatePath(`/projects/${row.projectId}/edit`);
}

/** Fetch a generation job (owner-checked) — for status polling in the editor. */
async function getGenerationJobImpl(jobId: string) {
  const userId = await requireUserId();
  const [row] = await db
    .select({
      id: schema.generationJobs.id,
      projectId: schema.generationJobs.projectId,
      status: schema.generationJobs.status,
      progress: schema.generationJobs.progress,
      jobType: schema.generationJobs.jobType,
      errorMessage: schema.generationJobs.errorMessage,
      priority: schema.generationJobs.priority,
      createdAt: schema.generationJobs.createdAt,
    })
    .from(schema.generationJobs)
    .where(eq(schema.generationJobs.id, jobId));
  if (!row || !(await userCanAccessProject(userId, row.projectId))) throw new Error("Job not found");
  const queuePosition = await queuePositionOf(row);
  return {
    id: row.id, projectId: row.projectId, status: row.status, progress: row.progress, jobType: row.jobType,
    errorMessage: friendlyJobError(row.errorMessage), errorDetail: row.errorMessage, queuePosition,
  };
}

/**
 * Cancel a generation job (owner-checked). Removes it from the queue if still pending and marks it
 * cancelled; the worker also checks for cancellation and interrupts the provider job if it is
 * already running.
 */
async function cancelGenerationJobImpl(jobId: string): Promise<void> {
  const userId = await requireUserId();
  const [row] = await db
    .select({
      id: schema.generationJobs.id,
      projectId: schema.generationJobs.projectId,
      status: schema.generationJobs.status,
      jobType: schema.generationJobs.jobType,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.generationJobs)
    .innerJoin(schema.projects, eq(schema.generationJobs.projectId, schema.projects.id))
    .where(eq(schema.generationJobs.id, jobId));
  if (!row || !(await userCanAccessProject(userId, row.projectId, "editor"))) throw new Error("Job not found");

  // Only a job that is still running can be cancelled — never overwrite a finished one (CW-MVP-084).
  const [hit] = await db
    .update(schema.generationJobs)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(schema.generationJobs.id, jobId), sql`${schema.generationJobs.status} not in ('completed', 'failed', 'cancelled', 'retried')`))
    .returning({ id: schema.generationJobs.id });
  if (!hit) throw new Error("This job has already finished");
  // Remove it from its BullMQ queue if it hasn't been claimed yet (best-effort). Enhancements and
  // storyboards run on the enhance queue, generations on the generation queue.
  const queue = row.jobType === "enhancement" || row.jobType === "montage" || row.jobType === "remix" ? enhanceQueue() : generationQueue();
  await queue.remove(jobId).catch(() => {});
  revalidatePath(`/projects/${row.projectId}/edit`);
}

/**
 * CW-MVP-121 "Edit & regenerate": the Generate-tab settings that produced a version, so the form can
 * be re-opened with them, changed, and generated as a new version. Viewer access is enough to read.
 */
async function getVersionSettingsImpl(versionId: string): Promise<GenerationSettings & { sourceAssetId: string | null }> {
  const userId = await requireUserId();
  const [row] = await db
    .select({
      projectId: schema.generationVersions.projectId,
      jobType: schema.generationJobs.jobType,
      prompt: schema.generationJobs.prompt,
      negativePrompt: schema.generationJobs.negativePrompt,
      request: schema.generationJobs.requestJson,
    })
    .from(schema.generationVersions)
    .innerJoin(schema.generationJobs, eq(schema.generationVersions.generationJobId, schema.generationJobs.id))
    .where(eq(schema.generationVersions.id, versionId));
  if (!row || !(await userCanAccessProject(userId, row.projectId))) throw new Error("Version not found");
  if (row.jobType !== "text_to_video" && row.jobType !== "image_to_video") throw new Error("Only generated versions have settings to edit");
  const rq = (row.request ?? {}) as Record<string, unknown>;
  const w = Number(rq.width), h = Number(rq.height);
  const aspect = w && h ? (w > h ? "16:9" : h > w ? "9:16" : "1:1") : "16:9";
  const settings = normalizeSettings({
    mode: row.jobType === "text_to_video" ? "text" : "image",
    // Older jobs only have the folded prompt (style/camera phrases appended) — use it as-is.
    prompt: typeof rq.userPrompt === "string" ? rq.userPrompt : (row.prompt ?? ""),
    negativePrompt: row.negativePrompt ?? "",
    style: rq.style, camera: rq.camera, motion: rq.motion, aspect,
    duration: rq.durationSec, quality: rq.quality,
    seed: rq.seed ?? "",
  });
  return { ...settings, sourceAssetId: typeof rq.sourceAssetId === "string" ? rq.sourceAssetId : null };
}

export type GenerationPresetItem = { id: string; name: string; settings: GenerationSettings };

/** CW-MVP-172: the current user's last-used Generate settings (null if none yet). */
async function getRecentGenerationSettingsImpl(): Promise<GenerationSettings | null> {
  const userId = await requireUserId();
  const [r] = await db.select({ settings: schema.generationPresets.settings }).from(schema.generationPresets)
    .where(and(eq(schema.generationPresets.userId, userId), eq(schema.generationPresets.isRecent, true)));
  return r ? normalizeSettings(r.settings) : null;
}

/** CW-MVP-173: the current user's named favourite presets, newest first. */
async function listGenerationPresetsImpl(): Promise<GenerationPresetItem[]> {
  const userId = await requireUserId();
  const rows = await db.select().from(schema.generationPresets)
    .where(and(eq(schema.generationPresets.userId, userId), eq(schema.generationPresets.isRecent, false)))
    .orderBy(desc(schema.generationPresets.updatedAt));
  return rows.map((r) => ({ id: r.id, name: r.name ?? "Preset", settings: normalizeSettings(r.settings) }));
}

async function saveGenerationPresetImpl(name: string, settings: GenerationSettings): Promise<string> {
  const userId = await requireUserId();
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new Error("Give the preset a name");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.generationPresets)
    .where(and(eq(schema.generationPresets.userId, userId), eq(schema.generationPresets.isRecent, false)));
  if (n >= 30) throw new Error("You can keep up to 30 presets — delete one first");
  const id = randomUUID();
  await db.insert(schema.generationPresets).values({ id, userId, name: clean, settings: normalizeSettings(settings) });
  return id;
}

async function deleteGenerationPresetImpl(id: string): Promise<void> {
  const userId = await requireUserId();
  await db.delete(schema.generationPresets)
    .where(and(eq(schema.generationPresets.id, id), eq(schema.generationPresets.userId, userId), eq(schema.generationPresets.isRecent, false)));
}

export type AiStudioStatus = { state: "online" | "busy" | "degraded" | "offline"; gpus: number; activeJobs: number };

// Cached so a page full of Generate tabs doesn't hammer the AISERVER (30 s).
let studioCache: { at: number; value: AiStudioStatus } | null = null;
/** CW-MVP-080: AI studio (AISERVER) health for the Generate tab's status pill. */
async function getAiStudioStatusImpl(): Promise<AiStudioStatus> {
  await requireUserId();
  if (studioCache && Date.now() - studioCache.at < 30_000) return studioCache.value;
  let value: AiStudioStatus;
  try {
    const { aiProvider } = await import("./ai/comfyui-provider");
    const h = await Promise.race([
      aiProvider.healthCheck(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
    ]);
    const online = h.comfyui === "online";
    value = {
      state: !online && h.comfyui !== "partial" ? "offline" : h.status !== "healthy" ? "degraded" : h.activeJobs >= h.gpuCount ? "busy" : "online",
      gpus: h.gpuCount, activeJobs: h.activeJobs,
    };
  } catch {
    value = { state: "offline", gpus: 0, activeJobs: 0 };
  }
  studioCache = { at: Date.now(), value };
  return value;
}

// ── Actions that spend AI credits return their errors (see src/lib/action-result.ts: thrown messages are replaced by a
// generic error in production, and "not enough credits" must be readable). Client: unwrap(await action(...)).
export async function createGenerationJob(input: CreateGenerationInput): Promise<ActionResult<string>> {
  return toResult(() => createGenerationJobImpl(input));
}
export async function regenerateFromVersion(versionId: string, fresh: boolean): Promise<ActionResult<string>> {
  return toResult(() => regenerateFromVersionImpl(versionId, fresh));
}
export async function retryGenerationJob(jobId: string): Promise<ActionResult<string>> {
  return toResult(() => retryGenerationJobImpl(jobId));
}
export async function enhanceVersion(input: {
  versionId: string;
  interpolate: boolean;
  upscale: boolean;
  /**
   * "ffmpeg" = fast interpolate/upscale; "ai" = Real-ESRGAN 2× upscale on AISERVER;
   * "restore" = SeedVR2 diffusion restoration + 2× upscale on AISERVER (always upscales; ADR-0007).
   */
  engine?: "ffmpeg" | "ai" | "restore";
  /** Fast engine only: light denoise + sharpen (the "Clean" preset, CW-MVP-132). */
  denoise?: boolean;
  /** Preset name for display: clean | smooth | sharp | max. */
  preset?: string | null;
}): Promise<ActionResult<string>> {
  return toResult(() => enhanceVersionImpl(input));
}

// Exported actions return ActionResult (action-result.ts — thrown messages are hidden in production builds).
// Client: unwrap(await action(...)).
export async function getGenerationAvailability(...args: Parameters<typeof getGenerationAvailabilityImpl>) { return toResult(() => getGenerationAvailabilityImpl(...args)); }
export async function listGenerationVersions(...args: Parameters<typeof listGenerationVersionsImpl>) { return toResult(() => listGenerationVersionsImpl(...args)); }
export async function toggleVersionFavorite(...args: Parameters<typeof toggleVersionFavoriteImpl>) { return toResult(() => toggleVersionFavoriteImpl(...args)); }
export async function setVersionSelected(...args: Parameters<typeof setVersionSelectedImpl>) { return toResult(() => setVersionSelectedImpl(...args)); }
export async function deleteGenerationVersion(...args: Parameters<typeof deleteGenerationVersionImpl>) { return toResult(() => deleteGenerationVersionImpl(...args)); }
export async function getGenerationJob(...args: Parameters<typeof getGenerationJobImpl>) { return toResult(() => getGenerationJobImpl(...args)); }
export async function cancelGenerationJob(...args: Parameters<typeof cancelGenerationJobImpl>) { return toResult(() => cancelGenerationJobImpl(...args)); }
export async function getVersionSettings(...args: Parameters<typeof getVersionSettingsImpl>) { return toResult(() => getVersionSettingsImpl(...args)); }
export async function getRecentGenerationSettings(...args: Parameters<typeof getRecentGenerationSettingsImpl>) { return toResult(() => getRecentGenerationSettingsImpl(...args)); }
export async function listGenerationPresets(...args: Parameters<typeof listGenerationPresetsImpl>) { return toResult(() => listGenerationPresetsImpl(...args)); }
export async function saveGenerationPreset(...args: Parameters<typeof saveGenerationPresetImpl>) { return toResult(() => saveGenerationPresetImpl(...args)); }
export async function deleteGenerationPreset(...args: Parameters<typeof deleteGenerationPresetImpl>) { return toResult(() => deleteGenerationPresetImpl(...args)); }
export async function getAiStudioStatus(...args: Parameters<typeof getAiStudioStatusImpl>) { return toResult(() => getAiStudioStatusImpl(...args)); }
