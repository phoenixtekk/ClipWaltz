"use server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { userCanAccessProject } from "./workspace";
import { requireUserId } from "./auth";
import { requireAdmin } from "./admin";
import { getPresetShape } from "./presets";

async function assertProjectOwner(userId: string, projectId: string) {
  const [p] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!p || !(await userCanAccessProject(userId, projectId, "editor"))) throw new Error("Project not found");
}

/** Snapshot a project's current Format + Style + overlays into a new personal preset. */
export async function createPresetFromProject(projectId: string, name: string): Promise<string> {
  const userId = await requireUserId();
  await assertProjectOwner(userId, projectId);
  const clean = name.trim().slice(0, 60) || "My preset";
  const [p] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!p) throw new Error("Project not found");

  const id = randomUUID();
  await db.insert(schema.presets).values({
    id,
    ownerId: userId,
    name: clean,
    aspect: p.aspect,
    lengthSec: p.lengthSec,
    maxFootage: p.maxFootage,
    styleFilter: p.styleFilter,
    lightFx: p.lightFx,
    transition: p.transition,
    motion: p.motion,
    fades: p.fades,
    fadeOut: p.fadeOut,
    smartCut: p.smartCut,
    beatSync: p.beatSync,
    waltzToMusic: p.waltzToMusic,
    loopToFill: p.loopToFill,
    overlays: p.overlays ?? null,
  });
  revalidatePath(`/projects/${projectId}/edit`);
  return id;
}

/** Re-snapshot a project's current Format + Style + overlays INTO an existing personal preset. */
export async function updatePresetFromProject(projectId: string, presetId: string): Promise<void> {
  const userId = await requireUserId();
  await assertProjectOwner(userId, projectId);
  const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!p) throw new Error("Project not found");
  const res = await db
    .update(schema.presets)
    .set({
      aspect: p.aspect,
      lengthSec: p.lengthSec,
      maxFootage: p.maxFootage,
      styleFilter: p.styleFilter,
      lightFx: p.lightFx,
      transition: p.transition,
      motion: p.motion,
      fades: p.fades,
      fadeOut: p.fadeOut,
      smartCut: p.smartCut,
      beatSync: p.beatSync,
      waltzToMusic: p.waltzToMusic,
      loopToFill: p.loopToFill,
      overlays: p.overlays ?? null,
    })
    .where(and(eq(schema.presets.id, presetId), eq(schema.presets.ownerId, userId)))
    .returning({ id: schema.presets.id });
  if (res.length === 0) throw new Error("Preset not found (only your own presets can be updated)");
  revalidatePath(`/projects/${projectId}/edit`);
}

/** Apply a preset (built-in, personal, or global) onto a project the user owns. */
export async function applyPreset(projectId: string, presetId: string): Promise<void> {
  const userId = await requireUserId();
  await assertProjectOwner(userId, projectId);
  const shape = await getPresetShape(presetId);
  if (!shape) throw new Error("Preset not found");
  await db
    .update(schema.projects)
    .set({
      aspect: shape.aspect,
      lengthSec: shape.lengthSec,
      maxFootage: shape.maxFootage,
      styleFilter: shape.styleFilter,
      lightFx: shape.lightFx,
      transition: shape.transition,
      motion: shape.motion,
      fades: shape.fades,
      fadeOut: shape.fadeOut,
      smartCut: shape.smartCut,
      beatSync: shape.beatSync,
      waltzToMusic: shape.waltzToMusic,
      loopToFill: shape.loopToFill,
      overlays: shape.overlays.length ? shape.overlays : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, projectId));
  revalidatePath(`/projects/${projectId}/edit`);
}

/** Delete a personal preset (owner-checked). */
export async function deletePreset(presetId: string): Promise<void> {
  const userId = await requireUserId();
  await db
    .delete(schema.presets)
    .where(and(eq(schema.presets.id, presetId), eq(schema.presets.ownerId, userId)));
  revalidatePath("/dashboard");
}

/** Set (or clear, with null) the user's default preset — auto-applied to new projects. */
export async function setDefaultPreset(presetId: string | null): Promise<void> {
  const userId = await requireUserId();
  // clear any existing default first
  await db
    .update(schema.presets)
    .set({ isDefault: false })
    .where(and(eq(schema.presets.ownerId, userId), eq(schema.presets.isDefault, true)));
  if (presetId) {
    await db
      .update(schema.presets)
      .set({ isDefault: true })
      .where(and(eq(schema.presets.id, presetId), eq(schema.presets.ownerId, userId)));
  }
  revalidatePath("/dashboard");
}

// ── Admin: global presets, pushed to every user (ties to the admin content area) ──

/** Admin: publish a snapshot as a global preset visible to everyone. */
export async function publishGlobalPreset(input: {
  name: string;
  aspect: string;
  lengthSec: number;
  maxFootage: boolean;
  styleFilter: string;
  lightFx: string;
  transition: string;
  motion: boolean;
  fades: boolean;
  fadeOut: boolean;
  smartCut: boolean;
  beatSync: boolean;
  waltzToMusic: boolean;
  loopToFill: boolean;
}): Promise<void> {
  const admin = await requireAdmin();
  const id = randomUUID();
  await db.insert(schema.presets).values({
    id,
    ownerId: null,
    name: input.name.trim().slice(0, 60) || "Global preset",
    isGlobal: true,
    createdBy: admin.user.id,
    aspect: input.aspect,
    lengthSec: input.lengthSec,
    maxFootage: input.maxFootage,
    styleFilter: input.styleFilter,
    lightFx: input.lightFx,
    transition: input.transition,
    motion: input.motion,
    fades: input.fades,
    fadeOut: input.fadeOut,
    smartCut: input.smartCut,
    beatSync: input.beatSync,
    waltzToMusic: input.waltzToMusic,
    loopToFill: input.loopToFill,
  });
  revalidatePath("/admin");
}

/** Admin: remove a global preset. */
export async function deleteGlobalPreset(presetId: string): Promise<void> {
  await requireAdmin();
  await db
    .delete(schema.presets)
    .where(and(eq(schema.presets.id, presetId), eq(schema.presets.isGlobal, true)));
  revalidatePath("/admin");
}
