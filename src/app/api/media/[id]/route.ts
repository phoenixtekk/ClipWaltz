import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";

function safeFilename(name: string, kind: string, converted: boolean) {
  const base = (name || "clip").replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\.(insv|lrv|insp)$/i, "");
  const ext = converted ? (kind === "photo" ? "jpg" : "mp4") : "";
  return ext && !base.toLowerCase().endsWith(`.${ext}`) ? `${base}.${ext}` : base;
}

// Serve/download a library media file (owner-checked). 360 sources serve the flat
// converted clip. `?download=1` forces a download named after the file.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }

  const [m] = await db
    .select({
      key: schema.media.storageKey,
      convertedKey: schema.media.convertedKey,
      kind: schema.media.kind,
      name: schema.media.originalName,
    })
    .from(schema.media)
    .where(and(eq(schema.media.id, id), eq(schema.media.ownerId, userId)));
  if (!m) return new NextResponse("not found", { status: 404 });

  const converted = !!m.convertedKey;
  const download =
    new URL(_req.url).searchParams.get("download") === "1"
      ? safeFilename(m.name ?? "clip", m.kind, converted)
      : undefined;
  return serveObject(_req, m.convertedKey ?? m.key, "application/octet-stream", { download });
}
