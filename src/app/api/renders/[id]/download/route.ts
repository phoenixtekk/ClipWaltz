import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { getObject } from "@/lib/storage";

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
      ownerId: schema.projects.ownerId,
      titleText: schema.projects.titleText,
      title: schema.projects.title,
    })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .where(eq(schema.renders.id, id));

  if (!row || row.ownerId !== userId || !row.key) {
    return new NextResponse("not found", { status: 404 });
  }

  // Name the download after the Style Title (falls back to the project title).
  const base = (row.titleText || row.title || "clipwaltz").trim().replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 100) || "clipwaltz";
  const { body, contentType } = await getObject(row.key);
  return new NextResponse(body, {
    headers: {
      "content-type": contentType ?? "video/mp4",
      "content-disposition": `attachment; filename="${base}.mp4"`,
    },
  });
}
