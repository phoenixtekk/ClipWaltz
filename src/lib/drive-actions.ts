"use server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { userCanAccessProject } from "./workspace";
import { driveConfigured, hasDriveConnection, driveAccessToken, ensureClipWaltzFolder, uploadToDriveResumable } from "./drive";
import { headObject, getObjectRange } from "./storage";

// Google Drive backup of a project's ORIGINAL uploads (restored after the Media Library removal).
// Backups run in the background inside the app process (long videos take minutes); the timeline
// polls `driveBackedUp` on its clips. Files are streamed to Drive in 16 MB chunks — never buffered.

export type DriveStatus = { configured: boolean; connected: boolean };

export async function getDriveStatus(): Promise<DriveStatus> {
  const userId = await requireUserId();
  const configured = driveConfigured();
  return { configured, connected: configured ? await hasDriveConnection(userId) : false };
}

const running = new Set<string>(); // media ids being uploaded by this process

async function backupOne(userId: string, media: { id: string; key: string; name: string | null; mime: string | null }) {
  if (running.has(media.id)) return;
  running.add(media.id);
  try {
    const token = await driveAccessToken(userId);
    const folder = await ensureClipWaltzFolder(token);
    const head = await headObject(media.key);
    const fileId = await uploadToDriveResumable(
      token, folder, media.name ?? "clip", media.mime ?? head.contentType ?? "application/octet-stream", head.size,
      (s, e) => getObjectRange(media.key, s, e),
    );
    await db.update(schema.media).set({ driveFileId: fileId, driveBackedAt: new Date() }).where(eq(schema.media.id, media.id));
    console.log(`[drive] backed up media ${media.id} (${head.size} bytes) → ${fileId}`);
  } catch (e) {
    console.error(`[drive] backup of media ${media.id} failed:`, (e as Error).message);
  } finally {
    running.delete(media.id);
  }
}

/**
 * Back up a project's original uploads to the user's Google Drive ("ClipWaltz" folder). `assetIds`
 * limits it to some clips; otherwise every clip not yet backed up. Returns how many started.
 */
export async function backupToDrive(projectId: string, assetIds?: string[]): Promise<{ started: number }> {
  const userId = await requireUserId();
  if (!(await userCanAccessProject(userId, projectId, "editor"))) throw new Error("Project not found");
  if (!driveConfigured()) throw new Error("Google Drive backup isn't configured on this server");
  if (!(await hasDriveConnection(userId))) throw new Error("Connect Google Drive first");
  const rows = await db
    .select({ id: schema.media.id, key: schema.media.storageKey, name: schema.media.originalName, sourceFormat: schema.media.sourceFormat, kind: schema.media.kind })
    .from(schema.assets)
    .innerJoin(schema.media, eq(schema.assets.mediaId, schema.media.id))
    .where(and(
      eq(schema.assets.projectId, projectId), eq(schema.assets.uploadState, "uploaded"), isNull(schema.media.driveFileId),
      // Only the caller's own uploads go to (and are marked in) the caller's Drive.
      eq(schema.media.ownerId, userId),
      ...(assetIds?.length ? [inArray(schema.assets.id, assetIds)] : []),
    ));
  const todo = [...new Map(rows.map((r) => [r.id, r])).values()].filter((r) => !running.has(r.id));
  // Sequential in the background so one project doesn't open dozens of uploads at once.
  void (async () => {
    for (const r of todo) {
      await backupOne(userId, { id: r.id, key: r.key, name: r.name, mime: r.sourceFormat ? "application/octet-stream" : null });
    }
    revalidatePath(`/projects/${projectId}/edit`);
  })();
  return { started: todo.length };
}
