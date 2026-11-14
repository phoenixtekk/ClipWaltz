import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { appUrl } from "@/lib/social/app-url";
import { handleThreadsRemoval } from "@/lib/social/meta-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Threads "Data Deletion" callback. Meta POSTs a signed_request when a user requests deletion; we delete that user's
// Threads connections and must answer with a status URL + confirmation code. Public (no session) — called by Meta.
export async function POST(req: Request) {
  const r = await handleThreadsRemoval(req);
  if (!r.ok) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  const code = randomUUID().replace(/-/g, "");
  return NextResponse.json({
    url: `${appUrl()}/api/social/webhooks/threads/delete?code=${code}`,
    confirmation_code: code,
  });
}

// Status endpoint for a prior deletion request. Deletion happens synchronously in POST, so any code reads as done.
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") || "";
  return NextResponse.json({ status: "deleted", code });
}
