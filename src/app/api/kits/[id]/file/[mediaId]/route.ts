import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSocial, socialErrorResponse } from "@/lib/social/access";
import { getKitRow } from "@/lib/kits/kits";
import type { KitAsset } from "@/lib/kits/types";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/kits/<kit>/file/<media>[?download=1] — one picture (or uploaded video) of a post kit, for viewers of the
// kit's workspace. Only media listed in the kit's assets is served, so a guessed id can't read other files.
export async function GET(req: Request, ctx: { params: Promise<{ id: string; mediaId: string }> }) {
  const { id, mediaId } = await ctx.params;
  try {
    const sc = await requireSocial(null, "viewer");
    const kit = await getKitRow(sc.workspaceId, id);
    const asset = ((kit?.assets as KitAsset[] | undefined) ?? []).find((a) => a.mediaId === mediaId);
    if (!kit || !asset) return new Response("not found", { status: 404 });
    const [m] = await db.select({ key: schema.socialMedia.storageKey, mime: schema.socialMedia.mime })
      .from(schema.socialMedia).where(and(eq(schema.socialMedia.id, mediaId), eq(schema.socialMedia.workspaceId, sc.workspaceId)));
    if (!m) return new Response("not found", { status: 404 });
    const download = new URL(req.url).searchParams.get("download") ? asset.filename.replace(/[^\w.\- ]+/g, "_") : undefined;
    return await serveObject(req, m.key, m.mime, { download });
  } catch (e) {
    return socialErrorResponse(e);
  }
}
