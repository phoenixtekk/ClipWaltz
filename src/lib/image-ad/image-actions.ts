"use server";
// Waltz Image server actions (plan G1 / G2 / G5). Text edits only save `data` — the preview route re-composites on the
// server with no GPU job. Only "Make with AI" spends credits (IMAGE_COST per picture, refunded if it fails).
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { toResult } from "@/lib/action-result";
import { ensurePersonalWorkspace } from "@/lib/workspace";
import { deleteObject, purgePrefix, putObject } from "@/lib/storage";
import { requireSocial } from "@/lib/social/access";
import { writeMedia } from "@/lib/social/media";
import { MAX_VARIATIONS, TEXT_LIMITS } from "../../../worker/image/presets.mjs";
import { createImageJob } from "./jobs";
import {
  defaultData, designImageIds, designView, fileStem, isDesignKind, loadDesign, normalizeData, renderDesign, scrubImageRefs, validFormat,
} from "./designs";
import type { CarouselData, DesignData, DesignKind, DesignView, ImageAdData, MemeData } from "./types";

async function editable(id: string) {
  const userId = await requireUserId();
  const d = await loadDesign(userId, id, "editor");
  if (!d) throw new Error("Design not found");
  return { userId, ...d, kind: (isDesignKind(d.row.kind) ? d.row.kind : "image") as DesignKind };
}

async function createDesignImpl(kind: DesignKind, format: string, title?: string): Promise<string> {
  const userId = await requireUserId();
  if (!isDesignKind(kind)) throw new Error("Pick an image, a carousel or a meme.");
  const workspaceId = await ensurePersonalWorkspace(userId);
  const id = randomUUID();
  const name = String(title ?? "").trim().slice(0, 100) || (kind === "carousel" ? "Untitled carousel" : kind === "meme" ? "Untitled meme" : "Untitled image");
  await db.insert(schema.imageDesigns).values({
    id, workspaceId, createdBy: userId, kind, title: name, format: validFormat(kind, format), data: defaultData(kind),
  });
  revalidatePath("/images");
  return id;
}

async function getDesignImpl(id: string): Promise<DesignView> {
  const userId = await requireUserId();
  const d = await loadDesign(userId, id, "viewer");
  if (!d) throw new Error("Design not found");
  return designView(userId, d.row, d.role);
}

async function saveDesignImpl(id: string, patch: { title?: string; format?: string; data?: DesignData }): Promise<{ updatedAt: string }> {
  const { row, kind } = await editable(id);
  const set: Partial<typeof schema.imageDesigns.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = String(patch.title).trim().slice(0, 100) || row.title;
  if (patch.format !== undefined) set.format = validFormat(kind, patch.format);
  if (patch.data !== undefined) set.data = scrubImageRefs(kind, normalizeData(kind, patch.data), await designImageIds(id));
  const [u] = await db.update(schema.imageDesigns).set(set).where(eq(schema.imageDesigns.id, id)).returning({ updatedAt: schema.imageDesigns.updatedAt });
  return { updatedAt: u.updatedAt.toISOString() };
}

/**
 * Make AI pictures for the design: `count` variations for an image (1–4), one for a carousel slide or a meme. Each is
 * a generation job (IMAGE_COST credits). New pictures are applied straight away where nothing is chosen yet.
 */
async function generatePicturesImpl(id: string, opts: { brief: string; style?: string; count?: number; slideId?: string | null }): Promise<DesignView> {
  const { userId, row, role, kind } = await editable(id);
  const brief = String(opts.brief ?? "").trim().slice(0, TEXT_LIMITS.prompt);
  if (!brief) throw new Error("Describe the picture first.");
  const count = kind === "image" ? Math.min(MAX_VARIATIONS, Math.max(1, Math.round(Number(opts.count) || 1))) : 1;
  let data = normalizeData(kind, row.data);
  if (kind === "carousel" && !(data as CarouselData).slides.some((s) => s.id === opts.slideId)) throw new Error("Pick a slide first.");

  const made: string[] = [];
  let firstError: Error | null = null;
  for (let i = 0; i < count; i++) {
    const imageId = randomUUID();
    try {
      await createImageJob({ userId, workspaceId: row.workspaceId, brief, style: opts.style ?? (data as ImageAdData).style, format: row.format, design: { designId: id, imageId } });
      made.push(imageId);
    } catch (e) {
      firstError = e as Error;
      break; // out of credits or the queue is down — the rest would fail the same way
    }
  }
  if (made.length) {
    if (kind === "carousel") {
      const c = data as CarouselData;
      data = { ...c, brief, style: opts.style ?? c.style, slides: c.slides.map((s) => (s.id === opts.slideId ? { ...s, imageId: made[0] } : s)) };
    } else {
      const d = data as ImageAdData | MemeData;
      data = { ...d, brief, style: opts.style ?? d.style, imageId: d.imageId ?? made[0] } as DesignData;
    }
    await db.update(schema.imageDesigns).set({ data, updatedAt: new Date() }).where(eq(schema.imageDesigns.id, id));
  }
  if (!made.length && firstError) throw firstError;
  const [fresh] = await db.select().from(schema.imageDesigns).where(eq(schema.imageDesigns.id, id));
  return designView(userId, fresh, role);
}

/** Remove a picture from the design (and from any slide using it). */
async function deletePictureImpl(id: string, imageId: string): Promise<DesignView> {
  const { userId, row, role, kind } = await editable(id);
  const [img] = await db.select().from(schema.imageDesignImages)
    .where(and(eq(schema.imageDesignImages.id, imageId), eq(schema.imageDesignImages.designId, id)));
  if (!img) throw new Error("Picture not found");
  await db.delete(schema.imageDesignImages).where(eq(schema.imageDesignImages.id, imageId));
  if (img.storageKey) await deleteObject(img.storageKey).catch(() => {});
  const data = scrubImageRefs(kind, normalizeData(kind, row.data), await designImageIds(id));
  const [fresh] = await db.update(schema.imageDesigns).set({ data, updatedAt: new Date() }).where(eq(schema.imageDesigns.id, id)).returning();
  return designView(userId, fresh, role);
}

async function deleteDesignImpl(id: string): Promise<void> {
  const { row } = await editable(id);
  await db.delete(schema.imageDesigns).where(eq(schema.imageDesigns.id, id));
  // Pictures only: library copies saved from it live under …/out/ and belong to the media library now.
  await purgePrefix(`images/${row.workspaceId}/${id}/pic/`).catch(() => 0);
  revalidatePath("/images");
}

/** Composite every output and add it to the user's Media library (photos), so it can be used in any project. */
async function saveToLibraryImpl(id: string): Promise<{ saved: number }> {
  const { userId, row } = await editable(id);
  const outs = await renderDesign(row);
  const stem = fileStem(row);
  const ids: string[] = [];
  for (const o of outs) {
    const mediaId = randomUUID();
    const key = `images/${row.workspaceId}/${id}/out/${mediaId}.png`;
    await putObject(key, o.png, "image/png");
    await db.insert(schema.media).values({
      id: mediaId, ownerId: userId, kind: "photo", originalName: outs.length > 1 ? `${stem}-${o.index + 1}.png` : `${stem}.png`,
      storageKey: key, conversionState: "ready", sizeBytes: o.png.length, lastUsedAt: new Date(),
    });
    ids.push(mediaId);
  }
  await db.update(schema.imageDesigns).set({ savedMediaIds: ids, updatedAt: new Date() }).where(eq(schema.imageDesigns.id, id));
  return { saved: ids.length };
}

/**
 * Publish: composite every output, store each as an (unattached) social media file of the design's workspace and
 * return the composer URL that attaches them. Requires Social Publishing access (editor) in that workspace.
 */
async function prepareDesignPostImpl(id: string): Promise<{ url: string }> {
  const { userId, row } = await editable(id);
  const sc = await requireSocial(row.workspaceId, "editor");
  const outs = await renderDesign(row);
  const stem = fileStem(row);
  const ids: string[] = [];
  for (const o of outs) {
    const mediaId = randomUUID();
    const key = await writeMedia(sc.workspaceId, mediaId, o.png, "image/png");
    await db.insert(schema.socialMedia).values({
      id: mediaId, workspaceId: sc.workspaceId, createdBy: userId, postId: null, kind: "image",
      filename: outs.length > 1 ? `${stem}-${o.index + 1}.png` : `${stem}.png`, mime: "image/png", size: o.png.length,
      storageKey: key, source: o.usesAi ? "ai" : "upload",
    });
    ids.push(mediaId);
  }
  return { url: `/publish/compose?media=${ids.join(",")}&from=${id}` };
}

export async function createDesign(...a: Parameters<typeof createDesignImpl>) { return toResult(() => createDesignImpl(...a)); }
export async function getDesign(...a: Parameters<typeof getDesignImpl>) { return toResult(() => getDesignImpl(...a)); }
export async function saveDesign(...a: Parameters<typeof saveDesignImpl>) { return toResult(() => saveDesignImpl(...a)); }
export async function generatePictures(...a: Parameters<typeof generatePicturesImpl>) { return toResult(() => generatePicturesImpl(...a)); }
export async function deletePicture(...a: Parameters<typeof deletePictureImpl>) { return toResult(() => deletePictureImpl(...a)); }
export async function deleteDesign(...a: Parameters<typeof deleteDesignImpl>) { return toResult(() => deleteDesignImpl(...a)); }
export async function saveToLibrary(...a: Parameters<typeof saveToLibraryImpl>) { return toResult(() => saveToLibraryImpl(...a)); }
export async function prepareDesignPost(...a: Parameters<typeof prepareDesignPostImpl>) { return toResult(() => prepareDesignPostImpl(...a)); }
