import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireUserId } from "@/lib/auth";
import { FOOTAGE_KEEP_SECONDS, FOOTAGE_MAX_BYTES, FOOTAGE_MIN_SECONDS } from "@/lib/presenters";
import { UploadError, footagePresenter, saveFootage, storeNormalisedVideo } from "@/lib/presenter-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// Waltz Avatar: the presenter's footage (the raw file as the request body). Normalised and stored at
// presenters/<userId>/<id>/footage.mp4; the first FOOTAGE_KEEP_SECONDS are kept (the lip-sync loop uses up to 60 s,
// the consent voice match up to 60 s). Files over Cloudflare's 100 MB request limit go up in parts: footage/upload.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  try {
    const { owner } = await footagePresenter(id, userId);
    // A new key per upload: an upload that lands while the presenter is being built never replaces what was checked.
    const key = `presenters/${owner}/${id}/footage-${randomUUID()}.mp4`;
    const { seconds } = await storeNormalisedVideo(req, key, { max: FOOTAGE_MAX_BYTES, keepSeconds: FOOTAGE_KEEP_SECONDS, minSeconds: FOOTAGE_MIN_SECONDS, what: "video" });
    if (!(await saveFootage(id, owner, key))) return new NextResponse("This presenter is already being made", { status: 409 });
    return NextResponse.json({ seconds });
  } catch (e) {
    if (e instanceof UploadError) return new NextResponse(e.message, { status: e.status });
    console.error("[presenter footage]", (e as Error).message);
    return new NextResponse("Could not store the video. Try again.", { status: 502 });
  }
}
