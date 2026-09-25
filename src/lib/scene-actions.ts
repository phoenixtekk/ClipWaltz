"use server";
import { randomUUID } from "crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { userCanAccessProject } from "./workspace";
import { enqueueEnhance } from "./queue";

// CW-MVP-160..162 scenes: a simple ordered storyboard per project. Each scene has a title, a target
// length and the generated version picked for it; "Assemble" joins the picks in order into one new
// version (a `montage` job on the enhance queue). Not a full editor, by design.

export type SceneItem = {
  id: string; title: string; durationTarget: number | null; sequenceNumber: number;
  selectedVersionId: string | null; selectedVersionNumber: number | null;
};

async function assertAccess(projectId: string, role: "viewer" | "editor") {
  const userId = await requireUserId();
  if (!(await userCanAccessProject(userId, projectId, role))) throw new Error("Project not found");
  return userId;
}
const touch = (projectId: string) => revalidatePath(`/projects/${projectId}/edit`);

export async function listScenes(projectId: string): Promise<SceneItem[]> {
  await assertAccess(projectId, "viewer");
  const rows = await db
    .select({
      id: schema.scenes.id, title: schema.scenes.title, durationTarget: schema.scenes.durationTarget,
      sequenceNumber: schema.scenes.sequenceNumber, selectedVersionId: schema.scenes.selectedVersionId,
      versionNumber: schema.generationVersions.versionNumber,
    })
    .from(schema.scenes)
    .leftJoin(schema.generationVersions, eq(schema.scenes.selectedVersionId, schema.generationVersions.id))
    .where(eq(schema.scenes.projectId, projectId))
    .orderBy(asc(schema.scenes.sequenceNumber), asc(schema.scenes.createdAt));
  return rows.map((r) => ({
    id: r.id, title: r.title ?? "Scene", durationTarget: r.durationTarget, sequenceNumber: r.sequenceNumber,
    selectedVersionId: r.versionNumber != null ? r.selectedVersionId : null, selectedVersionNumber: r.versionNumber ?? null,
  }));
}

const cleanTitle = (t: string) => t.trim().slice(0, 80) || "Scene";
const cleanDuration = (d: number | null) => (d == null || !Number.isFinite(d) ? null : Math.max(1, Math.min(30, Math.round(d * 10) / 10)));

export async function addScene(projectId: string, title: string, durationTarget: number | null): Promise<string> {
  await assertAccess(projectId, "editor");
  const existing = await db.select({ n: schema.scenes.sequenceNumber }).from(schema.scenes).where(eq(schema.scenes.projectId, projectId));
  if (existing.length >= 50) throw new Error("A project can have up to 50 scenes");
  const id = randomUUID();
  await db.insert(schema.scenes).values({
    id, projectId, title: cleanTitle(title), durationTarget: cleanDuration(durationTarget),
    sequenceNumber: existing.reduce((m, r) => Math.max(m, r.n), -1) + 1,
  });
  touch(projectId);
  return id;
}

export async function updateScene(projectId: string, sceneId: string, patch: { title?: string; durationTarget?: number | null }): Promise<void> {
  await assertAccess(projectId, "editor");
  const set: Partial<typeof schema.scenes.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = cleanTitle(patch.title);
  if (patch.durationTarget !== undefined) set.durationTarget = cleanDuration(patch.durationTarget);
  await db.update(schema.scenes).set(set).where(and(eq(schema.scenes.id, sceneId), eq(schema.scenes.projectId, projectId)));
  touch(projectId);
}

export async function deleteScene(projectId: string, sceneId: string): Promise<void> {
  await assertAccess(projectId, "editor");
  await db.delete(schema.scenes).where(and(eq(schema.scenes.id, sceneId), eq(schema.scenes.projectId, projectId)));
  touch(projectId);
}

/** CW-MVP-161: set the full scene order (ids not in the project are ignored). */
export async function reorderScenes(projectId: string, orderedIds: string[]): Promise<void> {
  await assertAccess(projectId, "editor");
  const rows = await db.select({ id: schema.scenes.id }).from(schema.scenes).where(eq(schema.scenes.projectId, projectId));
  const valid = new Set(rows.map((r) => r.id));
  const ids = orderedIds.filter((id) => valid.has(id));
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.update(schema.scenes).set({ sequenceNumber: i, updatedAt: new Date() }).where(eq(schema.scenes.id, ids[i]));
    }
  });
  touch(projectId);
}

/** Use a generated version (of this project) for a scene; null clears it. */
export async function setSceneVersion(projectId: string, sceneId: string, versionId: string | null): Promise<void> {
  await assertAccess(projectId, "editor");
  if (versionId) {
    const [v] = await db.select({ id: schema.generationVersions.id }).from(schema.generationVersions)
      .where(and(eq(schema.generationVersions.id, versionId), eq(schema.generationVersions.projectId, projectId)));
    if (!v) throw new Error("Version not found");
  }
  await db.update(schema.scenes).set({ selectedVersionId: versionId, updatedAt: new Date() })
    .where(and(eq(schema.scenes.id, sceneId), eq(schema.scenes.projectId, projectId)));
  touch(projectId);
}

/**
 * Assemble the storyboard: every scene with a picked version, in order, each trimmed to its target
 * length (clips shorter than the target play in full), joined into one new version. Returns the job id.
 */
export async function assembleScenes(projectId: string): Promise<string> {
  const userId = await assertAccess(projectId, "editor");
  const scenes = await listScenes(projectId);
  const picked = scenes.filter((s) => s.selectedVersionId);
  if (picked.length < 2) throw new Error("Pick a version for at least two scenes first");
  const versions = await db.select({ id: schema.generationVersions.id, key: schema.generationVersions.outputKey })
    .from(schema.generationVersions)
    .where(and(eq(schema.generationVersions.projectId, projectId), inArray(schema.generationVersions.id, picked.map((s) => s.selectedVersionId!))));
  const keyOf = new Map(versions.map((v) => [v.id, v.key]));
  const parts = picked.map((s) => ({ sceneId: s.id, title: s.title, key: keyOf.get(s.selectedVersionId!), durationTarget: s.durationTarget }));
  if (parts.some((p) => !p.key)) throw new Error("One of the picked versions has no video yet");
  const [proj] = await db.select({ workspaceId: schema.projects.workspaceId }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const id = randomUUID();
  await db.insert(schema.generationJobs).values({
    id, projectId, workspaceId: proj?.workspaceId ?? null, requestedBy: userId, jobType: "montage", status: "queued",
    requestJson: { parts },
  });
  await enqueueEnhance(id);
  touch(projectId);
  return id;
}
