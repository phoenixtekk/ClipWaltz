import "server-only";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { and, desc, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { aiAssist, composeForNetwork } from "@/lib/social/ai";
import { hashtagMax, normalizeHashtags, withHashtags } from "@/lib/social/hashtags";
import { trimToLimit } from "@/lib/social/post-limits";
import { limitsFor } from "@/lib/social/network-capabilities";
import { readMedia, socialMediaKey, writeMedia } from "@/lib/social/media";
import { deleteObject } from "@/lib/storage";
import { exportPrefill, renderPrefill } from "@/lib/social/ui";
import { fileStem, loadDesign, renderDesign, validFormat, isDesignKind } from "@/lib/image-ad/designs";
import { imageFormat } from "../../../worker/image/presets.mjs";
import { roleAtLeast, type WorkspaceRole } from "@/lib/workspace";
import { KIT_NETWORKS, KIT_WRITING_STALE_MS, defaultNetworks, kitNetwork, networksFor, type KitAsset, type KitItem, type KitListItem, type KitSource, type KitStart, type KitView, type MediaShape } from "./types";
export type { KitStart };

// Post kits server side. A kit is made in two steps: createKit stores the row (status "writing") and returns at once;
// buildKit — run after the response — makes the pictures for each network's size, then writes each network's caption
// on the AI Box, saving after every network so the page can show progress. Nothing here posts anywhere.

export type KitRow = typeof schema.postKits.$inferSelect;
const ID = /^[a-f0-9-]{36}$/i;
const MAX_UPLOADS = 10;

export class KitInputError extends Error {}

const safeName = (s: string) => s.replace(/[^\w.\- ]+/g, "_").trim().slice(0, 60) || "clipwaltz";

// ── Starting point for /publish/kits/new ─────────────────────────────────────

function start(source: KitSource, shape: MediaShape, aspect: string | null, brief: string, link: string | null, title: string, problem: string | null = null): KitStart {
  return {
    source, shape, aspect, brief, link, title, problem,
    allowed: networksFor(shape).map((n) => n.id),
    suggested: defaultNetworks(shape, aspect).filter((id) => networksFor(shape).some((n) => n.id === id)),
  };
}

/** Design text as a starting brief (same fields the composer prefill uses). */
function designBrief(data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>;
  const slides = Array.isArray(d.slides) ? (d.slides as { headline?: string; body?: string }[]) : null;
  const parts = slides
    ? slides.flatMap((s) => [s.headline, s.body])
    : [d.headline, d.subhead, d.cta, d.caption, [d.top, d.bottom].filter(Boolean).join(" ")];
  return parts.map((p) => String(p ?? "").trim()).filter(Boolean).join("\n").slice(0, 4000);
}

export async function kitStart(userId: string, workspaceId: string, q: { render?: string | null; export?: string | null; design?: string | null }): Promise<KitStart> {
  if (q.render) {
    const p = await renderPrefill(userId, workspaceId, q.render);
    if (!p?.video) return start({ kind: "none" }, "none", null, "", null, "", "That video isn't finished, was deleted, or is in a project you can't open.");
    return start({ kind: "render", id: p.video.id, title: p.video.projectTitle, aspect: p.video.aspect, filename: p.video.filename }, "video", p.video.aspect, p.text, p.link, p.video.projectTitle);
  }
  if (q.export) {
    const p = await exportPrefill(userId, workspaceId, q.export);
    if (!p?.video) return start({ kind: "none" }, "none", null, "", null, "", "That export isn't finished, was deleted, or is in a project you can't open.");
    return start({ kind: "export", id: p.video.id, title: p.video.projectTitle, aspect: p.video.aspect, filename: p.video.filename }, "video", p.video.aspect, p.text, null, p.video.projectTitle);
  }
  if (q.design) {
    const d = await loadDesign(userId, q.design, "viewer");
    if (!d) return start({ kind: "none" }, "none", null, "", null, "", "That design was deleted or is in a workspace you can't open.");
    if (d.row.workspaceId !== workspaceId) return start({ kind: "none" }, "none", null, "", null, "", "That design belongs to another workspace. Switch to it in the top bar first.");
    const kind = isDesignKind(d.row.kind) ? d.row.kind : "image";
    return start({ kind: "design", id: d.row.id, title: d.row.title, designKind: kind, format: validFormat(kind, d.row.format) }, "image", null, designBrief(d.row.data), null, d.row.title);
  }
  return start({ kind: "none" }, "none", null, "", null, "");
}

// ── Create ────────────────────────────────────────────────────────────────────

export interface CreateKitInput {
  title: string;
  brief: string;
  link: string | null;
  networks: string[];
  render?: string | null;
  export?: string | null;
  design?: string | null;
  /** Uploaded images / one video (social_media ids from /api/social/media) when there is no other source. */
  mediaIds?: string[];
}

export async function createKit(userId: string, workspaceId: string, input: CreateKitInput): Promise<string> {
  const title = String(input.title ?? "").trim().slice(0, 120);
  const brief = String(input.brief ?? "").trim().slice(0, 4000);
  let link = String(input.link ?? "").trim().slice(0, 2000) || null;
  if (link && !/^https?:\/\//i.test(link)) throw new KitInputError("The link must start with http:// or https://.");

  let source: KitSource = { kind: "none" };
  let shape: MediaShape = "none";
  if (input.render || input.export || input.design) {
    const s = await kitStart(userId, workspaceId, { render: input.render, export: input.export, design: input.design });
    if (s.problem) throw new KitInputError(s.problem);
    source = s.source;
    shape = s.shape;
    if (!link && s.link) link = s.link;
  } else if (input.mediaIds?.length) {
    const ids = [...new Set(input.mediaIds.filter((x) => ID.test(x)))].slice(0, MAX_UPLOADS);
    const rows = await db.select().from(schema.socialMedia)
      .where(and(eq(schema.socialMedia.workspaceId, workspaceId), inArray(schema.socialMedia.id, ids), isNull(schema.socialMedia.postId)));
    const ordered = ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r && (r.kind === "image" || r.kind === "video"));
    const videos = ordered.filter((r) => r.kind === "video");
    const images = ordered.filter((r) => r.kind === "image");
    if (!ordered.length) throw new KitInputError("Those uploads were not found. Upload them again.");
    if (videos.length && (videos.length > 1 || images.length)) throw new KitInputError("Add one video, or up to 10 images — not both.");
    source = { kind: "upload", mediaIds: ordered.map((r) => r.id) };
    shape = videos.length ? "video" : "image";
  }

  if (!brief && source.kind === "none") throw new KitInputError("Write a line about what the post should say.");
  const allowed = new Set(networksFor(shape).map((n) => n.id));
  const networks = KIT_NETWORKS.map((n) => n.id).filter((id) => input.networks.includes(id) && allowed.has(id));
  if (!networks.length) throw new KitInputError("Pick at least one network.");

  const id = randomUUID();
  await db.insert(schema.postKits).values({
    id, workspaceId, createdBy: userId,
    title: title || (source.kind === "render" || source.kind === "export" || source.kind === "design" ? source.title : "") || brief.split("\n")[0].slice(0, 120),
    brief, link, source, networks: networks.join(","), items: [], assets: [], status: "writing",
  });
  return id;
}

// ── Build (runs after the response) ──────────────────────────────────────────

async function storeImage(workspaceId: string, userId: string | null, png: Uint8Array, mime: string, filename: string, source: "ai" | "upload"): Promise<string> {
  const mediaId = randomUUID();
  const key = await writeMedia(workspaceId, mediaId, png, mime);
  await db.insert(schema.socialMedia).values({
    id: mediaId, workspaceId, createdBy: userId, postId: null, kind: "image", filename, mime, size: png.byteLength, storageKey: key, source,
  });
  return mediaId;
}

/** Pictures for every size the kit's networks need. Returns the assets and each network's format. */
async function makeAssets(row: KitRow, networks: string[]): Promise<{ assets: KitAsset[]; formatOf: Record<string, string | null> }> {
  const assets: KitAsset[] = [];
  try {
    return await makeAssetsInto(row, networks, assets);
  } catch (e) {
    // Don't leave pictures behind that no kit lists (a retry makes them all again). Uploaded originals are kept.
    for (const a of assets.filter((x) => x.format !== "original")) {
      await db.delete(schema.socialMedia).where(and(eq(schema.socialMedia.id, a.mediaId), isNull(schema.socialMedia.postId))).catch(() => {});
      await deleteObjectOf(row.workspaceId, a.mediaId);
    }
    throw e;
  }
}

async function deleteObjectOf(workspaceId: string, mediaId: string) {
  await deleteObject(socialMediaKey(workspaceId, mediaId)).catch(() => {});
}

async function makeAssetsInto(row: KitRow, networks: string[], assets: KitAsset[]): Promise<{ assets: KitAsset[]; formatOf: Record<string, string | null> }> {
  const src = row.source as KitSource;
  const formatOf: Record<string, string | null> = Object.fromEntries(networks.map((n) => [n, null]));

  if (src.kind === "design") {
    const [d] = await db.select().from(schema.imageDesigns).where(and(eq(schema.imageDesigns.id, src.id), eq(schema.imageDesigns.workspaceId, row.workspaceId)));
    if (!d) throw new Error("The design was deleted before its pictures were made.");
    const kind = isDesignKind(d.kind) ? d.kind : "image";
    const stem = fileStem(d);
    // Redraw the design at each network's size: text and logo are laid out again, so nothing is cropped off.
    const byFormat = new Map<string, string[]>();
    for (const n of networks) {
      const net = kitNetwork(n);
      if (!net?.takesImage) continue;
      const f = validFormat(kind, net.imageFormat);
      formatOf[n] = f;
      byFormat.set(f, [...(byFormat.get(f) ?? []), n]);
    }
    for (const f of byFormat.keys()) {
      const outs = await renderDesign({ ...d, format: f });
      for (const o of outs) {
        const filename = `${stem}-${f.replace(":", "x")}${outs.length > 1 ? `-${o.index + 1}` : ""}.png`;
        const mediaId = await storeImage(row.workspaceId, row.createdBy, o.png, "image/png", filename, o.usesAi ? "ai" : "upload");
        assets.push({ format: f, index: o.index, mediaId, kind: "image", width: o.width, height: o.height, filename });
      }
    }
  } else if (src.kind === "upload") {
    const rows = await db.select().from(schema.socialMedia)
      .where(and(eq(schema.socialMedia.workspaceId, row.workspaceId), inArray(schema.socialMedia.id, src.mediaIds)));
    const ordered = src.mediaIds.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r);
    ordered.forEach((r, i) => assets.push({ format: "original", index: i, mediaId: r.id, kind: r.kind === "video" ? "video" : "image", width: null, height: null, filename: r.filename }));
    const images = ordered.filter((r) => r.kind === "image");
    if (images.length) {
      const formats = new Set<string>();
      for (const n of networks) {
        const net = kitNetwork(n);
        if (net?.takesImage) { formatOf[n] = net.imageFormat; formats.add(net.imageFormat); }
      }
      for (const f of formats) {
        const fmt = imageFormat(f);
        for (let i = 0; i < images.length; i++) {
          const bytes = await readMedia(images[i].id, row.workspaceId);
          // Cover-crop to the network's size, keeping the most interesting part of the photo (sharp's attention strategy).
          const out = await sharp(bytes).rotate().resize(fmt.width, fmt.height, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
          const filename = `${safeName(images[i].filename.replace(/\.[^.]+$/, ""))}-${f.replace(":", "x")}.jpg`;
          const mediaId = await storeImage(row.workspaceId, row.createdBy, out, "image/jpeg", filename, "upload");
          assets.push({ format: f, index: i, mediaId, kind: "image", width: fmt.width, height: fmt.height, filename });
        }
      }
    }
  }
  return { assets, formatOf };
}

function imageCount(assets: KitAsset[], format: string | null): number {
  return format ? assets.filter((a) => a.format === format).length : 0;
}

function notesFor(provider: string, count: number): string[] {
  const max = limitsFor(provider).image?.max;
  const name = kitNetwork(provider)?.label ?? provider;
  if (max && count > max) return [`${name} takes ${max === 1 ? "one image" : `up to ${max} images`} per post. Use the first ${max === 1 ? "one" : max}, or split them over several posts.`];
  return [];
}

/** A title for networks that have one: the kit's title, else the caption's first line without hashtags. */
function titleFor(kitTitle: string, caption: string, max: number | null): string {
  if (!max) return "";
  const first = caption.split("\n").map((l) => l.replace(/#\w+/g, "").trim()).find(Boolean) ?? "";
  return (kitTitle.trim() || first).slice(0, max);
}

async function writeCaption(brief: string, provider: string, rawTags: string): Promise<{ caption: string; hashtags: string[] }> {
  const net = kitNetwork(provider);
  const limit = net?.captionMax ?? undefined;
  const caption = await composeForNetwork({
    seed: brief,
    networkLabel: net?.label ?? provider,
    // Leave room for the tags on short networks (same allowance the composer's "Write for each network" uses).
    limit: limit ? Math.max(80, limit - (hashtagMax(provider) ? Math.min(60, Math.round(limit * 0.2)) : 0)) : undefined,
  });
  const tags = normalizeHashtags(rawTags, hashtagMax(provider));
  const text = trimToLimit(withHashtags(caption, tags, limit), limit);
  return { caption: text, hashtags: tags.filter((g) => text.includes(g)) };
}

function seedOf(row: KitRow): string {
  const src = row.source as KitSource;
  const what = src.kind === "render" || src.kind === "export" ? "a video" : src.kind === "design" || src.kind === "upload" ? "an image post" : "a text post";
  return [row.brief || row.title, row.link ? `Link to include: ${row.link}` : "", `(This is ${what}.)`].filter(Boolean).join("\n\n");
}

async function saveRow(id: string, patch: Partial<typeof schema.postKits.$inferInsert>) {
  await db.update(schema.postKits).set({ ...patch, updatedAt: new Date() }).where(eq(schema.postKits.id, id));
}

/**
 * Change the kit's items under a row lock, so the background build and the person's own edits (caption, Posted) never
 * write over each other: each side reads the CURRENT items inside the lock and changes only its own fields.
 */
async function lockedItems(id: string, change: (items: KitItem[]) => KitItem[], extra: Partial<typeof schema.postKits.$inferInsert> = {}): Promise<KitItem[] | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.postKits).where(eq(schema.postKits.id, id)).for("update");
    if (!row) return null;
    const items = change(((row.items as KitItem[]) ?? []).map((i) => ({ ...i })));
    await tx.update(schema.postKits).set({ ...extra, items, updatedAt: new Date() }).where(eq(schema.postKits.id, id));
    return items;
  });
}

/** Make the pictures and write every caption. Never throws: failures land on the row as status "failed". */
export async function buildKit(id: string, opts: { only?: string } = {}): Promise<void> {
  const [row] = await db.select().from(schema.postKits).where(eq(schema.postKits.id, id));
  if (!row) return;
  const networks = row.networks.split(",").filter(Boolean);
  try {
    if (!((row.assets as KitAsset[]) ?? []).length) {
      const made = await makeAssets(row, networks);
      await lockedItems(id, (items) => networks.map((p) => {
        const cur = items.find((i) => i.provider === p);
        const notes = notesFor(p, imageCount(made.assets, made.formatOf[p]));
        return cur ? { ...cur, format: made.formatOf[p], notes } : {
          provider: p, format: made.formatOf[p], title: "", caption: "", hashtags: [], notes, postedAt: null, postedUrl: null,
        };
      }), { assets: made.assets });
    }

    const seed = seedOf(row);
    const rawTags = await aiAssist("hashtags", seed, "standard").catch(() => "");
    for (const p of opts.only ? [opts.only] : networks) {
      const c = await writeCaption(seed, p, rawTags);
      const net = kitNetwork(p);
      // Only the AI's own fields: a Posted tick or link made meanwhile is kept.
      await lockedItems(id, (items) => items.map((i) => (i.provider === p ? { ...i, caption: c.caption, hashtags: c.hashtags, title: titleFor(row.title, c.caption, net?.titleMax ?? null) } : i)));
    }
    await saveRow(id, { status: "ready", error: null });
  } catch (e) {
    console.error(`[kits] build ${id} failed:`, e);
    const msg = (e as Error).message || "Something went wrong.";
    await saveRow(id, {
      status: "failed",
      error: /fetch failed|AI box|aborted|timeout/i.test(msg) ? "The AI Box didn't answer, so some captions are missing. Press Write again in a minute." : msg.slice(0, 300),
    }).catch(() => {});
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

function sourceLabel(src: KitSource): string {
  switch (src.kind) {
    case "render": return `Video · ${src.title}`;
    case "export": return `Export · ${src.title}`;
    case "design": return `${src.designKind === "carousel" ? "Carousel" : src.designKind === "meme" ? "Meme" : "Image"} · ${src.title}`;
    case "upload": return "Your uploads";
    default: return "Text only";
  }
}

export async function listKits(workspaceId: string): Promise<KitListItem[]> {
  const rows = await db.select().from(schema.postKits).where(eq(schema.postKits.workspaceId, workspaceId)).orderBy(desc(schema.postKits.createdAt)).limit(200);
  return rows.map((r) => {
    const items = (r.items as KitItem[]) ?? [];
    const assets = (r.assets as KitAsset[]) ?? [];
    return {
      id: r.id, title: r.title || "Untitled kit", sourceLabel: sourceLabel(r.source as KitSource), networks: r.networks.split(",").filter(Boolean),
      posted: items.filter((i) => i.postedAt).length,
      status: r.status === "writing" && Date.now() - r.updatedAt.getTime() > KIT_WRITING_STALE_MS ? "failed" : r.status,
      thumbMediaId: assets.find((a) => a.kind === "image" && a.format !== "original")?.mediaId ?? assets.find((a) => a.kind === "image")?.mediaId ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function getKitRow(workspaceId: string, id: string): Promise<KitRow | null> {
  if (!ID.test(id)) return null;
  const [r] = await db.select().from(schema.postKits).where(and(eq(schema.postKits.id, id), eq(schema.postKits.workspaceId, workspaceId)));
  return r ?? null;
}

export function videoOf(row: KitRow): { url: string; name: string } | null {
  const src = row.source as KitSource;
  if (src.kind === "render") return { url: `/api/renders/${src.id}/download`, name: src.filename };
  if (src.kind === "export") return { url: `/api/exports/${src.id}/download`, name: src.filename };
  if (src.kind === "upload") {
    const v = ((row.assets as KitAsset[]) ?? []).find((a) => a.kind === "video");
    if (v) return { url: `/api/kits/${row.id}/file/${v.mediaId}?download=1`, name: v.filename };
  }
  return null;
}

export function kitView(row: KitRow, role: WorkspaceRole): KitView {
  const v = videoOf(row);
  return {
    id: row.id, title: row.title, brief: row.brief, link: row.link, source: row.source as KitSource,
    videoUrl: v?.url ?? null, videoName: v?.name ?? null,
    items: (row.items as KitItem[]) ?? [], assets: (row.assets as KitAsset[]) ?? [],
    status: row.status, error: row.error, canEdit: roleAtLeast(role, "editor"), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Change ────────────────────────────────────────────────────────────────────

export interface ItemPatch {
  title?: string;
  caption?: string;
  posted?: boolean;
  postedUrl?: string | null;
}

export async function updateKitItem(workspaceId: string, id: string, provider: string, patch: ItemPatch): Promise<KitItem> {
  const row = await getKitRow(workspaceId, id);
  if (!row) throw new KitInputError("Kit not found.");
  const net = kitNetwork(provider);
  let postedUrl: string | null | undefined;
  if (patch.postedUrl !== undefined) {
    postedUrl = String(patch.postedUrl ?? "").trim().slice(0, 2000) || null;
    if (postedUrl && !/^https?:\/\//i.test(postedUrl)) throw new KitInputError("The post link must start with http:// or https://.");
  }
  let out: KitItem | null = null;
  await lockedItems(id, (items) => items.map((cur) => {
    if (cur.provider !== provider) return cur;
    const next: KitItem = { ...cur };
    if (patch.title !== undefined) next.title = String(patch.title).slice(0, net?.titleMax ?? 300);
    if (patch.caption !== undefined) next.caption = String(patch.caption).slice(0, 100_000);
    if (postedUrl !== undefined) next.postedUrl = postedUrl;
    if (patch.posted !== undefined) next.postedAt = patch.posted ? (cur.postedAt ?? new Date().toISOString()) : null;
    if (next.postedUrl && !next.postedAt) next.postedAt = new Date().toISOString();
    out = next;
    return next;
  }));
  if (!out) throw new KitInputError("That network isn't in this kit.");
  return out;
}

/** Claim the kit for a new build. Atomic: two clicks (or two tabs) can't start two builds. Stale after 5 minutes. */
export async function markWriting(workspaceId: string, id: string): Promise<void> {
  const r = await db.update(schema.postKits).set({ status: "writing", error: null, updatedAt: new Date() })
    .where(and(eq(schema.postKits.id, id), eq(schema.postKits.workspaceId, workspaceId),
      or(ne(schema.postKits.status, "writing"), lt(schema.postKits.updatedAt, new Date(Date.now() - KIT_WRITING_STALE_MS)))))
    .returning({ id: schema.postKits.id });
  if (r.length) return;
  if (!(await getKitRow(workspaceId, id))) throw new KitInputError("Kit not found.");
  throw new KitInputError("Captions are already being written.");
}

export async function deleteKit(workspaceId: string, id: string): Promise<void> {
  const row = await getKitRow(workspaceId, id);
  if (!row) return;
  const src = row.source as KitSource;
  // The kit's pictures go with it. Uploaded originals go too, unless something else (a post) took them meanwhile.
  const ids = [...new Set(((row.assets as KitAsset[]) ?? []).map((a) => a.mediaId).concat(src.kind === "upload" ? src.mediaIds : []))];
  if (ids.length) {
    const free = await db.select({ id: schema.socialMedia.id }).from(schema.socialMedia)
      .where(and(eq(schema.socialMedia.workspaceId, workspaceId), inArray(schema.socialMedia.id, ids), isNull(schema.socialMedia.postId)));
    for (const m of free) {
      // Row first: if something still references it (a podcast episode's audio is `restrict`), the file stays too.
      const ok = await db.delete(schema.socialMedia).where(and(eq(schema.socialMedia.id, m.id), isNull(schema.socialMedia.postId))).then(() => true, () => false);
      if (ok) await deleteObjectOf(workspaceId, m.id);
    }
  }
  await db.delete(schema.postKits).where(eq(schema.postKits.id, id));
}
