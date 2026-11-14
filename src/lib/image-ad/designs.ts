import "server-only";
import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getObjectBytes } from "@/lib/storage";
import { getCreditBalance } from "@/lib/credits-server";
import { BRAND_FONTS } from "@/lib/brand";
import { getWorkspaceRole, roleAtLeast, type WorkspaceRole } from "@/lib/workspace";
import {
  AD_LAYOUTS, CAROUSEL_FORMATS, CAROUSEL_MAX, CAROUSEL_MIN, IMAGE_FORMATS, IMAGE_STYLES, MEME_LAYOUTS, TEXT_LIMITS, imageFormat,
  type ImageFormatKey,
} from "../../../worker/image/presets.mjs";
import { composeImage, resolveFont, type ComposeSpec } from "../../../worker/image/compose.mjs";
import type {
  CarouselData, CarouselSlide, DesignBrand, DesignData, DesignImageView, DesignKind, DesignListItem, DesignView, ImageAdData, MemeData,
} from "./types";

// Waltz Image server side: access, normalisation, brand kit, rendering and the editor's read model. Every function
// that takes a design id checks the caller's role in the design's workspace (viewer to see, editor to change).

export type DesignRow = typeof schema.imageDesigns.$inferSelect;
const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-f0-9-]{36}$/i;

const clip = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, max);
const oneOf = <T extends string>(v: unknown, keys: readonly T[], dflt: T): T => (keys.includes(v as T) ? (v as T) : dflt);
const idOrNull = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);

export function defaultData(kind: DesignKind): DesignData {
  if (kind === "carousel") {
    return {
      brief: "", style: "photographic", cta: "Learn more", useBrand: true,
      slides: [
        { id: randomUUID(), imageId: null, headline: "Your hook goes here", body: "Swipe to see why →" },
        { id: randomUUID(), imageId: null, headline: "Point one", body: "One idea per slide reads best." },
        { id: randomUUID(), imageId: null, headline: "Ready to try it?", body: "" },
      ],
    } satisfies CarouselData;
  }
  if (kind === "meme") {
    return { layout: "top-bottom", top: "", bottom: "", caption: "", imageId: null, brief: "", style: "photographic" } satisfies MemeData;
  }
  return { brief: "", style: "photographic", layout: "ad-left", headline: "", subhead: "", cta: "", useBrand: true, imageId: null } satisfies ImageAdData;
}

/** Coerce stored or client-sent data to a valid shape for the kind (unknown keys dropped, text capped). */
export function normalizeData(kind: DesignKind, raw: unknown): DesignData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const styles = IMAGE_STYLES.map((s) => s.key);
  if (kind === "carousel") {
    const slidesRaw = Array.isArray(r.slides) ? r.slides : [];
    const seen = new Set<string>();
    const slides: CarouselSlide[] = [];
    for (const s of slidesRaw.slice(0, CAROUSEL_MAX)) {
      const o = (s ?? {}) as Record<string, unknown>;
      let id = idOrNull(o.id) ?? randomUUID();
      if (seen.has(id)) id = randomUUID();
      seen.add(id);
      slides.push({ id, imageId: idOrNull(o.imageId), headline: clip(o.headline, TEXT_LIMITS.headline), body: clip(o.body, TEXT_LIMITS.body) });
    }
    return {
      brief: clip(r.brief, TEXT_LIMITS.prompt),
      style: oneOf(r.style, styles, "photographic"),
      cta: clip(r.cta, TEXT_LIMITS.cta),
      useBrand: r.useBrand !== false,
      slides: slides.length ? slides : (defaultData("carousel") as CarouselData).slides,
    };
  }
  if (kind === "meme") {
    return {
      layout: oneOf(r.layout, MEME_LAYOUTS.map((m) => m.key), "top-bottom"),
      top: clip(r.top, TEXT_LIMITS.top),
      bottom: clip(r.bottom, TEXT_LIMITS.bottom),
      caption: clip(r.caption, TEXT_LIMITS.caption),
      imageId: idOrNull(r.imageId),
      brief: clip(r.brief, TEXT_LIMITS.prompt),
      style: oneOf(r.style, styles, "photographic"),
    };
  }
  return {
    brief: clip(r.brief, TEXT_LIMITS.prompt),
    style: oneOf(r.style, styles, "photographic"),
    layout: oneOf(r.layout, AD_LAYOUTS.map((a) => a.key), "ad-left"),
    headline: clip(r.headline, TEXT_LIMITS.headline),
    subhead: clip(r.subhead, TEXT_LIMITS.subhead),
    cta: clip(r.cta, TEXT_LIMITS.cta),
    useBrand: r.useBrand !== false,
    imageId: idOrNull(r.imageId),
  };
}

export function validFormat(kind: DesignKind, format: unknown): ImageFormatKey {
  const keys = (kind === "carousel" ? CAROUSEL_FORMATS : IMAGE_FORMATS.map((f) => f.key)) as ImageFormatKey[];
  return keys.includes(format as ImageFormatKey) ? (format as ImageFormatKey) : keys[0];
}

export const isDesignKind = (k: unknown): k is DesignKind => k === "image" || k === "carousel" || k === "meme";

/** The design, if the user holds at least `min` in its workspace. */
export async function loadDesign(userId: string, id: string, min: WorkspaceRole): Promise<{ row: DesignRow; role: WorkspaceRole } | null> {
  if (!ID.test(id)) return null;
  const [row] = await db.select().from(schema.imageDesigns).where(eq(schema.imageDesigns.id, id));
  if (!row) return null;
  const role = await getWorkspaceRole(userId, row.workspaceId);
  if (!role || !roleAtLeast(role, min)) return null;
  return { row, role };
}

export async function listDesigns(workspaceId: string): Promise<DesignListItem[]> {
  const rows = await db.select().from(schema.imageDesigns).where(eq(schema.imageDesigns.workspaceId, workspaceId))
    .orderBy(desc(schema.imageDesigns.updatedAt)).limit(100);
  return rows.map((r) => {
    const kind = (isDesignKind(r.kind) ? r.kind : "image") as DesignKind;
    return { id: r.id, kind, title: r.title, format: r.format, updatedAt: r.updatedAt.toISOString(), outputs: outputCount(kind, normalizeData(kind, r.data)) };
  });
}

export function outputCount(kind: DesignKind, data: DesignData): number {
  return kind === "carousel" ? (data as CarouselData).slides.length : 1;
}

// ─── Brand ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const DEFAULT_BRAND = { primary: "#8b5cf6", secondary: "#120a24", headingFont: "Montserrat", bodyFont: "Inter" };

export async function workspaceBrand(workspaceId: string): Promise<DesignBrand & { logoKey: string | null }> {
  const [k] = await db.select().from(schema.brandKits).where(eq(schema.brandKits.workspaceId, workspaceId)).limit(1);
  const colors = Array.isArray(k?.colorsJson) ? (k!.colorsJson as string[]) : [];
  const fonts = (k?.fontsJson ?? {}) as { heading?: string; body?: string };
  const headingFont = BRAND_FONTS.includes(fonts.heading as never) ? fonts.heading! : DEFAULT_BRAND.headingFont;
  const bodyFont = BRAND_FONTS.includes(fonts.body as never) ? fonts.body! : DEFAULT_BRAND.bodyFont;
  const missingFonts = [...new Set([headingFont, bodyFont])].filter((f) => resolveFont(f).substituted);
  return {
    primary: HEX.test(colors[0] ?? "") ? colors[0] : DEFAULT_BRAND.primary,
    secondary: HEX.test(colors[1] ?? "") ? colors[1] : DEFAULT_BRAND.secondary,
    headingFont,
    bodyFont,
    hasLogo: !!k?.logoKey,
    fromKit: !!k,
    missingFonts,
    logoKey: k?.logoKey ?? null,
  };
}

// ─── Pictures ────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function designImages(designId: string): Promise<DesignImageView[]> {
  const rows = await db
    .select({
      id: schema.imageDesignImages.id,
      source: schema.imageDesignImages.source,
      storageKey: schema.imageDesignImages.storageKey,
      width: schema.imageDesignImages.width,
      height: schema.imageDesignImages.height,
      jobStatus: schema.generationJobs.status,
      jobError: schema.generationJobs.errorMessage,
    })
    .from(schema.imageDesignImages)
    .leftJoin(schema.generationJobs, eq(schema.imageDesignImages.generationJobId, schema.generationJobs.id))
    .where(eq(schema.imageDesignImages.designId, designId))
    .orderBy(schema.imageDesignImages.createdAt);
  return rows.map((r) => {
    const failed = !r.storageKey && (r.jobStatus === "failed" || r.jobStatus === "cancelled" || r.jobStatus === "retried" || (r.source === "ai" && !r.jobStatus));
    const status: DesignImageView["status"] = r.storageKey ? "ready" : failed ? "failed" : "pending";
    return {
      id: r.id,
      source: r.source === "upload" ? "upload" : "ai",
      status,
      error: status === "failed" ? friendlyImageError(r.jobError) : null,
      url: r.storageKey ? `/api/images/${designId}/picture/${r.id}` : null,
      width: r.width,
      height: r.height,
    };
  });
}

function friendlyImageError(msg: string | null): string {
  if (!msg) return "The picture couldn't be made. Your credits were refunded.";
  if (/AI queue/i.test(msg)) return "Couldn't reach the AI queue. Your credits were refunded.";
  return `${msg.slice(0, 160)} Your credits were refunded.`;
}

/** Bytes of a design's ready picture (scoped to the design), or null. */
export async function pictureBytes(designId: string, imageId: string | null): Promise<Uint8Array | null> {
  if (!imageId || !ID.test(imageId)) return null;
  const [r] = await db.select({ key: schema.imageDesignImages.storageKey }).from(schema.imageDesignImages)
    .where(and(eq(schema.imageDesignImages.id, imageId), eq(schema.imageDesignImages.designId, designId)));
  if (!r?.key) return null;
  return getObjectBytes(r.key).catch(() => null);
}

export async function pictureKey(designId: string, imageId: string): Promise<string | null> {
  if (!ID.test(imageId)) return null;
  const [r] = await db.select({ key: schema.imageDesignImages.storageKey }).from(schema.imageDesignImages)
    .where(and(eq(schema.imageDesignImages.id, imageId), eq(schema.imageDesignImages.designId, designId)));
  return r?.key ?? null;
}

/** Image ids that belong to the design (used to reject client-sent ids from elsewhere). */
export async function designImageIds(designId: string): Promise<Set<string>> {
  const rows = await db.select({ id: schema.imageDesignImages.id }).from(schema.imageDesignImages).where(eq(schema.imageDesignImages.designId, designId));
  return new Set(rows.map((r) => r.id));
}

/** Drop picture references the design doesn't own. */
export function scrubImageRefs(kind: DesignKind, data: DesignData, owned: Set<string>): DesignData {
  const ok = (id: string | null) => (id && owned.has(id) ? id : null);
  if (kind === "carousel") {
    const c = data as CarouselData;
    return { ...c, slides: c.slides.map((s) => ({ ...s, imageId: ok(s.imageId) })) };
  }
  const d = data as ImageAdData | MemeData;
  return { ...d, imageId: ok(d.imageId) };
}

// ─── Rendering ───────────────────────────────────────────────────────────────────────────────────────────────────────
export type RenderedOutput = { png: Buffer; width: number; height: number; index: number; usesAi: boolean };

/**
 * Composite every output of a design (one image, or one per slide) at the format's exact size. No GPU work: the
 * pictures were made earlier; this only draws text, brand colours and the logo over them.
 */
export async function renderDesign(row: DesignRow, only?: number): Promise<RenderedOutput[]> {
  const kind = (isDesignKind(row.kind) ? row.kind : "image") as DesignKind;
  const data = normalizeData(kind, row.data);
  const fmt = imageFormat(validFormat(kind, row.format));
  const kit = await workspaceBrand(row.workspaceId);
  const useBrand = kind === "meme" ? true : (data as ImageAdData | CarouselData).useBrand;
  const brand = useBrand
    ? { primary: kit.primary, secondary: kit.secondary, headingFont: kit.headingFont, bodyFont: kit.bodyFont }
    : DEFAULT_BRAND;
  const logo = useBrand && kind !== "meme" && kit.logoKey ? await getObjectBytes(kit.logoKey).catch(() => null) : null;
  const images = await db.select({ id: schema.imageDesignImages.id, source: schema.imageDesignImages.source })
    .from(schema.imageDesignImages).where(eq(schema.imageDesignImages.designId, row.id));
  const isAi = (id: string | null) => !!id && images.some((i) => i.id === id && i.source === "ai");

  const specs: { spec: ComposeSpec; usesAi: boolean }[] = [];
  if (kind === "carousel") {
    const c = data as CarouselData;
    const n = c.slides.length;
    c.slides.forEach((s, i) => {
      const role = i === 0 ? "hook" : i === n - 1 && c.cta.trim() && n >= CAROUSEL_MIN ? "cta" : "value";
      specs.push({
        usesAi: isAi(s.imageId),
        spec: {
          width: fmt.width, height: fmt.height, layout: "slide", brand, logo,
          text: { headline: s.headline, body: s.body, cta: role === "cta" ? c.cta : "" },
          slide: { index: i, count: n, role },
        },
      });
    });
  } else if (kind === "meme") {
    const m = data as MemeData;
    specs.push({ usesAi: isAi(m.imageId), spec: { width: fmt.width, height: fmt.height, layout: `meme-${m.layout}` as ComposeSpec["layout"], brand, text: { top: m.top, bottom: m.bottom, caption: m.caption } } });
  } else {
    const a = data as ImageAdData;
    specs.push({ usesAi: isAi(a.imageId), spec: { width: fmt.width, height: fmt.height, layout: a.layout, brand, logo: a.layout === "none" ? null : logo, text: { headline: a.headline, subhead: a.subhead, cta: a.cta } } });
  }

  const pictureOf = (i: number) =>
    kind === "carousel" ? (data as CarouselData).slides[i].imageId : (data as ImageAdData | MemeData).imageId;
  const out: RenderedOutput[] = [];
  for (let i = 0; i < specs.length; i++) {
    if (only != null && i !== only) continue;
    const background = await pictureBytes(row.id, pictureOf(i));
    const r = await composeImage({ ...specs[i].spec, background });
    out.push({ png: r.png, width: r.width, height: r.height, index: i, usesAi: specs[i].usesAi });
  }
  return out;
}

export async function designView(userId: string, row: DesignRow, role: WorkspaceRole): Promise<DesignView> {
  const kind = (isDesignKind(row.kind) ? row.kind : "image") as DesignKind;
  const data = normalizeData(kind, row.data);
  const kit = await workspaceBrand(row.workspaceId);
  const brand: DesignBrand = {
    primary: kit.primary, secondary: kit.secondary, headingFont: kit.headingFont, bodyFont: kit.bodyFont,
    hasLogo: kit.hasLogo, fromKit: kit.fromKit, missingFonts: kit.missingFonts,
  };
  return {
    id: row.id,
    kind,
    title: row.title,
    format: validFormat(kind, row.format),
    data,
    images: await designImages(row.id),
    brand,
    credits: await getCreditBalance(userId),
    canEdit: roleAtLeast(role, "editor"),
    updatedAt: row.updatedAt.toISOString(),
    outputs: outputCount(kind, data),
  };
}

/** Safe file name stem for downloads. */
export function fileStem(row: DesignRow): string {
  return (row.title || `clipwaltz-${row.kind}`).replace(/[^\w.\- ]+/g, "_").trim().slice(0, 60) || "clipwaltz-image";
}

