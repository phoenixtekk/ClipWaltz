import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import {
  savePushSubscription,
  deletePushSubscription,
  hasPushSubscription,
  pushConfigured,
  type WebPushSubscription,
} from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  → is this browser (by endpoint) currently subscribed for this user?
// POST → save/refresh this browser's subscription (turn OS push ON).
// DELETE → remove this browser's subscription (turn OS push OFF).

export async function GET(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });
  const endpoint = new URL(req.url).searchParams.get("endpoint") ?? "";
  const subscribed = endpoint ? await hasPushSubscription(userId, endpoint) : false;
  return NextResponse.json({ subscribed, configured: pushConfigured });
}

export async function POST(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });
  if (!pushConfigured) return new NextResponse("push not configured", { status: 503 });

  let sub: WebPushSubscription | null = null;
  try {
    const body = (await req.json()) as { subscription?: WebPushSubscription };
    sub = body.subscription ?? null;
  } catch {
    /* fallthrough */
  }
  if (!sub?.endpoint) return new NextResponse("bad request", { status: 400 });

  try {
    await savePushSubscription(userId, sub, req.headers.get("user-agent"));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return new NextResponse((e as Error).message || "could not save", { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });
  let endpoint = "";
  try {
    const body = (await req.json()) as { endpoint?: string };
    endpoint = body.endpoint ?? "";
  } catch {
    /* fallthrough */
  }
  if (!endpoint) return new NextResponse("bad request", { status: 400 });
  await deletePushSubscription(userId, endpoint);
  return NextResponse.json({ ok: true });
}
