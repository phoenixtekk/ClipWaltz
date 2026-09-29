"use server";
// Brand kit (workspace-scoped): colours, heading/body fonts and a logo, applied to WaltzDeck renders
// (scene templates + title/CTA cards). One kit per workspace for now; a project opts in via brandKitId.
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { userCanAccessProject } from "./workspace";
import { putObject } from "./storage";
import { BRAND_FONTS, type BrandKit } from "./brand";

const HEX = /^#[0-9a-f]{6}$/i;

async function projectWorkspace(projectId: string, role: "viewer" | "editor") {
  const userId = await requireUserId();
  const [p] = await db.select({ id: schema.projects.id, workspaceId: schema.projects.workspaceId, brandKitId: schema.projects.brandKitId })
    .from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!p || !p.workspaceId || !(await userCanAccessProject(userId, projectId, role))) throw new Error("Project not found");
  return p as { id: string; workspaceId: string; brandKitId: string | null };
}

const toKit = (k: typeof schema.brandKits.$inferSelect, applied: boolean): BrandKit => {
  const colors = Array.isArray(k.colorsJson) ? (k.colorsJson as string[]) : [];
  const fonts = (k.fontsJson ?? {}) as { heading?: string; body?: string };
  return {
    id: k.id,
    primary: HEX.test(colors[0] ?? "") ? colors[0] : "#8b5cf6",
    secondary: HEX.test(colors[1] ?? "") ? colors[1] : "#120a24",
    headingFont: BRAND_FONTS.includes(fonts.heading as never) ? fonts.heading! : "Montserrat",
    bodyFont: BRAND_FONTS.includes(fonts.body as never) ? fonts.body! : "Inter",
    hasLogo: !!k.logoKey,
    applied,
  };
};

/** The workspace's brand kit (null if none yet) and whether this project uses it. */
export async function getBrandKit(projectId: string): Promise<BrandKit | null> {
  const p = await projectWorkspace(projectId, "viewer");
  const [k] = await db.select().from(schema.brandKits).where(eq(schema.brandKits.workspaceId, p.workspaceId)).limit(1);
  return k ? toKit(k, p.brandKitId === k.id) : null;
}

/** Create/update the workspace kit and apply it to (or remove it from) this project. */
export async function saveBrandKit(
  projectId: string,
  input: { primary: string; secondary: string; headingFont: string; bodyFont: string; applied: boolean },
): Promise<BrandKit> {
  const p = await projectWorkspace(projectId, "editor");
  const colors = [HEX.test(input.primary) ? input.primary : "#8b5cf6", HEX.test(input.secondary) ? input.secondary : "#120a24"];
  const fonts = {
    heading: BRAND_FONTS.includes(input.headingFont as never) ? input.headingFont : "Montserrat",
    body: BRAND_FONTS.includes(input.bodyFont as never) ? input.bodyFont : "Inter",
  };
  let [k] = await db.select().from(schema.brandKits).where(eq(schema.brandKits.workspaceId, p.workspaceId)).limit(1);
  if (k) {
    [k] = await db.update(schema.brandKits).set({ colorsJson: colors, fontsJson: fonts, updatedAt: new Date() })
      .where(eq(schema.brandKits.id, k.id)).returning();
  } else {
    [k] = await db.insert(schema.brandKits).values({ id: randomUUID(), workspaceId: p.workspaceId, colorsJson: colors, fontsJson: fonts }).returning();
  }
  await db.update(schema.projects).set({ brandKitId: input.applied ? k.id : null, updatedAt: new Date() }).where(eq(schema.projects.id, projectId));
  revalidatePath(`/projects/${projectId}/deck`);
  return toKit(k, input.applied);
}

/** Upload the kit's logo (PNG, JPEG or WebP, ≤ 1 MB). Creates the kit if needed. No SVG: served from the app's
 *  origin an SVG can carry script (security review 2026-09-29). */
export async function uploadBrandLogo(projectId: string, form: FormData): Promise<BrandKit> {
  const p = await projectWorkspace(projectId, "editor");
  const file = form.get("logo");
  if (!(file instanceof File)) throw new Error("Choose an image file");
  const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[file.type];
  if (!ext) throw new Error("Use a PNG, JPEG or WebP logo");
  if (file.size > 1024 * 1024) throw new Error("Keep the logo under 1 MB");
  let [k] = await db.select().from(schema.brandKits).where(eq(schema.brandKits.workspaceId, p.workspaceId)).limit(1);
  if (!k) [k] = await db.insert(schema.brandKits).values({ id: randomUUID(), workspaceId: p.workspaceId, colorsJson: ["#8b5cf6", "#120a24"], fontsJson: { heading: "Montserrat", body: "Inter" } }).returning();
  const key = `brand/${p.workspaceId}/${k.id}-${Date.now()}.${ext}`;
  await putObject(key, new Uint8Array(await file.arrayBuffer()), file.type);
  [k] = await db.update(schema.brandKits).set({ logoKey: key, updatedAt: new Date() }).where(eq(schema.brandKits.id, k.id)).returning();
  revalidatePath(`/projects/${projectId}/deck`);
  return toKit(k, p.brandKitId === k.id);
}
