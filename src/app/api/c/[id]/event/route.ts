import { NextResponse } from "next/server";
import { getPublicVariant, recordVariantEvent } from "@/lib/campaign-public";

export const runtime = "nodejs";

// Audience beacon from a campaign variant landing page: {type: view|play|complete, v: per-browser id}. Always 204
// (a beacon has no reader; nothing about whether it counted is revealed).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { type?: string; v?: string } = {};
  try {
    body = JSON.parse((await req.text()).slice(0, 500));
  } catch { /* ignore */ }
  const type = body.type;
  if (type === "view" || type === "play" || type === "complete") {
    const v = await getPublicVariant(id);
    if (v) await recordVariantEvent(req, v, type, typeof body.v === "string" ? body.v : null);
  }
  return new NextResponse(null, { status: 204 });
}
