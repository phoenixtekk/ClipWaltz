import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { verifyMediaSignature } from "@/lib/social/media";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/media/public/<id>?exp&sig — the signed public URL networks fetch media from (Threads, Instagram,
// TikTok PULL_FROM_URL, dev.to cover images, TxtYa). No session: the HMAC signature + expiry are the gate
// (src/lib/social/media.ts). With the storage edge configured (S3_PUBLIC_ENDPOINT, ADR-0003) the answer is a 302 to a
// presigned GET on the public media host, valid 1 h from this request; otherwise the bytes are proxied.
// Ported from SP `src/app/api/media/public/[id]/route.ts`, which served from local disk.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp") || 0);
  const sig = url.searchParams.get("sig") || "";
  if (!verifyMediaSignature(id, exp, sig)) return new Response("forbidden", { status: 403 });

  const [m] = await db
    .select({ storageKey: schema.socialMedia.storageKey, mime: schema.socialMedia.mime })
    .from(schema.socialMedia)
    .where(eq(schema.socialMedia.id, id));
  if (!m) return new Response("not found", { status: 404 });

  try {
    return await serveObject(req, m.storageKey, m.mime, { cacheControl: "public, max-age=3600" });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
