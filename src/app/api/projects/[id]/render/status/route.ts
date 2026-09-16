import { NextResponse } from "next/server";
import { getLatestRender } from "@/lib/render";

// Polled by the editor to reflect render progress.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const render = await getLatestRender(id);
    return NextResponse.json({ render }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ render: null }, { status: 401 });
  }
}
