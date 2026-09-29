import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { userCanAccessProject } from "@/lib/workspace";
import { requireUserId } from "@/lib/auth";
import { putObject } from "@/lib/storage";
import { enqueueDeck } from "@/lib/queue";
import type { DeckImportStatus, DeckState } from "@/lib/deck/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 50 * 1024 * 1024; // same cap as music uploads (next.config proxyClientMaxBodySize is 55mb)
const TYPES = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
} as const;

// WaltzDeck import (phase 3): a PowerPoint or PDF → brief + one scene per slide. The file is stored under the
// project's prefix and handed to the deck worker (worker/deck/jobs.mjs "import"), which deletes it when done.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("Sign in again.", { status: 401 });
  }
  const [p] = await db.select({ kind: schema.projects.kind, deck: schema.projects.deck }).from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!p || p.kind !== "deck" || !(await userCanAccessProject(userId, projectId, "editor"))) return new NextResponse("Project not found.", { status: 404 });
  const cur = ((p.deck ?? {}) as Partial<DeckState>).import as { status?: string; startedAt?: string } | undefined;
  if (cur && ["queued", "reading", "summarizing"].includes(cur.status ?? "") && cur.startedAt && Date.now() - Date.parse(cur.startedAt) < 15 * 60 * 1000) {
    return new NextResponse("An import is already running — hang on a moment.", { status: 409 });
  }

  let file: File | null = null;
  try {
    const f = (await req.formData()).get("file");
    if (f instanceof File) file = f;
  } catch { /* fallthrough */ }
  if (!file) return new NextResponse("Choose a file.", { status: 400 });
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (ext !== "pptx" && ext !== "pdf") {
    return new NextResponse(ext === "ppt" ? "Old .ppt files aren't supported — save it as .pptx (PowerPoint: File → Save As) and try again." : "Import a PowerPoint (.pptx) or a PDF.", { status: 415 });
  }
  if (file.size > MAX_BYTES) return new NextResponse("That file is too large (max 50 MB).", { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Magic bytes: a .pptx is a zip ("PK"), a PDF starts with "%PDF".
  const ok = ext === "pptx" ? bytes[0] === 0x50 && bytes[1] === 0x4b : String.fromCharCode(...bytes.slice(0, 4)) === "%PDF";
  if (!ok) return new NextResponse(`That file isn't a valid ${ext === "pptx" ? "PowerPoint" : "PDF"}.`, { status: 415 });

  const key = `projects/${projectId}/imports/${randomUUID()}.${ext}`;
  try {
    await putObject(key, bytes, TYPES[ext]);
  } catch {
    return new NextResponse("Couldn't store the file. Try again.", { status: 502 });
  }
  const name = file.name.slice(0, 200);
  const status: DeckImportStatus = { status: "queued", source: ext, name, startedAt: new Date().toISOString() };
  await db.update(schema.projects).set({
    deck: sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{import}', ${JSON.stringify(status)}::jsonb)`,
  }).where(eq(schema.projects.id, projectId));
  try {
    await enqueueDeck({ name: "import", data: { projectId, source: ext, key, name, userId } }, `import-${projectId}-${Date.now()}`);
  } catch {
    const failed: DeckImportStatus = { status: "failed", source: ext, name, error: "Couldn't reach the importer — try again in a moment." };
    await db.update(schema.projects).set({
      deck: sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{import}', ${JSON.stringify(failed)}::jsonb)`,
    }).where(eq(schema.projects.id, projectId));
    return new NextResponse(failed.error, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
