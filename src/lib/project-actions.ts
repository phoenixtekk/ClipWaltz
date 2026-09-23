"use server";
import { randomUUID } from "crypto";
import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";

async function assertProjectOwner(userId: string, projectId: string) {
  const [p] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!p) throw new Error("Project not found");
}

// Confirm the current user owns the project before any mutation (defends against
// a tampered projectId from the client).
async function assertOwner(userId: string, projectId: string) {
  const [row] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!row) throw new Error("Project not found");
}

// Templates selectable at MVP. "birthday" ships later, so it's not accepted yet.
const ACTIVE_TEMPLATES = new Set(["trip", "event", "surprise"]);
const DEFAULT_TITLE: Record<string, string> = {
  trip: "Trip video",
  event: "Event video",
  surprise: "Untitled project",
};

const ASPECTS = new Set(["9:16", "16:9"]);

/** Create a new draft project for the current user. Returns its id. */
export async function createProject(template?: string, aspect?: string): Promise<string> {
  const userId = await requireUserId();
  const t = template && ACTIVE_TEMPLATES.has(template) ? template : "surprise";
  const a = aspect && ASPECTS.has(aspect) ? aspect : "9:16";
  const { ensurePersonalWorkspace } = await import("./workspace");
  const workspaceId = await ensurePersonalWorkspace(userId);
  const id = randomUUID();
  await db.insert(schema.projects).values({
    id,
    ownerId: userId,
    workspaceId,
    template: t,
    aspect: a,
    title: DEFAULT_TITLE[t] ?? "Untitled project",
  });

  // If the user has a default preset, start the new project from it (Format + Style + overlays).
  // The explicit template/aspect above are the project's identity; the preset fills the look.
  const { getDefaultPresetShape } = await import("./presets");
  const preset = await getDefaultPresetShape(userId);
  if (preset) {
    await db
      .update(schema.projects)
      .set({
        lengthSec: preset.lengthSec,
        maxFootage: preset.maxFootage,
        styleFilter: preset.styleFilter,
        lightFx: preset.lightFx,
        transition: preset.transition,
        motion: preset.motion,
        fades: preset.fades,
        fadeOut: preset.fadeOut,
        smartCut: preset.smartCut,
        beatSync: preset.beatSync,
        waltzToMusic: preset.waltzToMusic,
        loopToFill: preset.loopToFill,
        overlays: preset.overlays.length ? preset.overlays : null,
      })
      .where(eq(schema.projects.id, id));
  }

  revalidatePath("/projects");
  return id;
}

export async function setProjectAspect(projectId: string, aspect: string): Promise<void> {
  const userId = await requireUserId();
  await assertProjectOwner(userId, projectId);
  const a = ASPECTS.has(aspect) ? aspect : "9:16";
  await db
    .update(schema.projects)
    .set({ aspect: a, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  revalidatePath(`/projects/${projectId}/edit`);
}

export async function deleteProject(projectId: string): Promise<void> {
  const userId = await requireUserId();
  await assertOwner(userId, projectId);
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  revalidatePath("/projects");
}

/** Move a project into a category (folder). Empty/whitespace → null (Uncategorized). */
export async function setProjectCategory(projectId: string, category: string | null): Promise<void> {
  const userId = await requireUserId();
  await assertOwner(userId, projectId);
  const c = (category ?? "").trim().slice(0, 60);
  await db
    .update(schema.projects)
    .set({ category: c || null, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  revalidatePath("/projects");
}

/** Replace a project's tags (deduped, trimmed, max 12 × 30 chars). */
export async function setProjectTags(projectId: string, tags: string[]): Promise<void> {
  const userId = await requireUserId();
  await assertOwner(userId, projectId);
  const clean = Array.from(
    new Set((tags ?? []).map((t) => String(t).trim().slice(0, 30)).filter(Boolean)),
  ).slice(0, 12);
  await db
    .update(schema.projects)
    .set({ tags: clean, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  revalidatePath("/projects");
}

export async function renameProject(projectId: string, title: string): Promise<void> {
  const userId = await requireUserId();
  await assertOwner(userId, projectId);
  const clean = title.trim().slice(0, 120) || "Untitled project";
  await db
    .update(schema.projects)
    .set({ title: clean, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  revalidatePath("/projects");
}

// Length in seconds: 15s minimum up to 60 minutes (3600s). Non-finite → 30s.
export async function setProjectLength(projectId: string, lengthSec: number): Promise<void> {
  const userId = await requireUserId();
  await assertProjectOwner(userId, projectId);
  const n = Math.round(lengthSec);
  const len = Number.isFinite(n) ? Math.min(3600, Math.max(15, n)) : 30;
  await db
    .update(schema.projects)
    .set({ lengthSec: len, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  revalidatePath(`/projects/${projectId}/edit`);
}

// The auto-assigned names a project can carry before the user has explicitly named it. While the
// title is still one of these, the Style Title (titleText) drives the project name (see below).
const DEFAULT_TITLES = new Set(Object.values(DEFAULT_TITLE));

const STYLE_FILTERS = new Set(["none", "warm", "cool", "vivid", "bw", "vintage"]);
const LIGHT_FX = new Set(["none", "vignette", "glow", "grain", "dreamy", "noir"]);
const TRANSITIONS = new Set(["cut", "crossfade"]);

/** Update Editor Phase-1 styling on a project (owner-checked). Partial patch. */
export async function setProjectStyle(
  projectId: string,
  patch: {
    titleText?: string | null;
    styleFilter?: string;
    lightFx?: string;
    transition?: string;
    motion?: boolean;
    fades?: boolean;
    fadeOut?: boolean;
    smartCut?: boolean;
    beatSync?: boolean;
    waltzToMusic?: boolean;
    describe?: boolean;
    postTopic?: string | null;
    postTemplate?: string | null;
    originalAudio?: boolean;
    musicVolume?: number | null;
    originalVolume?: number | null;
    loopToFill?: boolean;
    maxFootage?: boolean;
  },
): Promise<void> {
  const userId = await requireUserId();
  await assertProjectOwner(userId, projectId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  let titleFollowed = false;
  if (patch.titleText !== undefined) {
    const t = (patch.titleText ?? "").trim().slice(0, 80);
    set.titleText = t.length ? t : null;
    // If the project has never been explicitly named (still an auto default like "Untitled
    // project"), let the Title drive the project name so it doesn't linger as "Untitled" in the
    // projects list. Once the user renames it explicitly, the title is no longer a default and
    // this stops overriding it.
    if (t.length) {
      const [row] = await db
        .select({ title: schema.projects.title })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId));
      if (row && DEFAULT_TITLES.has(row.title)) {
        set.title = t.slice(0, 120);
        titleFollowed = true;
      }
    }
  }
  if (patch.styleFilter !== undefined)
    set.styleFilter = STYLE_FILTERS.has(patch.styleFilter) ? patch.styleFilter : "none";
  if (patch.lightFx !== undefined)
    set.lightFx = LIGHT_FX.has(patch.lightFx) ? patch.lightFx : "none";
  if (patch.transition !== undefined)
    set.transition = TRANSITIONS.has(patch.transition) ? patch.transition : "cut";
  if (patch.motion !== undefined) set.motion = !!patch.motion;
  if (patch.fades !== undefined) set.fades = !!patch.fades;
  if (patch.fadeOut !== undefined) set.fadeOut = !!patch.fadeOut;
  if (patch.smartCut !== undefined) set.smartCut = !!patch.smartCut;
  if (patch.beatSync !== undefined) set.beatSync = !!patch.beatSync;
  if (patch.waltzToMusic !== undefined) set.waltzToMusic = !!patch.waltzToMusic;
  if (patch.describe !== undefined) set.describe = !!patch.describe;
  if (patch.originalAudio !== undefined) set.originalAudio = !!patch.originalAudio;
  const clampVol = (v: number) => Math.max(0, Math.min(1.5, v));
  if (patch.musicVolume !== undefined)
    set.musicVolume = patch.musicVolume == null ? null : clampVol(patch.musicVolume);
  if (patch.originalVolume !== undefined)
    set.originalVolume = patch.originalVolume == null ? null : clampVol(patch.originalVolume);
  if (patch.postTopic !== undefined) {
    const t = (patch.postTopic ?? "").trim().slice(0, 200);
    set.postTopic = t.length ? t : null;
  }
  if (patch.postTemplate !== undefined) {
    const t = (patch.postTemplate ?? "").trim().slice(0, 6000);
    set.postTemplate = t.length ? t : null;
  }
  if (patch.loopToFill !== undefined) set.loopToFill = !!patch.loopToFill;
  if (patch.maxFootage !== undefined) set.maxFootage = !!patch.maxFootage;
  // "Max footage" and "loop to fill" are mutually exclusive intents (use everything vs repeat to
  // fill) — turning one on clears the other so the worker gets a coherent instruction.
  if (patch.maxFootage === true) set.loopToFill = false;
  if (patch.loopToFill === true) set.maxFootage = false;
  await db.update(schema.projects).set(set).where(eq(schema.projects.id, projectId));
  revalidatePath(`/projects/${projectId}/edit`);
  if (titleFollowed) {
    revalidatePath("/projects");
    revalidatePath("/dashboard");
  }
}

export async function setProjectMusic(projectId: string, trackId: string | null): Promise<void> {
  const userId = await requireUserId();
  await assertProjectOwner(userId, projectId);
  if (trackId) {
    const [t] = await db
      .select({ id: schema.musicTracks.id })
      .from(schema.musicTracks)
      .where(and(eq(schema.musicTracks.id, trackId), eq(schema.musicTracks.active, true)));
    if (!t) throw new Error("Track not found");
  }
  await db
    .update(schema.projects)
    .set({ musicTrackId: trackId, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  revalidatePath(`/projects/${projectId}/edit`);
}

export async function moveAsset(
  projectId: string,
  assetId: string,
  dir: "up" | "down",
): Promise<void> {
  const userId = await requireUserId();
  await assertProjectOwner(userId, projectId);
  const rows = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(eq(schema.assets.projectId, projectId))
    .orderBy(asc(schema.assets.orderIndex), asc(schema.assets.createdAt));
  const order = rows.map((r) => r.id);
  const idx = order.indexOf(assetId);
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= order.length) return;
  [order[idx], order[swap]] = [order[swap], order[idx]];
  for (let i = 0; i < order.length; i++) {
    await db.update(schema.assets).set({ orderIndex: i }).where(eq(schema.assets.id, order[i]));
  }
  revalidatePath(`/projects/${projectId}/edit`);
}

export async function duplicateProject(projectId: string): Promise<string> {
  const userId = await requireUserId();
  await assertOwner(userId, projectId);
  const [orig] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!orig) throw new Error("Project not found");
  const id = randomUUID();
  await db.insert(schema.projects).values({
    id,
    ownerId: userId,
    workspaceId: orig.workspaceId ?? null,
    title: `${orig.title} (copy)`,
    template: orig.template,
    aspect: orig.aspect,
    lengthSec: orig.lengthSec,
    status: "draft",
    musicTrackId: orig.musicTrackId,
  });
  revalidatePath("/projects");
  return id;
}
