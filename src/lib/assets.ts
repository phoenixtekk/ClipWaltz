import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userCanAccessProject } from "./workspace";
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
  trimStart: number | null; // video in-point (seconds); null = from start
  trimEnd: number | null; // video out-point (seconds); null = to end
  /** 360 sources: flat (front) | follow (tracks the action) | tiny (little planet). */
  reframeMode?: string | null;
};

/** Assets for a project the current user owns (empty if not owner). */
export async function listAssets(projectId: string): Promise<AssetSummary[]> {
  const userId = await requireUserId();
  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!proj || !(await userCanAccessProject(userId, projectId, "viewer"))) return [];

  const joined = await db
    .select({ a: schema.assets, reframeMode: schema.media.reframeMode })
    .from(schema.assets)
    .leftJoin(schema.media, eq(schema.assets.mediaId, schema.media.id))
    .where(eq(schema.assets.projectId, projectId))
    .orderBy(asc(schema.assets.orderIndex), asc(schema.assets.createdAt));

  return joined.map(({ a: r, reframeMode }) => ({
    id: r.id,
    name: r.originalName ?? "file",
    kind: r.kind,
    uploadState: r.uploadState,
    orderIndex: r.orderIndex,
    sourceFormat: r.sourceFormat,
    conversionState: r.conversionState,
    durationSec: r.durationSec,
    durationOverride: r.durationOverride,
    trimStart: r.trimStart,
    trimEnd: r.trimEnd,
    reframeMode: r.sourceFormat ? reframeMode : null,
  }));
}
