import { apiJson, apiRoute, apiSchedulePost, readJson } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v1/posts/<id>/schedule { scheduled_at } — schedule or move a post that has not started publishing. Scope: publish.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return apiRoute(req, async (ctx) => {
    const { body } = await readJson(req);
    return apiJson(await apiSchedulePost(ctx, id, body.scheduled_at));
  });
}
