import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { googleAccessToken, createPickerSession } from "@/lib/google";

export const runtime = "nodejs";

// Create a Google Photos picking session; returns the pickerUri to open + sessionId to poll.
export async function POST() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  try {
    const token = await googleAccessToken(userId);
    const s = await createPickerSession(token);
    return NextResponse.json({ sessionId: s.id, pickerUri: s.pickerUri });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
