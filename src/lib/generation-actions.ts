"use server";
import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { enqueueGeneration, enqueueEnhance, generationQueue } from "./queue";
import { deleteObject } from "./storage";

export type GenerationJobType = "text_to_video" | "image_to_video" | "montage" | "enhancement";

export type CreateGenerationInput = {
  projectId: string;
  /** Workflow id the AISERVER provider exposes, e.g. "ltx-image-to-video-v1". */
  workflow: string;
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
    .where(and(eq(schema.projects.id, input.projectId), eq(schema.projects.ownerId, userId)));
  if (!proj) throw new Error("Project not found");

  if (input.jobType === "image_to_video" && !input.sourceAssetId) {
    throw new Error("Image-to-video needs a source image");
  }
  if (input.jobType === "text_to_video" && !input.prompt?.trim()) {
    throw new Error("Text-to-video needs a prompt");
  }

  const id = randomUUID();
  await db.insert(schema.generationJobs).values({
    id,
    projectId: input.projectId,
    sceneId: input.sceneId ?? null,
    workspaceId: proj.workspaceId ?? null,
    requestedBy: userId,
    jobType: input.jobType,
    status: "queued",
    workflowName: input.workflow,
    prompt: input.prompt ?? null,
    negativePrompt: input.negativePrompt ?? null,
    // Everything the worker needs to build the provider request (kept off the hot columns).
    requestJson: {
      workflow: input.workflow,
      sourceAssetId: input.sourceAssetId ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      durationSec: input.durationSec ?? null,
      motion: input.motion ?? "balanced",
      seed: input.seed ?? null,
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
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!proj) throw new Error("Project not found");
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
  if (!ver || ver.ownerId !== userId) throw new Error("Version not found");

  const [job] = await db
    .select()
    .from(schema.generationJobs)
    .where(eq(schema.generationJobs.id, ver.jobId));
  if (!job) throw new Error("Source job not found");

  const req = (job.requestJson ?? {}) as Record<string, unknown>;
  const id = randomUUID();
  await db.insert(schema.generationJobs).values({
    id,
    projectId: job.projectId,
    sceneId: job.sceneId ?? null,
    workspaceId: job.workspaceId ?? null,
    requestedBy: userId,
    jobType: job.jobType,
    status: "queued",
    workflowName: job.workflowName,
    prompt: job.prompt ?? null,
    negativePrompt: job.negativePrompt ?? null,
    requestJson: { ...req, seed: fresh ? null : (req.seed ?? null) },
  });
  await enqueueGeneration(id);
  revalidatePath(`/projects/${job.projectId}/edit`);
  return id;
}

/**
 * Enhance a version (owner-checked): queue an `enhancement` job that ffmpeg-post-processes the
 * source clip (motion interpolation and/or 2× upscale) into a NEW version. Returns the new job id.
 */
export async function enhanceVersion(input: {
  versionId: string;
  interpolate: boolean;
  upscale: boolean;
}): Promise<string> {
  const userId = await requireUserId();
  if (!input.interpolate && !input.upscale) throw new Error("Pick at least one enhancement");
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
  if (!ver || ver.ownerId !== userId) throw new Error("Version not found");
  if (!ver.outputKey) throw new Error("This version has no output to enhance yet");

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
      interpolate: input.interpolate,
      upscale: input.upscale,
    },
  });
  await enqueueEnhance(id);
  revalidatePath(`/projects/${ver.projectId}/edit`);
  return id;
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
  if (!row || row.ownerId !== userId) throw new Error("Version not found");
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
      ownerId: schema.projects.ownerId,
    })
    .from(schema.generationJobs)
    .innerJoin(schema.projects, eq(schema.generationJobs.projectId, schema.projects.id))
    .where(eq(schema.generationJobs.id, jobId));
  if (!row || row.ownerId !== userId) throw new Error("Job not found");
  const { ownerId: _ownerId, ...job } = row;
  return job;
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
  if (!row || row.ownerId !== userId) throw new Error("Job not found");

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
