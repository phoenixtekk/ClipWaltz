import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { createMultipart, completeMultipart, abortMultipart, deleteObject } from "@/lib/storage";

export const runtime = "nodejs";

// Resumable proxied upload control plane: init / complete / abort a MinIO multipart
// upload. Parts are streamed via PUT .../assets/[assetId]/part. MinIO stays LAN-only.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!proj) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    name?: string;
    type?: string;
    assetId?: string;
    uploadId?: string;
    parts?: { PartNumber: number; ETag: string }[];
  };

  if (body.action === "init") {
    const name = (body.name ?? "file").slice(0, 200);
    const type = body.type ?? "application/octet-stream";
    const kind = type.startsWith("video/") ? "video" : "photo";
    const assetId = randomUUID();
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `projects/${projectId}/${assetId}-${safe}`;
    const uploadId = await createMultipart(key, type);
    await db.insert(schema.assets).values({
      id: assetId,
      projectId,
      storageKey: key,
      kind,
      originalName: name,
      uploadState: "uploading",
    });
    return NextResponse.json({ assetId, uploadId, kind });
  }

  // complete / abort both need to resolve the asset (owner-scoped).
  const assetId = body.assetId ?? "";
  const [asset] = await db
    .select({ id: schema.assets.id, key: schema.assets.storageKey })
    .from(schema.assets)
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)));
  if (!asset) return NextResponse.json({ error: "asset not found" }, { status: 404 });

  if (body.action === "complete") {
    if (!body.uploadId || !Array.isArray(body.parts) || body.parts.length === 0) {
      return NextResponse.json({ error: "missing uploadId/parts" }, { status: 400 });
    }
    try {
      await completeMultipart(asset.key, body.uploadId, body.parts);
    } catch (err) {
      return NextResponse.json({ error: `storage error: ${(err as Error).message}` }, { status: 502 });
    }
    await db
      .update(schema.assets)
      .set({ uploadState: "uploaded" })
      .where(eq(schema.assets.id, assetId));
    return NextResponse.json({ id: assetId, uploaded: true });
  }

  if (body.action === "abort") {
    if (body.uploadId) await abortMultipart(asset.key, body.uploadId).catch(() => {});
    await deleteObject(asset.key).catch(() => {});
    await db.delete(schema.assets).where(eq(schema.assets.id, assetId));
    return NextResponse.json({ aborted: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
