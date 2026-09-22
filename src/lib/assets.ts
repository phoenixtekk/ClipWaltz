import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";

export type AssetSummary = {
  id: string;
  name: string;
  kind: string; // photo | video
  uploadState: string;
  orderIndex: number;
  sourceFormat: string | null; // insv | lrv | insp | null
  conversionState: string; // ready | pending | converting | failed
  durationSec: number | null; // video length (null for photos / unknown)
  durationOverride: number | null; // manual per-clip screen time (seconds); null = auto
};

/** Assets for a project the current user owns (empty if not owner). */
export async function listAssets(projectId: string): Promise<AssetSummary[]> {
  const userId = await requireUserId();
  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!proj) return [];

  const rows = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.projectId, projectId))
    .orderBy(asc(schema.assets.orderIndex), asc(schema.assets.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.originalName ?? "file",
    kind: r.kind,
    uploadState: r.uploadState,
    orderIndex: r.orderIndex,
    sourceFormat: r.sourceFormat,
    conversionState: r.conversionState,
    durationSec: r.durationSec,
    durationOverride: r.durationOverride,
  }));
}
