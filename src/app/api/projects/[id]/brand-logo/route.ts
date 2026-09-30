import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userCanAccessProject } from "@/lib/workspace";
import { requireUserId } from "@/lib/auth";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";

// The project's workspace brand-kit logo (WaltzDeck editor preview). 404 when there is none.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  if (!(await userCanAccessProject(userId, projectId))) return new NextResponse("not found", { status: 404 });
  const [p] = await db.select({ ws: schema.projects.workspaceId, deck: schema.projects.deck }).from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!p?.ws) return new NextResponse("no logo", { status: 404 });
  // The pending "brand kit from website" suggestion's logo (a PNG the worker stored for this workspace).
  if (new URL(req.url).searchParams.get("suggestion")) {
    const sug = (p.deck as { brandSuggestion?: { status?: string; logoKey?: string | null } } | null)?.brandSuggestion;
    const key = sug?.status === "ready" ? sug.logoKey : null;
    if (!key || !key.startsWith(`brand/${p.ws}/suggest-`) || !key.endsWith(".png")) return new NextResponse("no logo", { status: 404 });
    return serveObject(req, key, "image/png", { cacheControl: "private, max-age=60" });
  }
  const [k] = await db.select({ key: schema.brandKits.logoKey }).from(schema.brandKits).where(eq(schema.brandKits.workspaceId, p.ws)).limit(1);
  // Raster only (uploads reject SVG): never serve an SVG from the app origin.
  if (!k?.key || k.key.endsWith(".svg")) return new NextResponse("no logo", { status: 404 });
  const type = k.key.endsWith(".png") ? "image/png" : k.key.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return serveObject(req, k.key, type, { cacheControl: "private, max-age=60" });
}
