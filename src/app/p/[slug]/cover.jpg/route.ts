import { coverResponse } from "@/lib/podcast/public";

// GET/HEAD /p/:slug/cover.jpg — show artwork. Apple requires HEAD with Last-Modified on the artwork host.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return coverResponse(req, (await params).slug);
}

export async function HEAD(req: Request, { params }: Ctx) {
  return coverResponse(req, (await params).slug);
}
