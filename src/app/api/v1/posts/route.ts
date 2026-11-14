import { withIdempotency } from "@/lib/api-keys";
import { apiCreatePost, apiJson, apiListPosts, apiRoute, readJson } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/v1/posts?limit=50 — recent posts. Scope: read.
// POST /api/v1/posts — create a draft, queue, schedule or publish a post. Scope: publish. Honours Idempotency-Key.
export async function GET(req: Request) {
  return apiRoute(req, async (ctx) => apiJson(await apiListPosts(ctx, Number(new URL(req.url).searchParams.get("limit") ?? 50))));
}

export async function POST(req: Request) {
  return apiRoute(req, async (ctx) => {
    const { text, body } = await readJson(req);
    const r = await withIdempotency(ctx, req, text, async () => ({ status: 201, body: await apiCreatePost(ctx, body) }));
    return apiJson(r.body, r.status, r.replayed ? { "idempotent-replayed": "true" } : {});
  });
}
