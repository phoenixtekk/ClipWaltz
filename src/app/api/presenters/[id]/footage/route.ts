import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { FOOTAGE_KEEP_SECONDS, FOOTAGE_MAX_BYTES, FOOTAGE_MIN_SECONDS } from "@/lib/presenters";
import { UploadError, draftPresenter, replaceKey, storeNormalisedVideo } from "@/lib/presenter-media";
import { purgePrefix } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// Waltz Avatar: the presenter's footage (the raw file as the request body). Normalised and stored at
// presenters/<userId>/<id>/footage.mp4; the first FOOTAGE_KEEP_SECONDS are kept (the lip-sync loop uses up to 60 s,
// the consent voice match up to 60 s).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  try {
    await draftPresenter(userId, id);
    // A new key per upload: an upload that lands while the presenter is being built never replaces what was checked.
    const key = `presenters/${userId}/${id}/footage-${randomUUID()}.mp4`;
    const { seconds } = await storeNormalisedVideo(req, key, { max: FOOTAGE_MAX_BYTES, keepSeconds: FOOTAGE_KEEP_SECONDS, minSeconds: FOOTAGE_MIN_SECONDS, what: "video" });
    // Only while it's still being set up (not queued / building / ready, not deleted meanwhile); else drop the new file.
    const [row] = await db.update(schema.presenters).set({ footageKey: key, status: "draft", error: null, updatedAt: new Date() })
      .where(and(eq(schema.presenters.id, id), eq(schema.presenters.userId, userId), inArray(schema.presenters.status, ["draft", "failed"])))
      .returning({ id: schema.presenters.id });
    if (!row) {
      await purgePrefix(key).catch(() => {});
      return new NextResponse("This presenter is already being made", { status: 409 });
    }
    await replaceKey(`presenters/${userId}/${id}/footage-`, key);
    return NextResponse.json({ seconds });
  } catch (e) {
    if (e instanceof UploadError) return new NextResponse(e.message, { status: e.status });
    console.error("[presenter footage]", (e as Error).message);
    return new NextResponse("Could not store the video. Try again.", { status: 502 });
  }
}
