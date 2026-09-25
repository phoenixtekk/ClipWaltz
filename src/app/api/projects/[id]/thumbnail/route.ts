import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userCanAccessProject } from "@/lib/workspace";
import { requireUserId } from "@/lib/auth";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";

// CW-MVP-011 project card thumbnail: the project's first visible photo (timeline order). 404 when
// the project has no photo yet — the card then keeps its gradient placeholder.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  if (!(await userCanAccessProject(userId, projectId))) return new NextResponse("not found", { status: 404 });
  const [row] = await db
    .select({ key: schema.assets.storageKey, convertedKey: schema.assets.convertedKey })
    .from(schema.assets)
    .where(and(
      eq(schema.assets.projectId, projectId), eq(schema.assets.kind, "photo"),
      eq(schema.assets.uploadState, "uploaded"), eq(schema.assets.hidden, false),
    ))
    .orderBy(asc(schema.assets.orderIndex), asc(schema.assets.createdAt))
    .limit(1);
  if (!row) return new NextResponse("no thumbnail", { status: 404 });
  return serveObject(req, row.convertedKey ?? row.key, "image/jpeg", { cacheControl: "private, max-age=300" });
}
