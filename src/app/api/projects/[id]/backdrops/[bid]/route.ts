import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userCanAccessProject } from "@/lib/workspace";
import { requireUserId } from "@/lib/auth";
import { serveObject } from "@/lib/storage";
import type { DeckState } from "@/lib/deck/types";

export const runtime = "nodejs";

// One AI backdrop of a WaltzDeck (projects.deck.backdrops, made by worker/generation-worker.mjs) for the editor
// preview. Looked up by id, so the stored key never reaches the browser.
export async function GET(req: Request, ctx: { params: Promise<{ id: string; bid: string }> }) {
  const { id: projectId, bid } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  if (!(await userCanAccessProject(userId, projectId))) return new NextResponse("not found", { status: 404 });
  const [p] = await db.select({ deck: schema.projects.deck }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const img = ((p?.deck ?? {}) as Partial<DeckState>).backdrops?.find((b) => b.id === bid);
  if (!img || !img.key.endsWith(".jpg")) return new NextResponse("not found", { status: 404 });
  // Each id is a new file — safe to cache for a long time.
  return serveObject(req, img.key, "image/jpeg", { cacheControl: "private, max-age=86400" });
}
