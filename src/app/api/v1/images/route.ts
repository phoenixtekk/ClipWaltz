import { withIdempotency } from "@/lib/api-keys";
import { apiCreateImage, apiJson, apiRoute, readJson } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v1/images { brief, format?, style? } — start an AI picture (2 credits, refunded on failure). Scope: generate.
// Poll GET /api/v1/images/<id>. Honours Idempotency-Key (so a retried request is not charged twice).
export async function POST(req: Request) {
  return apiRoute(req, async (ctx) => {
    const { text, body } = await readJson(req);
    const r = await withIdempotency(ctx, req, text, async () => ({ status: 202, body: await apiCreateImage(ctx, body) }));
    return apiJson(r.body, r.status, r.replayed ? { "idempotent-replayed": "true" } : {});
  });
}
