import { getAuthUserId } from "@/lib/auth";
import { fileStem, loadDesign, outputCount, normalizeData, isDesignKind, renderDesign } from "@/lib/image-ad/designs";
import { toJpeg } from "../../../../../../worker/image/compose.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/images/<designId>/render?i=<output index>&fmt=png|jpg&download=1
// Composites one output of a Waltz Image design on the fly (viewer+). No GPU work: the picture already exists, this only
// draws the text, brand colours and logo — which is why editing a headline is instant and free.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthUserId();
  if (!userId) return new Response("Sign in", { status: 401 });
  const { id } = await params;
  const d = await loadDesign(userId, id, "viewer");
  if (!d) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const kind = isDesignKind(d.row.kind) ? d.row.kind : "image";
  const count = outputCount(kind, normalizeData(kind, d.row.data));
  const i = Math.min(count - 1, Math.max(0, Number(url.searchParams.get("i")) || 0));
  const [out] = await renderDesign(d.row, i);
  if (!out) return new Response("Not found", { status: 404 });
  const jpg = url.searchParams.get("fmt") === "jpg";
  const body = jpg ? await toJpeg(out.png) : out.png;
  const name = `${fileStem(d.row)}${count > 1 ? `-${i + 1}` : ""}.${jpg ? "jpg" : "png"}`;
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": jpg ? "image/jpeg" : "image/png",
      "cache-control": "private, no-store",
      "x-image-size": `${out.width}x${out.height}`,
      ...(url.searchParams.get("download") ? { "content-disposition": `attachment; filename="${name}"` } : {}),
    },
  });
}
