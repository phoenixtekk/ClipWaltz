import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export type MediaItem = {
  id: string;
  kind: string; // photo | video
  name: string;
  sourceFormat: string | null;
  conversionState: string;
  reframeMode: string;
  driveBacked: boolean;
  sizeBytes: number | null;
  durationSec: number | null;
  createdAt: string;
  lastUsedAt: string | null;
  usedIn: number; // number of projects using this file
};

/** The signed-in user's media library, newest first, with project-usage counts. */
export async function getUserMedia(userId: string): Promise<MediaItem[]> {
  const usedIn = sql<number>`(select count(distinct a.project_id)::int from assets a where a.media_id = ${schema.media.id})`;
  const rows = await db
    .select({
      id: schema.media.id,
      kind: schema.media.kind,
      name: schema.media.originalName,
      sourceFormat: schema.media.sourceFormat,
      conversionState: schema.media.conversionState,
      reframeMode: schema.media.reframeMode,
      driveFileId: schema.media.driveFileId,
      sizeBytes: schema.media.sizeBytes,
      durationSec: schema.media.durationSec,
      createdAt: schema.media.createdAt,
      lastUsedAt: schema.media.lastUsedAt,
      usedIn,
    })
    .from(schema.media)
    .where(eq(schema.media.ownerId, userId))
    .orderBy(desc(schema.media.createdAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name ?? "file",
    sourceFormat: r.sourceFormat,
    conversionState: r.conversionState,
    reframeMode: r.reframeMode,
    driveBacked: !!r.driveFileId,
    sizeBytes: r.sizeBytes,
    durationSec: r.durationSec,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    usedIn: r.usedIn,
  }));
}
