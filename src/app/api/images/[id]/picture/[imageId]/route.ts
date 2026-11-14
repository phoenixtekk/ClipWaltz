import { getAuthUserId } from "@/lib/auth";
import { loadDesign, pictureKey } from "@/lib/image-ad/designs";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/images/<designId>/picture/<imageId> — one clean picture of a design (no text), for the editor's picker.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const userId = await getAuthUserId();
  if (!userId) return new Response("Sign in", { status: 401 });
  const { id, imageId } = await params;
  const d = await loadDesign(userId, id, "viewer");
  if (!d) return new Response("Not found", { status: 404 });
  const key = await pictureKey(id, imageId);
  if (!key) return new Response("Not found", { status: 404 });
  return serveObject(req, key, "image/png", { cacheControl: "private, max-age=86400" });
}
