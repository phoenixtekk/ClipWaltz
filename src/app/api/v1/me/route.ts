import { apiJson, apiMe, apiRoute } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/me — the key's workspace and permissions (any scope).
export async function GET(req: Request) {
  return apiRoute(req, async (ctx) => apiJson(await apiMe(ctx)));
}
