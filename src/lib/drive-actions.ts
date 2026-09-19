"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { getObjectBytes } from "./storage";
import { driveAccessToken, ensureClipWaltzFolder, uploadToDrive, disconnectDrive } from "./drive";

function mimeFor(kind: string, sourceFormat: string | null, name: string): string {
  if (sourceFormat) return "application/octet-stream"; // .insv/.lrv/.insp original
  if (kind === "video") return "video/mp4";
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}

async function backupOne(userId: string, token: string, folderId: string, mediaId: string) {
  const [m] = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, mediaId), eq(schema.media.ownerId, userId)));
  if (!m || m.driveFileId) return; // missing or already backed up
  const bytes = await getObjectBytes(m.storageKey); // back up the original imported file
  const fileId = await uploadToDrive(token, folderId, m.originalName ?? `clip-${m.id}`, bytes, mimeFor(m.kind, m.sourceFormat, m.originalName ?? ""));
  await db
    .update(schema.media)
    .set({ driveFileId: fileId, driveBackedAt: new Date() })
    .where(eq(schema.media.id, m.id));
}

/** Back up one library file to the user's Google Drive (ClipWaltz folder). */
export async function backupMediaToDrive(mediaId: string): Promise<void> {
  const userId = await requireUserId();
  const token = await driveAccessToken(userId);
  const folderId = await ensureClipWaltzFolder(token);
  await backupOne(userId, token, folderId, mediaId);
  revalidatePath("/library");
}

/** Back up every not-yet-backed-up library file. Returns how many were uploaded. */
export async function backupAllToDrive(): Promise<{ count: number }> {
  const userId = await requireUserId();
  const token = await driveAccessToken(userId);
  const folderId = await ensureClipWaltzFolder(token);
  const rows = await db
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(and(eq(schema.media.ownerId, userId), isNull(schema.media.driveFileId)))
    .limit(200);
  let count = 0;
  for (const r of rows) {
    try {
      await backupOne(userId, token, folderId, r.id);
      count++;
    } catch {
      /* best-effort; skip failures */
    }
  }
  revalidatePath("/library");
  return { count };
}

/** Disconnect Google Drive (removes the stored tokens; keeps already-backed-up files). */
export async function disconnectDriveAction(): Promise<void> {
  const userId = await requireUserId();
  await disconnectDrive(userId);
  revalidatePath("/library");
}
