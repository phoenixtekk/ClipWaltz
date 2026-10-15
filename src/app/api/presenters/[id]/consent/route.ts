import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { CONSENT_MAX_BYTES, CONSENT_MAX_SECONDS } from "@/lib/presenters";
import { UploadError, draftPresenter, replaceKey, storeNormalisedVideo } from "@/lib/presenter-media";
import { purgePrefix, serveObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Waltz Avatar: the live consent clip, recorded in the browser (MediaRecorder) while the sentence + code is on screen.
// Stored at presenters/<userId>/<id>/consent.mp4; checked on AISERVER when the presenter is submitted.

/** The owner's own consent clip, while a photo presenter is being set up — to pick the frame it's made from. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  const [p] = await db.select({ key: schema.presenters.consentKey, source: schema.presenters.source, status: schema.presenters.status })
    .from(schema.presenters).where(and(eq(schema.presenters.id, id), eq(schema.presenters.userId, userId), eq(schema.presenters.kind, "twin")));
  if (!p?.key || p.source !== "photo" || (p.status !== "draft" && p.status !== "failed")) return new NextResponse("not found", { status: 404 });
  return serveObject(req, p.key, "video/mp4");
}
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  try {
    const p = await draftPresenter(userId, id);
    if (!p.consentCode) return new NextResponse("Start again to get a new code", { status: 409 });
    // A new key per upload: an upload that lands while the presenter is being built never replaces what was checked.
    const key = `presenters/${userId}/${id}/consent-${randomUUID()}.mp4`;
    const { seconds } = await storeNormalisedVideo(req, key, { max: CONSENT_MAX_BYTES, keepSeconds: CONSENT_MAX_SECONDS, minSeconds: 3, what: "recording" });
    // Only while it's still being set up (not queued / building / ready, not deleted meanwhile); else drop the new file.
    // A new recording: a photo presenter's picked frame was a moment of the old one — pick again.
    const [row] = await db.update(schema.presenters).set({ consentKey: key, photoAt: null, status: "draft", error: null, updatedAt: new Date() })
      .where(and(eq(schema.presenters.id, id), eq(schema.presenters.userId, userId), inArray(schema.presenters.status, ["draft", "failed"])))
      .returning({ id: schema.presenters.id });
    if (!row) {
      await purgePrefix(key).catch(() => {});
      return new NextResponse("This presenter is already being made", { status: 409 });
    }
    await replaceKey(`presenters/${userId}/${id}/consent-`, key);
    return NextResponse.json({ seconds });
  } catch (e) {
    if (e instanceof UploadError) return new NextResponse(e.message, { status: e.status });
    console.error("[presenter consent]", (e as Error).message);
    return new NextResponse("Could not store the recording. Try again.", { status: 502 });
  }
}
