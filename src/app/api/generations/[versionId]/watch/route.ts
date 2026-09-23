import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { serveObject } from "@/lib/storage";
import { getAuthUserId } from "@/lib/auth";
import { userCanAccessProject } from "@/lib/workspace";

export const runtime = "nodejs";

// Owner-only playback of a generated version. Generated media is private (not a public feed),
// so this streams from MinIO through the app only for the project's owner.
export async function GET(req: Request, ctx: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await ctx.params;
  const userId = await getAuthUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });

  const [row] = await db
    .select({ key: schema.generationVersions.outputKey, projectId: schema.generationVersions.projectId })
    .from(schema.generationVersions)
    .where(eq(schema.generationVersions.id, versionId));

  if (!row || !row.key || !(await userCanAccessProject(userId, row.projectId))) {
    return new NextResponse("not found", { status: 404 });
  }
  return serveObject(req, row.key, "video/mp4", { cacheControl: "private, max-age=3600" });
}
