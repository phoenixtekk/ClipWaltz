"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { assertProjectRole, userCanAccessProject } from "./workspace";

/**
 * Remove a clip from a project (the placement only). The underlying file stays in the
 * user's media library (delete it there to remove the object). Editor-checked.
 */
export async function deleteAsset(projectId: string, assetId: string): Promise<void> {
  const userId = await requireUserId();
  const [row] = await db
    .select({ ownerId: schema.projects.ownerId })
    .from(schema.assets)
    .innerJoin(schema.projects, eq(schema.assets.projectId, schema.projects.id))
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)));
  if (!row || !(await userCanAccessProject(userId, projectId, "editor"))) throw new Error("Asset not found");

  const [gone] = await db.delete(schema.assets).where(eq(schema.assets.id, assetId)).returning({ mediaId: schema.assets.mediaId });
  // Deleting the front clip of a stitched Insta360 pair brings its hidden rear clip back.
  if (gone?.mediaId) {
    const [m] = await db.select({ pair: schema.media.pairMediaId }).from(schema.media).where(eq(schema.media.id, gone.mediaId));
    if (m?.pair) await db.update(schema.assets).set({ hidden: false }).where(and(eq(schema.assets.projectId, projectId), eq(schema.assets.mediaId, m.pair)));
  }
  revalidatePath(`/projects/${projectId}/import`);
  revalidatePath(`/projects/${projectId}/edit`);
}

/**
 * Set (or clear, with null) a clip's manual screen time in seconds. Editor-checked. Clamped to
 * 0.4–60s; for videos, capped at the source length so we never read past the clip.
 */
export async function setAssetDuration(
  projectId: string,
  assetId: string,
  seconds: number | null,
): Promise<void> {
  const userId = await requireUserId();
  const [row] = await db
    .select({ ownerId: schema.projects.ownerId, kind: schema.assets.kind, durationSec: schema.assets.durationSec })
    .from(schema.assets)
    .innerJoin(schema.projects, eq(schema.assets.projectId, schema.projects.id))
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)));
  if (!row || !(await userCanAccessProject(userId, projectId, "editor"))) throw new Error("Asset not found");

  let val: number | null = null;
  if (seconds != null && Number.isFinite(seconds)) {
    let v = Math.max(0.4, Math.min(60, seconds));
    if (row.kind === "video" && row.durationSec) v = Math.min(v, row.durationSec);
    val = Math.round(v * 10) / 10;
  }
  await db.update(schema.assets).set({ durationOverride: val }).where(eq(schema.assets.id, assetId));
  revalidatePath(`/projects/${projectId}/edit`);
}

/**
 * Set (or clear, with nulls) a video's trim in/out points in seconds — only [start,end] renders.
 * Editor-checked. Clamped to the source length; enforces a ≥0.4s window. Takes precedence over the
 * smart-cut window and the manual duration for that clip.
 */
export async function setAssetTrim(
  projectId: string,
  assetId: string,
  start: number | null,
  end: number | null,
): Promise<void> {
  const userId = await requireUserId();
  const [row] = await db
    .select({ ownerId: schema.projects.ownerId, kind: schema.assets.kind, durationSec: schema.assets.durationSec })
    .from(schema.assets)
    .innerJoin(schema.projects, eq(schema.assets.projectId, schema.projects.id))
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)));
  if (!row || !(await userCanAccessProject(userId, projectId, "editor"))) throw new Error("Asset not found");
  if (row.kind !== "video") throw new Error("Only videos can be trimmed");

  let s: number | null = null;
  let e: number | null = null;
  if (start != null && end != null && Number.isFinite(start) && Number.isFinite(end)) {
    const max = row.durationSec ?? end;
    s = Math.max(0, Math.min(start, max));
    e = Math.max(s + 0.4, Math.min(end, max));
    s = Math.round(s * 10) / 10;
    e = Math.round(e * 10) / 10;
  }
  await db.update(schema.assets).set({ trimStart: s, trimEnd: e }).where(eq(schema.assets.id, assetId));
  revalidatePath(`/projects/${projectId}/edit`);
}

/**
 * CW-MVP-024: set a clip's tags (editor-checked). Normalised to lowercase, trimmed, de-duplicated;
 * up to 10 tags of up to 24 characters.
 */
export async function setAssetTags(projectId: string, assetId: string, tags: string[]): Promise<string[]> {
  const userId = await requireUserId();
  if (!(await userCanAccessProject(userId, projectId, "editor"))) throw new Error("Asset not found");
  const clean = [...new Set((Array.isArray(tags) ? tags : [])
    .map((t) => String(t).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 24))
    .filter(Boolean))].slice(0, 10);
  const r = await db.update(schema.assets).set({ tags: clean.length ? clean : null })
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)))
    .returning({ id: schema.assets.id });
  if (!r.length) throw new Error("Asset not found");
  revalidatePath(`/projects/${projectId}/edit`);
  return clean;
}

const REFRAME_MODES = ["flat", "follow", "tiny"] as const;

/**
 * Change how a 360 clip (Insta360 .insv/.lrv) is reframed — flat (front view), follow (tracks the
 * action) or tiny (little planet) — and queue it for re-conversion. Editor-checked. The setting
 * lives on the source media, so every project using that file gets the new view; renders wait
 * until the re-conversion is ready (a few minutes for long clips).
 */
export async function setClipReframe(projectId: string, assetId: string, mode: string): Promise<void> {
  const userId = await requireUserId();
  if (!(REFRAME_MODES as readonly string[]).includes(mode)) throw new Error("Unknown 360 view");
  const [row] = await db
    .select({ mediaId: schema.assets.mediaId, sourceFormat: schema.assets.sourceFormat })
    .from(schema.assets)
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)));
  if (!row || !(await userCanAccessProject(userId, projectId, "editor"))) throw new Error("Asset not found");
  if (!row.mediaId || (row.sourceFormat !== "insv" && row.sourceFormat !== "lrv")) throw new Error("Only 360 videos have a 360 view");
  await db.update(schema.media).set({ reframeMode: mode, conversionState: "pending" }).where(eq(schema.media.id, row.mediaId));
  await db.update(schema.assets).set({ conversionState: "pending" }).where(eq(schema.assets.mediaId, row.mediaId));
  revalidatePath(`/projects/${projectId}/edit`);
}

/**
 * Set the full clip order for a project (timeline drag-reorder + insert). Editor-checked;
 * only assets that belong to the project are (re)numbered, any omitted keep a stable tail.
 */
export async function reorderAssets(projectId: string, orderedIds: string[]): Promise<void> {
  const userId = await requireUserId();
  await assertProjectRole(userId, projectId, "editor");

  const rows = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(eq(schema.assets.projectId, projectId));
  const valid = new Set(rows.map((r) => r.id));
  const seen = new Set<string>();
  const order = orderedIds.filter((id) => valid.has(id) && !seen.has(id) && seen.add(id));
  // append any project assets the client didn't mention (keeps them at the end)
  for (const r of rows) if (!seen.has(r.id)) order.push(r.id);

  for (let i = 0; i < order.length; i++) {
    await db.update(schema.assets).set({ orderIndex: i }).where(eq(schema.assets.id, order[i]));
  }
  revalidatePath(`/projects/${projectId}/edit`);
}
