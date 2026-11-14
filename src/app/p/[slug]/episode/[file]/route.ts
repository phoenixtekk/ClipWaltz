import { episodeImageResponse } from "@/lib/podcast/public";

// GET/HEAD /p/:slug/episode/:id.png — per-episode artwork (`<itunes:image>` on the item). Optional; missing = 404.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; file: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const p = await params;
  return episodeImageResponse(req, p.slug, p.file);
}

export async function HEAD(req: Request, { params }: Ctx) {
  const p = await params;
  return episodeImageResponse(req, p.slug, p.file);
}
