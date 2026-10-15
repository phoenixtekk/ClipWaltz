import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAdminSession } from "@/lib/admin";
import { getAuthUserId } from "@/lib/auth";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Waltz Avatar: one of an AI presenter's generated face candidates — a library one for admins, a user's own AI presenter
 *  (source ai) for its owner. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await ctx.params;
  if (!/^\d$/.test(n)) return new NextResponse("not found", { status: 404 });
  const [p] = await db.select({ keys: schema.presenters.portraitKeys, kind: schema.presenters.kind, source: schema.presenters.source, userId: schema.presenters.userId })
    .from(schema.presenters).where(eq(schema.presenters.id, id));
  const allowed = !!p && (p.kind === "ai" ? !!(await getAdminSession()) : p.kind === "twin" && p.source === "ai" && p.userId === (await getAuthUserId()));
  const key = allowed && Array.isArray(p.keys) ? (p.keys as string[])[Number(n)] : undefined;
  if (!key) return new NextResponse("not found", { status: 404 });
  return serveObject(req, key, "image/png");
}
