import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { pushConfigured, sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Notifications page → "Send test notification": a real Web Push to every browser this user subscribed,
// shown even when a ClipWaltz tab is focused (force). Returns how many were delivered to the push service.
export async function POST() {
  const userId = await getAuthUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });
  if (!pushConfigured) return NextResponse.json({ sent: 0, error: "Push isn't configured on the server." }, { status: 503 });
  const sent = await sendPushToUser(userId, {
    title: "ClipWaltz test notification 🔔",
    body: "Notifications work — you'll get one like this when a video finishes rendering.",
    url: "/account/notifications",
    tag: "clipwaltz-test",
    force: true,
  });
  console.log(`[push] test for ${userId}: ${sent} sent`);
  return NextResponse.json({ sent });
}
