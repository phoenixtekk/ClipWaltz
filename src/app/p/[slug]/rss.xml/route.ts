import { feedResponse } from "@/lib/podcast/public";

// GET/HEAD /p/:slug/rss.xml — the public podcast feed (P5, decision D4). Anonymous by design.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return feedResponse("GET", (await params).slug);
}

export async function HEAD(_req: Request, { params }: Ctx) {
  return feedResponse("HEAD", (await params).slug);
}
