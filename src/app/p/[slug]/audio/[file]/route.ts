import { audioResponse } from "@/lib/podcast/public";

// GET/HEAD /p/:slug/audio/:id.mp3 — an episode's audio: byte ranges from MinIO, IAB-style download counting.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; file: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const p = await params;
  return audioResponse(req, p.slug, p.file);
}

export async function HEAD(req: Request, { params }: Ctx) {
  const p = await params;
  return audioResponse(req, p.slug, p.file);
}
