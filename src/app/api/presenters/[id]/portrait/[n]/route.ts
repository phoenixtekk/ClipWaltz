import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAdminSession } from "@/lib/admin";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Waltz Avatar library: one of an AI presenter's generated face candidates — admins only. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await ctx.params;
  if (!(await getAdminSession())) return new NextResponse("not found", { status: 404 });
  const [p] = await db.select({ keys: schema.presenters.portraitKeys, kind: schema.presenters.kind }).from(schema.presenters).where(eq(schema.presenters.id, id));
  const key = p?.kind === "ai" && Array.isArray(p.keys) ? (p.keys as string[])[Number(n)] : undefined;
  if (!key || !/^\d$/.test(n)) return new NextResponse("not found", { status: 404 });
  return serveObject(req, key, "image/png");
}
