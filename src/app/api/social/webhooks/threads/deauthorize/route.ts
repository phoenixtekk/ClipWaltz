import { NextResponse } from "next/server";
import { handleThreadsRemoval } from "@/lib/social/meta-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Threads "Uninstall / Deauthorize" callback. Meta POSTs a signed_request here when a user removes the app; that
// user's Threads connections are dropped (src/lib/social/meta-webhooks.ts). Public (no session) — called by Meta.
export async function POST(req: Request) {
  const r = await handleThreadsRemoval(req);
  if (!r.ok) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
