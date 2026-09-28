import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Does this Waltz AI version's picture carry a logo burned in from a watermarked render? True when
 * its lineage (remix `source`, enhance `enhancedFrom`) leads back to one. Other versions are made
 * from AI output and keep a truly clean master.
 */
export async function burnedInLogo(versionId: string, depth = 0): Promise<boolean> {
  if (depth > 8) return false;
  const [v] = await db.select({ settings: schema.generationVersions.settings })
    .from(schema.generationVersions).where(eq(schema.generationVersions.id, versionId));
  const s = (v?.settings ?? {}) as { remix?: boolean; source?: { kind?: string; id?: string }; enhancedFrom?: string };
  if (s.remix && s.source?.id) {
    if (s.source.kind === "render") {
      const [r] = await db.select({ watermark: schema.renders.watermark }).from(schema.renders).where(eq(schema.renders.id, s.source.id));
      return !!r?.watermark;
    }
    return burnedInLogo(s.source.id, depth + 1);
  }
  if (typeof s.enhancedFrom === "string") return burnedInLogo(s.enhancedFrom, depth + 1);
  return false;
}
