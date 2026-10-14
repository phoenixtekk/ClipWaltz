import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A presenter's still (made by the worker when it's ready) — owner only. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  const [p] = await db.select({ thumbKey: schema.presenters.thumbKey }).from(schema.presenters)
    .where(and(eq(schema.presenters.id, id), eq(schema.presenters.userId, userId)));
  if (!p?.thumbKey) return new NextResponse("not found", { status: 404 });
  return serveObject(req, p.thumbKey, "image/jpeg");
}
