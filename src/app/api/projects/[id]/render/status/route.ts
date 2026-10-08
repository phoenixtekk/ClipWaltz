import { NextResponse } from "next/server";
import { getLatestRender } from "@/lib/render";
import { getQueueInfo } from "@/lib/render-queue";

// Polled by the editor to reflect render progress.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const render = await getLatestRender(id);
    // Queue position + wait estimate while it's queued or rendering (shown in the Render panel).
    const queue = render && (render.status === "queued" || render.status === "rendering")
      ? await getQueueInfo(render.id).catch(() => null)
      : null;
    return NextResponse.json({ render, queue }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ render: null }, { status: 401 });
  }
}
