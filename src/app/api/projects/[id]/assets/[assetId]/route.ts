import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";

// Proxied playback of a project's source asset (owner-checked). Streams the object
// from MinIO through the app so MinIO stays off the public internet — used by the
// in-editor draft preview player.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id: projectId, assetId } = await ctx.params;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }

  const [row] = await db
    .select({
      key: schema.assets.storageKey,
      convertedKey: schema.assets.convertedKey,
      state: schema.assets.uploadState,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.assets)
    .innerJoin(schema.projects, eq(schema.assets.projectId, schema.projects.id))
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)));

  if (!row || row.ownerId !== userId || row.state !== "uploaded") {
    return new NextResponse("not found", { status: 404 });
  }

  // Serve the reprojected flat clip for 360 files; the raw .insv isn't browser-playable.
  return serveObject(_req, row.convertedKey ?? row.key, "application/octet-stream");
}
