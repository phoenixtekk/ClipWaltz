import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { serveObject } from "@/lib/storage";
import { getAdminSession } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A presenter's still — its owner; any signed-in user for a published library presenter; admins for library ones. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  const [p] = await db.select({ thumbKey: schema.presenters.thumbKey, userId: schema.presenters.userId, library: schema.presenters.library,
    status: schema.presenters.status, kind: schema.presenters.kind }).from(schema.presenters).where(eq(schema.presenters.id, id));
  const allowed = !!p && (p.userId === userId || (p.library && p.status === "ready") || (p.kind !== "twin" && !!(await getAdminSession())));
  if (!allowed || !p?.thumbKey) return new NextResponse("not found", { status: 404 });
  return serveObject(req, p.thumbKey, "image/jpeg");
}
