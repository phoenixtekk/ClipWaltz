import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userCanAccessProject } from "@/lib/workspace";
import { requireUserId } from "@/lib/auth";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";

const TYPES = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

// Download a finished WaltzDeck slide export (PDF / PPTX) — anyone who can open the project.
export async function GET(req: Request, ctx: { params: Promise<{ id: string; exportId: string }> }) {
  const { id: projectId, exportId } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  if (!(await userCanAccessProject(userId, projectId))) return new NextResponse("not found", { status: 404 });
  const [row] = await db.select().from(schema.deckExports)
    .where(and(eq(schema.deckExports.id, exportId), eq(schema.deckExports.projectId, projectId)));
  if (!row || row.status !== "done" || !row.outputKey) return new NextResponse("not found", { status: 404 });
  const [p] = await db.select({ title: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const format = row.format === "pptx" ? "pptx" : "pdf";
  const base = (p?.title ?? "WaltzDeck").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "WaltzDeck";
  return serveObject(req, row.outputKey, TYPES[format], { download: `${base}.${format}`, cacheControl: "private, no-store" });
}
