import { and, asc, eq } from "drizzle-orm";
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
  /** Front file of an Insta360 split-lens pair, stitched with its "_10_" partner into full 360. */
  stitchedPair?: boolean;
  width?: number | null;
  height?: number | null;
  /** User labels (CW-MVP-024). */
  tags?: string[];
  /** The original upload has a copy in the owner's Google Drive. */
  driveBackedUp?: boolean;
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
    .select({ a: schema.assets, reframeMode: schema.media.reframeMode, pairMediaId: schema.media.pairMediaId, driveFileId: schema.media.driveFileId })
    .from(schema.assets)
    .leftJoin(schema.media, eq(schema.assets.mediaId, schema.media.id))
    .where(and(eq(schema.assets.projectId, projectId), eq(schema.assets.hidden, false)))
    .orderBy(asc(schema.assets.orderIndex), asc(schema.assets.createdAt));

  return joined.map(({ a: r, reframeMode, pairMediaId, driveFileId }) => ({
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
    driveBackedUp: !!driveFileId,
    width: r.width,
    height: r.height,
    tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t): t is string => typeof t === "string") : [],
    stitchedPair: !!pairMediaId && /_00_\d+\.insv$/i.test(r.originalName ?? ""),
  }));
}
