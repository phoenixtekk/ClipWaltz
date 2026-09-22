import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";

// Proxied playback of a catalog music bed (any signed-in user). Streams the track
// from MinIO through the app — used by the draft preview player's soundtrack and,
// later, track audition in the picker.
export async function GET(_req: Request, ctx: { params: Promise<{ trackId: string }> }) {
  const { trackId } = await ctx.params;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }

  const [track] = await db
    .select({ key: schema.musicTracks.storageKey, ownerId: schema.musicTracks.ownerId })
    .from(schema.musicTracks)
    .where(and(eq(schema.musicTracks.id, trackId), eq(schema.musicTracks.active, true)));

  if (!track) return new NextResponse("not found", { status: 404 });
  // A personal upload (owner set) is only streamable by its owner; catalog tracks are shared.
  if (track.ownerId && track.ownerId !== userId) return new NextResponse("forbidden", { status: 403 });

  return serveObject(_req, track.key, "audio/mpeg");
}
