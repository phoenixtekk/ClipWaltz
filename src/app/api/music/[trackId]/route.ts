import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userCanAccessProject } from "@/lib/workspace";
import { requireUserId } from "@/lib/auth";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";

// Proxied playback of a catalog music bed (any signed-in user). Streams the track
// from MinIO through the app — used by the draft preview player's soundtrack and,
// later, track audition in the picker.
async function canHearViaProject(userId: string, trackId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.musicTrackId, trackId));
  for (const r of rows) if (await userCanAccessProject(userId, r.id)) return true;
  return false;
}

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
  // A personal upload (owner set) is streamable by its owner, or by anyone who can view a project
  // that uses it (a shared workspace project scored with a collaborator's upload); catalog = shared.
  if (track.ownerId && track.ownerId !== userId && !(await canHearViaProject(userId, trackId))) {
    return new NextResponse("forbidden", { status: 403 });
  }

  return serveObject(_req, track.key, "audio/mpeg");
}
