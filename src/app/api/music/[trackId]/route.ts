import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { getObject } from "@/lib/storage";

export const runtime = "nodejs";

// Proxied playback of a catalog music bed (any signed-in user). Streams the track
// from MinIO through the app — used by the draft preview player's soundtrack and,
// later, track audition in the picker.
export async function GET(_req: Request, ctx: { params: Promise<{ trackId: string }> }) {
  const { trackId } = await ctx.params;

  try {
    await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }

  const [track] = await db
    .select({ key: schema.musicTracks.storageKey })
    .from(schema.musicTracks)
    .where(and(eq(schema.musicTracks.id, trackId), eq(schema.musicTracks.active, true)));

  if (!track) return new NextResponse("not found", { status: 404 });

  const { body, contentType } = await getObject(track.key, _req.signal);
  return new NextResponse(body, {
    headers: {
      "content-type": contentType ?? "audio/mpeg",
      "cache-control": "private, max-age=3600",
    },
  });
}
