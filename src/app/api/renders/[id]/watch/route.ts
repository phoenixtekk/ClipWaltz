import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { serveObject } from "@/lib/storage";
import { getAuthUserId } from "@/lib/auth";
import { userCanAccessProject } from "@/lib/workspace";

export const runtime = "nodejs";

// Playback of a render. Shared renders (public/unlisted) are open to anyone — this powers /w/[id]
// and /feed. A private render plays only for signed-in people who can open its project (Waltz AI
// Remix library + player), never publicly cached.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [row] = await db
    .select({ key: schema.renders.outputKey, visibility: schema.renders.visibility, projectId: schema.renders.projectId })
    .from(schema.renders)
    .where(eq(schema.renders.id, id));

  if (!row || !row.key) return new NextResponse("not found", { status: 404 });
  if (row.visibility === "private") {
    const userId = await getAuthUserId();
    if (!userId || !(await userCanAccessProject(userId, row.projectId))) return new NextResponse("not found", { status: 404 });
    return serveObject(_req, row.key, "video/mp4", { cacheControl: "private, max-age=3600" });
  }
  return serveObject(_req, row.key, "video/mp4", { cacheControl: "public, max-age=3600" });
}
