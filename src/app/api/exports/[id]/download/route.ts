import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { serveObject } from "@/lib/storage";
import { getAuthUserId } from "@/lib/auth";

export const runtime = "nodejs";

// Owner-only download of a finished export. Streams the transcoded file from MinIO as an
// attachment (the deliverable the user takes away).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getAuthUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });

  const [row] = await db
    .select({
      key: schema.exportJobs.outputKey,
      format: schema.exportJobs.outputFormat,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.exportJobs)
    .innerJoin(schema.projects, eq(schema.exportJobs.projectId, schema.projects.id))
    .where(eq(schema.exportJobs.id, id));

  if (!row || !row.key || row.ownerId !== userId) {
    return new NextResponse("not found", { status: 404 });
  }
  const ext = row.format === "webm" ? "webm" : "mp4";
  const type = row.format === "webm" ? "video/webm" : "video/mp4";
  return serveObject(req, row.key, type, {
    download: `clipwaltz-${id.slice(0, 8)}.${ext}`,
    cacheControl: "private, max-age=3600",
  });
}
