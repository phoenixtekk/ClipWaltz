import { NextResponse } from "next/server";
import { getPublicVariant, recordVariantEvent } from "@/lib/campaign-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CTA click on a campaign variant landing page: count it, then send the visitor to the owner's link with UTM tags.
// The destination comes only from the pack's stored link — never from the request — so this is not an open redirect.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const v = await getPublicVariant(id);
  if (!v) return new NextResponse("not found", { status: 404 });
  if (!v.ctaHref) return NextResponse.redirect(new URL(`/c/${id}`, req.url), 302);
  await recordVariantEvent(req, v, "click", new URL(req.url).searchParams.get("v"));
  return NextResponse.redirect(v.ctaHref, { status: 302, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer-when-downgrade" } });
}
