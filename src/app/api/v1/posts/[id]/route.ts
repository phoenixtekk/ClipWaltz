import { apiGetPost, apiJson, apiRoute } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/posts/<id> — a post with its per-channel delivery status. Scope: read.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return apiRoute(req, async (ctx) => apiJson(await apiGetPost(ctx, id)));
}
