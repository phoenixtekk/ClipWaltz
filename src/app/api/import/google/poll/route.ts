import { NextResponse, type NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import { googleAccessToken, getPickerSession } from "@/lib/google";

export const runtime = "nodejs";

// Poll a picking session: ready=true once the user has finished picking in Google's UI.
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "missing sessionId" }, { status: 400 });
  try {
    const token = await googleAccessToken(userId);
    const s = await getPickerSession(token, sessionId);
    return NextResponse.json({ ready: s.mediaItemsSet });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
