import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { CONSENT_MAX_BYTES, CONSENT_MAX_SECONDS } from "@/lib/presenters";
import { UploadError, replaceKey, storeNormalisedVideo } from "@/lib/presenter-media";
import { purgePrefix } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Waltz Avatar Phase 2: the live VOICE consent clip (the voice sentence + its code), recorded in the browser. Checked on
// AISERVER against the footage's voice when the voice is submitted (presenter-consent-v1).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  try {
    const [p] = await db.select().from(schema.presenters).where(and(eq(schema.presenters.id, id), eq(schema.presenters.userId, userId)));
    if (!p) return new NextResponse("Presenter not found", { status: 404 });
    if (p.status !== "ready" || !["draft", "failed"].includes(p.voiceStatus) || !p.voiceConsentCode) {
      return new NextResponse("Press “Use my own voice” first to get a code", { status: 409 });
    }
    const key = `presenters/${userId}/${id}/voice-consent-${randomUUID()}.mp4`;
    const { seconds } = await storeNormalisedVideo(req, key, { max: CONSENT_MAX_BYTES, keepSeconds: CONSENT_MAX_SECONDS, minSeconds: 3, what: "recording" });
    const [row] = await db.update(schema.presenters).set({ voiceConsentKey: key, voiceStatus: "draft", voiceError: null, updatedAt: new Date() })
      .where(and(eq(schema.presenters.id, id), eq(schema.presenters.userId, userId), eq(schema.presenters.status, "ready"),
        inArray(schema.presenters.voiceStatus, ["draft", "failed"])))
      .returning({ id: schema.presenters.id });
    if (!row) {
      await purgePrefix(key).catch(() => {});
      return new NextResponse("Your voice is already being checked", { status: 409 });
    }
    await replaceKey(`presenters/${userId}/${id}/voice-consent-`, key);
    return NextResponse.json({ seconds });
  } catch (e) {
    if (e instanceof UploadError) return new NextResponse(e.message, { status: e.status });
    console.error("[presenter voice consent]", (e as Error).message);
    return new NextResponse("Could not store the recording. Try again.", { status: 502 });
  }
}
