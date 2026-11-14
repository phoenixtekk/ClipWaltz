"use server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { toResult } from "@/lib/action-result";
import { activeWorkspaceId } from "@/lib/active-workspace";
import { requireUserId } from "@/lib/auth";
import { IMAGE_COST } from "@/lib/credits";
import { defaultBrief } from "@/lib/deck/types";
import { createImageJob } from "@/lib/image-ad/jobs";
import type { ImageAdData } from "@/lib/image-ad/types";
import { putObject } from "@/lib/storage";
import { getWorkspaceRole, roleAtLeast } from "@/lib/workspace";
import { fetchPublic, readProduct } from "../../worker/deck/importer.mjs";
import { imageSize } from "../../worker/image/compose.mjs";

// G3 product URL → ad / video pack (plan §6 G3). Paste a product page; ClipWaltz reads the product (JSON-LD Product,
// then Open Graph, then the page text — worker/deck/importer.mjs readProduct, fetched through the same SSRF-guarded
// fetchPublic WaltzDeck's URL import uses), stores it in `product_sources`, and makes:
//   • image ads in Waltz Image — one design per chosen size, the product's own photo as the picture (0 credits) or,
//     when the page has no usable photo and the user asks for it, an AI picture (IMAGE_COST each); otherwise a
//     text-led ad on the brand colours, and the result says so;
//   • a WaltzDeck video brief (an "ad" deck project pre-filled with the product and a Shop-now CTA to the page), which
//     the user plans and renders as usual (its own credits, shown there);
//   • post copy comes from the composer's one-click "copy + hashtags for each network" when a design is published (G4).
// The credit total is computed here and must match what the user confirmed.

const PACK_FORMATS = ["1:1", "4:5", "9:16", "1.91:1", "2:3"] as const;
const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

async function editorWorkspace(userId: string): Promise<string> {
  const ws = await activeWorkspaceId(userId);
  if (!roleAtLeast(await getWorkspaceRole(userId, ws), "editor")) throw new Error("Viewers can't create things in this workspace.");
  return ws;
}

export type ProductView = {
  id: string;
  url: string;
  title: string;
  description: string | null;
  price: string | null;
  currency: string | null;
  brand: string | null;
  images: string[];
  source: string;
};

async function readProductImpl(url: string): Promise<ProductView> {
  const userId = await requireUserId();
  const workspaceId = await editorWorkspace(userId);
  const u = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) throw new Error("Paste the product page's address (starting with https://).");
  const page = await fetchPublic(u, { maxBytes: 3 << 20 });
  if (!/html|xml/i.test(page.type)) throw new Error("That address isn't a web page.");
  const p = readProduct(page.bytes.toString("utf8"), page.url);
  if (!p.name) throw new Error("Couldn't find a product name on that page.");
  const id = randomUUID();
  await db.insert(schema.productSources).values({
    id, workspaceId, createdBy: userId, url: page.url, title: p.name, description: p.description || null, price: p.price,
    currency: p.currency, brand: p.brand, images: p.images, source: p.source,
  });
  return { id, url: page.url, title: p.name, description: p.description || null, price: p.price, currency: p.currency, brand: p.brand, images: p.images, source: p.source };
}
/** Read a product page (no credits). */
export async function readProductUrl(url: string) { return toResult(() => readProductImpl(url)); }

/** Download the first product photo that is a real picture (SSRF-guarded, ≤ 15 MB). */
async function productPhoto(images: string[]): Promise<{ bytes: Uint8Array; type: string; ext: string; width: number; height: number } | null> {
  for (const src of images.slice(0, 4)) {
    try {
      const r = await fetchPublic(src, { maxBytes: 15 << 20, accept: "image/png,image/jpeg,image/webp,image/*;q=0.5" });
      const type = (r.type.split(";")[0] || "").trim().toLowerCase();
      const ext = IMAGE_TYPES[type];
      if (!ext) continue;
      const bytes = new Uint8Array(r.bytes);
      const size = await imageSize(bytes);
      if (size.width < 200 || size.height < 200) continue;
      return { bytes, type, ext, width: size.width, height: size.height };
    } catch {
      /* next one */
    }
  }
  return null;
}

export type PackRequest = {
  productId: string;
  formats: string[];
  /** No usable product photo: make an AI picture per design (IMAGE_COST each) instead of a text-led ad. */
  aiPictureIfNone: boolean;
  deck: boolean;
  /** The total the user confirmed; must equal what the server computes. */
  confirmCredits: number;
};

export type PackResult = {
  designs: { id: string; format: string }[];
  projectId: string | null;
  photo: "product" | "ai" | "none";
  credits: number;
  note: string | null;
};

/** What a pack will cost, before confirming (reads the page's photos once). */
async function packQuoteImpl(productId: string, formats: string[], aiPictureIfNone: boolean) {
  const userId = await requireUserId();
  const workspaceId = await editorWorkspace(userId);
  const [p] = await db.select().from(schema.productSources).where(and(eq(schema.productSources.id, productId), eq(schema.productSources.workspaceId, workspaceId)));
  if (!p) throw new Error("That product is not in this workspace.");
  const fmts = PACK_FORMATS.filter((f) => formats.includes(f));
  const photo = await productPhoto(p.images);
  return { hasPhoto: Boolean(photo), credits: !photo && aiPictureIfNone ? fmts.length * IMAGE_COST : 0, formats: fmts.length };
}
export async function quoteProductPack(productId: string, formats: string[], aiPictureIfNone: boolean) {
  return toResult(() => packQuoteImpl(productId, formats, aiPictureIfNone));
}

async function makePackImpl(req: PackRequest): Promise<PackResult> {
  const userId = await requireUserId();
  const workspaceId = await editorWorkspace(userId);
  const [p] = await db
    .select()
    .from(schema.productSources)
    .where(and(eq(schema.productSources.id, req.productId), eq(schema.productSources.workspaceId, workspaceId)));
  if (!p) throw new Error("That product is not in this workspace.");
  const formats = PACK_FORMATS.filter((f) => req.formats.includes(f));
  if (!formats.length && !req.deck) throw new Error("Pick at least one image size or the video brief.");

  const photo = formats.length ? await productPhoto(p.images) : null;
  const useAi = formats.length > 0 && !photo && req.aiPictureIfNone;
  const credits = useAi ? formats.length * IMAGE_COST : 0;
  if (credits !== Number(req.confirmCredits)) throw new Error(`Confirm the total first: ${credits} credits.`);

  const price = p.price ? `${p.currency && !/^[A-Z]{3}$/.test(p.price) ? `${p.currency} ` : ""}${p.price}` : "";
  const headline = p.title.slice(0, 80);
  const subhead = (price || p.brand || "").slice(0, 120);
  const brief = `Product photo of ${p.title}${p.brand ? ` by ${p.brand}` : ""}. ${(p.description ?? "").slice(0, 300)}`.trim();
  const designs: { id: string; format: string }[] = [];
  for (const format of formats) {
    const id = randomUUID();
    const data: ImageAdData = { brief, style: "photographic", layout: "ad-bottom", headline, subhead, cta: "Shop now", useBrand: true, imageId: null };
    await db.insert(schema.imageDesigns).values({ id, workspaceId, createdBy: userId, kind: "image", title: `${headline} · ${format}`.slice(0, 100), format, data });
    if (photo) {
      const imageId = randomUUID();
      const key = `images/${workspaceId}/${id}/pic/${imageId}.${photo.ext}`;
      await putObject(key, photo.bytes, photo.type);
      await db.insert(schema.imageDesignImages).values({
        id: imageId, designId: id, workspaceId, source: "upload", storageKey: key, width: photo.width, height: photo.height,
        prompt: `From ${p.url}`,
      });
      await db.update(schema.imageDesigns).set({ data: { ...data, imageId } }).where(eq(schema.imageDesigns.id, id));
    } else if (useAi) {
      const imageId = randomUUID();
      await createImageJob({ userId, workspaceId, brief, style: "photographic", format, design: { designId: id, imageId } });
      await db.update(schema.imageDesigns).set({ data: { ...data, imageId } }).where(eq(schema.imageDesigns.id, id));
    }
    designs.push({ id, format });
  }

  let projectId: string | null = null;
  if (req.deck) {
    projectId = randomUUID();
    const b = defaultBrief("ad");
    const musicTrackId = await (await import("@/lib/music")).defaultDeckTrackId("ad");
    const prompt = [`${p.title}${p.brand ? ` (${p.brand})` : ""}${price ? ` — ${price}` : ""}.`, (p.description ?? "").slice(0, 1200)].join(" ").trim();
    await db.insert(schema.projects).values({
      id: projectId,
      ownerId: userId,
      workspaceId,
      template: "surprise",
      aspect: "9:16",
      title: `${headline} ad`.slice(0, 100),
      description: `Made from ${p.url}`.slice(0, 500),
      kind: "deck",
      lengthSec: b.lengthSec,
      musicTrackId,
      deck: { ...b, prompt: prompt.slice(0, 2000), offer: price || undefined, cta: { text: "Shop now", url: p.url } },
    });
  }
  revalidatePath("/images");
  revalidatePath("/projects");
  return {
    designs,
    projectId,
    photo: photo ? "product" : useAi ? "ai" : "none",
    credits,
    note:
      formats.length && !photo && !useAi
        ? "The page had no product photo we could use, so the ads are text-led on your brand colours. Add a photo in each design (free) or make an AI picture."
        : null,
  };
}
/** Make the pack (credits only for AI pictures, confirmed first). */
export async function makeProductPack(req: PackRequest) { return toResult(() => makePackImpl(req)); }
