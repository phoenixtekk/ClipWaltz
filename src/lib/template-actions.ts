"use server";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { normalizeSettings, type GenerationSettings } from "./generation-settings";

export type AiTemplate = { id: string; name: string; category: string | null; description: string | null; settings: GenerationSettings };

/** CW-MVP-150 template browser: enabled AI templates (Product Promo, Social Reel, Story, …). */
export async function listAiTemplates(): Promise<AiTemplate[]> {
  await requireUserId();
  const rows = await db.select().from(schema.templates).where(eq(schema.templates.enabled, true)).orderBy(asc(schema.templates.name));
  return rows.map((r) => ({ id: r.id, name: r.name, category: r.category, description: r.description, settings: normalizeSettings(r.metadataJson) }));
}
