import { ApiError } from "@/lib/api-keys";
import { apiJson, apiListMedia, apiRoute, apiUploadMedia } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/v1/media — the workspace's uploaded post media. Scope: read.
// POST /api/v1/media — multipart/form-data `file` (image or video, ≤ 200 MB). Scope: publish. Attach the returned id
//      to a post with `media_ids`.
export async function GET(req: Request) {
  return apiRoute(req, async (ctx) => apiJson(await apiListMedia(ctx)));
}

export async function POST(req: Request) {
  return apiRoute(req, async (ctx) => {
    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "bad_request", "Send multipart/form-data with a `file` field.");
    const f = form.get("file");
    return apiJson(await apiUploadMedia(ctx, f instanceof File ? f : null), 201);
  });
}
