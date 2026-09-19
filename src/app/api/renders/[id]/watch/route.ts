import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getObject } from "@/lib/storage";

export const runtime = "nodejs";

// Public playback of a SHARED render (visibility public/unlisted). Streams the object
// from MinIO through the app; private renders 404. No auth — this powers /w/[id] and /feed.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [row] = await db
    .select({ key: schema.renders.outputKey, visibility: schema.renders.visibility })
    .from(schema.renders)
    .where(eq(schema.renders.id, id));

  if (!row || !row.key || row.visibility === "private") {
    return new NextResponse("not found", { status: 404 });
  }

  const { body, contentType } = await getObject(row.key, _req.signal);
  return new NextResponse(body, {
    headers: {
      "content-type": contentType ?? "video/mp4",
      "cache-control": "public, max-age=3600",
    },
  });
}
