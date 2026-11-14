import { requireSocial, socialErrorResponse } from "@/lib/social/access";
import { createMedia, PostInputError } from "@/lib/social/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST multipart/form-data { file, workspaceId? } — store an image/video for a post (editor+), in MinIO under
// social/<workspace>/<id>. One request per file; the app proxy caps a request body at 55 MB
// (next.config.ts proxyClientMaxBodySize), so larger videos need the chunked upload the composer gets in P2.
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "Send multipart/form-data with a file." }, { status: 400 });
  const file = form.get("file");
  const ws = form.get("workspaceId");
  if (!(file instanceof File)) return Response.json({ error: "No file." }, { status: 400 });
  try {
    const sc = await requireSocial(typeof ws === "string" ? ws : null, "editor");
    const m = await createMedia(sc.workspaceId, sc.userId, {
      name: file.name,
      type: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json(m);
  } catch (e) {
    if (e instanceof PostInputError) return Response.json({ error: e.message }, { status: 400 });
    return socialErrorResponse(e);
  }
}
