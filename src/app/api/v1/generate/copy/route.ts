import { apiGenerateCopy, apiJson, apiRoute, readJson } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v1/generate/copy { brief, channels[], link? } — AI caption + hashtags per channel (0 credits). Scope: generate.
export async function POST(req: Request) {
  return apiRoute(req, async (ctx) => {
    const { body } = await readJson(req);
    return apiJson(await apiGenerateCopy(ctx, body));
  });
}
