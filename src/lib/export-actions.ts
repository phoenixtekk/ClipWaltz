"use server";
import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { enqueueExport } from "./queue";
import { deleteObject } from "./storage";

export type ExportFormat = "mp4" | "webm";
export type ExportResolution = "native" | "720p" | "1080p";

export type ExportJobItem = {
  id: string;
  sourceVersionId: string | null;
  status: string;
  outputFormat: string;
  resolution: string | null;
  hasOutput: boolean;
  errorMessage: string | null;
  createdAt: string;
};

/** Create + queue an export (transcode a generated version to a deliverable). Owner-checked. */
export async function createExportJob(input: {
  versionId: string;
  outputFormat: ExportFormat;
  resolution: ExportResolution;
}): Promise<string> {
  const userId = await requireUserId();
  const [ver] = await db
    .select({
      id: schema.generationVersions.id,
      projectId: schema.generationVersions.projectId,
      outputKey: schema.generationVersions.outputKey,
      workspaceId: schema.projects.workspaceId,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.generationVersions)
    .innerJoin(schema.projects, eq(schema.generationVersions.projectId, schema.projects.id))
    .where(eq(schema.generationVersions.id, input.versionId));
  if (!ver || ver.ownerId !== userId) throw new Error("Version not found");
  if (!ver.outputKey) throw new Error("This version has no output to export yet");

  const id = randomUUID();
  await db.insert(schema.exportJobs).values({
    id,
    projectId: ver.projectId,
    workspaceId: ver.workspaceId ?? null,
    sourceVersionId: ver.id,
    requestedBy: userId,
    status: "queued",
    outputFormat: input.outputFormat,
    resolution: input.resolution,
  });
  await enqueueExport(id);
  revalidatePath(`/projects/${ver.projectId}/edit`);
  return id;
}

/** List a project's export jobs, newest first (owner-checked) — the Export Center. */
export async function listExportJobs(projectId: string): Promise<ExportJobItem[]> {
  const userId = await requireUserId();
  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!proj) throw new Error("Project not found");
  const rows = await db
    .select({
      id: schema.exportJobs.id,
      sourceVersionId: schema.exportJobs.sourceVersionId,
      status: schema.exportJobs.status,
      outputFormat: schema.exportJobs.outputFormat,
      resolution: schema.exportJobs.resolution,
      outputKey: schema.exportJobs.outputKey,
      errorMessage: schema.exportJobs.errorMessage,
      createdAt: schema.exportJobs.createdAt,
    })
    .from(schema.exportJobs)
    .where(eq(schema.exportJobs.projectId, projectId))
    .orderBy(desc(schema.exportJobs.createdAt));
  return rows.map((r) => ({
    id: r.id,
    sourceVersionId: r.sourceVersionId,
    status: r.status,
    outputFormat: r.outputFormat,
    resolution: r.resolution,
    hasOutput: !!r.outputKey,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Delete an export job (owner-checked): row + its MinIO object. */
export async function deleteExportJob(exportId: string): Promise<void> {
  const userId = await requireUserId();
  const [row] = await db
    .select({
      id: schema.exportJobs.id,
      key: schema.exportJobs.outputKey,
      projectId: schema.exportJobs.projectId,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.exportJobs)
    .innerJoin(schema.projects, eq(schema.exportJobs.projectId, schema.projects.id))
    .where(eq(schema.exportJobs.id, exportId));
  if (!row || row.ownerId !== userId) throw new Error("Export not found");
  await db.delete(schema.exportJobs).where(eq(schema.exportJobs.id, exportId));
  if (row.key) await deleteObject(row.key).catch(() => {});
  revalidatePath(`/projects/${row.projectId}/edit`);
}
