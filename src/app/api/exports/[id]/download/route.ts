import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { serveObject } from "@/lib/storage";
import { trackDownload } from "@/lib/analytics";
import { getAuthUserId } from "@/lib/auth";
import { userCanAccessProject } from "@/lib/workspace";

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
      projectId: schema.exportJobs.projectId,
    })
    .from(schema.exportJobs)
    .where(eq(schema.exportJobs.id, id));

  if (!row || !row.key || !(await userCanAccessProject(userId, row.projectId))) {
    return new NextResponse("not found", { status: 404 });
  }
  await trackDownload(req, "export_downloaded", { userId, projectId: row.projectId, key: row.key, id });
  const ext = row.format === "webm" ? "webm" : "mp4";
  const type = row.format === "webm" ? "video/webm" : "video/mp4";
  return serveObject(req, row.key, type, {
    download: `clipwaltz-${id.slice(0, 8)}.${ext}`,
    cacheControl: "private, max-age=3600",
  });
}
