import { randomUUID } from "crypto";
import { db, schema } from "@/db";
import { requireSocial, socialErrorResponse } from "@/lib/social/access";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, socialMediaKey } from "@/lib/social/media";
import { abortMultipart, completeMultipart, createMultipart, deleteObject, headObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chunked upload for large post media (P2). The app proxy caps one request body at 55 MB, so a long video goes up in
// parts: init → PUT …/media/<id>/part (or the presigned direct PUT) per part → complete. Editor+ on the workspace.
// The object key is derived from the CALLER's workspace and the server-made id, so a client cannot aim parts or a
// completion at another workspace's object. The social_media row is written on complete, once the size is known.
//
//   { action: "init", name, type, size, workspaceId? }      → { id, uploadId }
//   { action: "complete", id, uploadId, parts, name, type }  → { id, kind }
//   { action: "abort", id, uploadId }                        → { aborted: true }
export async function POST(req: Request) {
  const b = ((await req.json().catch(() => ({}))) ?? {}) as {
    action?: string;
    workspaceId?: string;
    id?: string;
    uploadId?: string;
    name?: string;
    type?: string;
    size?: number;
    parts?: { PartNumber: number; ETag: string }[];
  };
  try {
    const sc = await requireSocial(b.workspaceId ?? null, "editor");
    const type = String(b.type ?? "");
    const kind = ALLOWED_MIME[type];

    if (b.action === "init") {
      if (!kind) return Response.json({ error: "That file type is not supported (images: jpeg/png/gif/webp; video: mp4/mov/webm)." }, { status: 400 });
      if (typeof b.size === "number" && b.size > MAX_UPLOAD_BYTES) return Response.json({ error: "The file is larger than 200 MB." }, { status: 400 });
      const id = randomUUID();
      const uploadId = await createMultipart(socialMediaKey(sc.workspaceId, id), type);
      return Response.json({ id, uploadId });
    }

    const id = String(b.id ?? "");
    let key: string;
    try {
      key = socialMediaKey(sc.workspaceId, id);
    } catch {
      return Response.json({ error: "bad id" }, { status: 400 });
    }

    if (b.action === "complete") {
      if (!kind) return Response.json({ error: "Unsupported file type." }, { status: 400 });
      if (!b.uploadId || !Array.isArray(b.parts) || b.parts.length === 0) return Response.json({ error: "missing uploadId/parts" }, { status: 400 });
      await completeMultipart(key, b.uploadId, b.parts);
      const size = await headObject(key).then((h) => h.size, () => 0);
      if (size <= 0 || size > MAX_UPLOAD_BYTES) {
        await deleteObject(key).catch(() => {});
        return Response.json({ error: size <= 0 ? "The upload is empty." : "The file is larger than 200 MB." }, { status: 400 });
      }
      await db.insert(schema.socialMedia).values({
        id,
        workspaceId: sc.workspaceId,
        createdBy: sc.userId,
        kind,
        filename: String(b.name ?? "").replace(/[^\w.\- ]+/g, "_").slice(0, 200) || kind,
        mime: type,
        size,
        storageKey: key,
        source: "upload",
      });
      return Response.json({ id, kind, size });
    }

    if (b.action === "abort") {
      if (b.uploadId) await abortMultipart(key, b.uploadId).catch(() => {});
      await deleteObject(key).catch(() => {});
      return Response.json({ aborted: true });
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return socialErrorResponse(e);
  }
}
