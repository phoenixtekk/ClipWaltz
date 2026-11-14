import { apiImageFile, apiRoute } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/images/<id>/file — the finished PNG. Scope: read.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return apiRoute(req, async (ctx) => {
    const bytes = await apiImageFile(ctx, id);
    return new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png", "cache-control": "private, no-store" } });
  });
}
