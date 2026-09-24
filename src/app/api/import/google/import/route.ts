import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userCanAccessProject } from "@/lib/workspace";
import { requireUserId } from "@/lib/auth";
import { putObject } from "@/lib/storage";
import { googleAccessToken, listPickedItems, downloadPicked } from "@/lib/google";

export const runtime = "nodejs";
export const maxDuration = 300;

// Pull the picked Google Photos into MinIO + create asset rows (owner-checked).
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  let body: { projectId?: string; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const { projectId, sessionId } = body;
  if (!projectId || !sessionId) return NextResponse.json({ error: "missing fields" }, { status: 400 });

  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!proj || !(await userCanAccessProject(userId, projectId, "editor"))) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const token = await googleAccessToken(userId);
    const items = await listPickedItems(token, sessionId);
    let imported = 0;
    const errors: string[] = [];
    for (const it of items) {
      try {
        const bytes = await downloadPicked(token, it);
        if (!bytes.byteLength) continue;
        const assetId = randomUUID();
        const safe = (it.filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
        const key = `projects/${projectId}/${assetId}-${safe}`;
        await putObject(key, bytes, it.mimeType);
        await db.insert(schema.assets).values({
          id: assetId,
          projectId,
          storageKey: key,
          kind: it.isVideo ? "video" : "photo",
          originalName: it.filename,
          uploadState: "uploaded",
        });
        imported++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return NextResponse.json({ imported, total: items.length, errors: errors.slice(0, 3) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
