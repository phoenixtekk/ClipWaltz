import JSZip from "jszip";
import { getAuthUserId } from "@/lib/auth";
import { fileStem, loadDesign, renderDesign } from "@/lib/image-ad/designs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/images/<designId>/zip — every output (a carousel's slides, in order) as numbered PNGs in one ZIP (viewer+).
// Images only: the LinkedIn adapter posts text alone (no image or document upload), so no LinkedIn PDF is offered yet.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthUserId();
  if (!userId) return new Response("Sign in", { status: 401 });
  const { id } = await params;
  const d = await loadDesign(userId, id, "viewer");
  if (!d) return new Response("Not found", { status: 404 });
  const outs = await renderDesign(d.row);
  const stem = fileStem(d.row);
  const zip = new JSZip();
  const pad = String(outs.length).length;
  for (const o of outs) zip.file(`${stem}-${String(o.index + 1).padStart(pad, "0")}.png`, o.png);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${stem}.zip"`,
      "cache-control": "private, no-store",
    },
  });
}
