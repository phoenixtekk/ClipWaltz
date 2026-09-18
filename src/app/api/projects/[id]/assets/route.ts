import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { putObject } from "@/lib/storage";

export const runtime = "nodejs";

// Proxied upload: browser POSTs the file body here (with ?name & ?type), we stream
// it to the MinIO `clipwaltz` bucket and record an assets row. This keeps MinIO off
// the public internet. (v1.1: switch to presigned multipart for large/resumable uploads.)
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

  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "file").slice(0, 200);
  const type = url.searchParams.get("type") ?? "application/octet-stream";

  // 360 / Insta360 files (browsers can't play these; the worker reprojects them to flat mp4).
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const sourceFormat = ext === "insv" || ext === "lrv" || ext === "insp" ? ext : null;
  const kind = sourceFormat === "insp" ? "photo" : sourceFormat ? "video" : type.startsWith("video/") ? "video" : "photo";
  const conversionState = sourceFormat ? "pending" : "ready";

  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength === 0) return NextResponse.json({ error: "empty file" }, { status: 400 });

  const assetId = randomUUID();
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `projects/${projectId}/${assetId}-${safe}`;

  try {
    await putObject(key, buf, sourceFormat ? "application/octet-stream" : type);
  } catch (err) {
    return NextResponse.json(
      { error: `storage error: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  await db.insert(schema.assets).values({
    id: assetId,
    projectId,
    storageKey: key,
    kind,
    originalName: name,
    uploadState: "uploaded",
    sourceFormat,
    conversionState,
  });

  return NextResponse.json({ id: assetId, name, kind, bytes: buf.byteLength, sourceFormat, conversionState });
}
