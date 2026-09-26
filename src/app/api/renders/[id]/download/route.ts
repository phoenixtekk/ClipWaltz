import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userCanAccessProject } from "@/lib/workspace";
import { requireUserId } from "@/lib/auth";
import { serveObject } from "@/lib/storage";
import { trackDownload } from "@/lib/analytics";

export const runtime = "nodejs";

// Proxied download of a finished render (owner-checked). Streams the object from
// MinIO through the app so MinIO stays off the public internet.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }

  const [row] = await db
    .select({
      key: schema.renders.outputKey,
      projectId: schema.renders.projectId,
      titleText: schema.projects.titleText,
      title: schema.projects.title,
    })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .where(eq(schema.renders.id, id));

  if (!row || !row.key || !(await userCanAccessProject(userId, row.projectId))) {
    return new NextResponse("not found", { status: 404 });
  }

  // Name the download after the Style Title (falls back to the project title).
  const base = (row.titleText || row.title || "clipwaltz").trim().replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 100) || "clipwaltz";
  await trackDownload(_req, "render_downloaded", { userId, projectId: row.projectId, key: row.key, id });
  return serveObject(_req, row.key, "video/mp4", { download: `${base}.mp4` });
}
