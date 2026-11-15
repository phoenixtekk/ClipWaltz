import JSZip from "jszip";
import { requireSocial, socialErrorResponse } from "@/lib/social/access";
import { getKitRow, videoOf } from "@/lib/kits/kits";
import { kitNetwork, type KitAsset, type KitItem } from "@/lib/kits/types";
import { readMedia } from "@/lib/social/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/kits/<kit>/zip — everything to post by hand: one folder per network with caption.txt (title, caption) and
// that network's pictures. A video is NOT put in the zip (it can be hundreds of MB and would be copied per network);
// README.txt says where to download it.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const sc = await requireSocial(null, "viewer");
    const kit = await getKitRow(sc.workspaceId, id);
    if (!kit) return new Response("not found", { status: 404 });
    const items = (kit.items as KitItem[]) ?? [];
    const assets = (kit.assets as KitAsset[]) ?? [];
    const zip = new JSZip();
    const bytes = new Map<string, Buffer>();
    const missing: string[] = [];
    // A picture can be gone (a post took it and was deleted): leave it out and say so, rather than failing the zip.
    const read = async (mediaId: string): Promise<Buffer | null> => {
      if (!bytes.has(mediaId)) {
        const b = await readMedia(mediaId, sc.workspaceId).catch(() => null);
        if (!b) return null;
        bytes.set(mediaId, b);
      }
      return bytes.get(mediaId)!;
    };

    for (const it of items) {
      const net = kitNetwork(it.provider);
      const dir = zip.folder(net?.label ?? it.provider)!;
      const text = [it.title ? `TITLE\n${it.title}\n` : "", `CAPTION\n${it.caption}`, kit.link ? `\nLINK\n${kit.link}` : ""].filter(Boolean).join("\n");
      dir.file("caption.txt", text + "\n");
      const pics = assets.filter((a) => a.kind === "image" && a.format === it.format).sort((a, b) => a.index - b.index);
      for (const a of pics) {
        const b = await read(a.mediaId);
        if (b) dir.file(a.filename, b);
        else missing.push(`${net?.label ?? it.provider}/${a.filename}`);
      }
    }
    const v = videoOf(kit);
    const readme = [
      `Post kit: ${kit.title || "Untitled"}`,
      "Made with ClipWaltz. Nothing was posted for you: open each folder, copy caption.txt into the network and attach its pictures.",
      missing.length ? `\nThese pictures were deleted and are not included: ${missing.join(", ")}` : "",
      v ? `\nThe video is not in this zip. Download it from ClipWaltz (Publish > Post kits > this kit > Download video): ${v.name}` : "",
    ].join("\n");
    zip.file("README.txt", readme + "\n");

    const out = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    const name = (kit.title || "post-kit").replace(/[^\w.\- ]+/g, "_").trim().slice(0, 60) || "post-kit";
    return new Response(out as unknown as BodyInit, {
      headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}.zip"`, "cache-control": "private, no-store" },
    });
  } catch (e) {
    return socialErrorResponse(e);
  }
}
