import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { uploadPart } from "@/lib/storage";

export const runtime = "nodejs";

// Upload one part of a resumable multipart upload. Idempotent per part number, so a
// client can safely retry a failed/interrupted part. Returns the part's ETag.
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id: projectId, assetId } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const uploadId = url.searchParams.get("uploadId") ?? "";
  const partNumber = Number(url.searchParams.get("partNumber"));
  if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return NextResponse.json({ error: "bad part params" }, { status: 400 });
  }

  // Owner-scoped asset lookup (join project).
  const [row] = await db
    .select({ key: schema.assets.storageKey })
    .from(schema.assets)
    .innerJoin(schema.projects, eq(schema.assets.projectId, schema.projects.id))
    .where(
      and(
        eq(schema.assets.id, assetId),
        eq(schema.assets.projectId, projectId),
        eq(schema.projects.ownerId, userId),
      ),
    );
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength === 0) return NextResponse.json({ error: "empty part" }, { status: 400 });

  try {
    const etag = await uploadPart(row.key, uploadId, partNumber, buf);
    return NextResponse.json({ partNumber, etag });
  } catch (err) {
    console.error(`[part] upload failed key=${row.key} part=${partNumber} bytes=${buf.byteLength}:`, (err as Error).message);
    return NextResponse.json({ error: `storage error: ${(err as Error).message}` }, { status: 502 });
  }
}
