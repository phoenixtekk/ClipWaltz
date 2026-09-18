import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { putObject } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

// Import from client-picker download URLs (Dropbox Chooser / OneDrive picker). The picker
// runs in the browser with the user's own account; it hands back short-lived direct-download
// URLs, which we fetch server-side into MinIO. Hosts are allowlisted per source to prevent SSRF.
const ALLOW: Record<string, RegExp[]> = {
  dropbox: [/(^|\.)dropboxusercontent\.com$/i, /(^|\.)dropbox\.com$/i],
  onedrive: [
    /(^|\.)sharepoint\.com$/i,
    /(^|\.)1drv\.com$/i,
    /(^|\.)1drv\.ms$/i,
    /(^|\.)onedrive\.live\.com$/i,
    /(^|\.)files\.1drv\.com$/i,
    /(^|\.)microsoftpersonalcontent\.com$/i,
    /(^|\.)live\.com$/i,
  ],
};
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|hevc|3gp)$/i;
const MAX_BYTES = 300 * 1024 * 1024;

function allowed(source: string, u: string): boolean {
  try {
    const host = new URL(u).hostname;
    return (ALLOW[source] ?? []).some((re) => re.test(host));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  let body: { projectId?: string; source?: string; files?: { url: string; name?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const { projectId, source, files } = body;
  if (!projectId || !source || !ALLOW[source] || !Array.isArray(files)) {
    return NextResponse.json({ error: "missing/invalid fields" }, { status: 400 });
  }

  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!proj) return NextResponse.json({ error: "not found" }, { status: 404 });

  let imported = 0;
  const errors: string[] = [];
  for (const f of files.slice(0, 100)) {
    if (!f?.url || !allowed(source, f.url)) {
      errors.push(`blocked: ${f?.name ?? f?.url ?? "?"}`);
      continue;
    }
    try {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (!buf.byteLength || buf.byteLength > MAX_BYTES) throw new Error("empty or too large");
      const name = (f.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
      const type = res.headers.get("content-type") ?? "application/octet-stream";
      const kind = type.startsWith("video/") || VIDEO_EXT.test(name) ? "video" : "photo";
      const assetId = randomUUID();
      const key = `projects/${projectId}/${assetId}-${name}`;
      await putObject(key, buf, type);
      await db.insert(schema.assets).values({
        id: assetId,
        projectId,
        storageKey: key,
        kind,
        originalName: f.name ?? name,
        uploadState: "uploaded",
      });
      imported++;
    } catch (e) {
      errors.push(`${f.name ?? "file"}: ${(e as Error).message}`);
    }
  }
  return NextResponse.json({ imported, total: files.length, errors: errors.slice(0, 3) });
}
