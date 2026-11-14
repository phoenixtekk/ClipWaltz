import { apiGetImage, apiJson, apiRoute } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/images/<id> — status (pending | ready | failed) and the file URL when ready. Scope: read.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return apiRoute(req, async (ctx) => apiJson(await apiGetImage(ctx, id)));
}
