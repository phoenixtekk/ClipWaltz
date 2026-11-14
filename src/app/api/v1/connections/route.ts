import { apiJson, apiListChannels, apiRoute } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/connections — the workspace's connected channels (no credentials). Scope: read.
export async function GET(req: Request) {
  return apiRoute(req, async (ctx) => apiJson(await apiListChannels(ctx)));
}
