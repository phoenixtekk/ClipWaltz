import { requireSocial, socialErrorResponse } from "@/lib/social/access";
import { socialMediaKey } from "@/lib/social/media";
import { directMediaEnabled, presignUploadPart, uploadPart } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One part of a chunked post-media upload (see ../../multipart). Editor+; the key comes from the caller's workspace.
//   GET ?uploadId&partNumber[&workspace]  → { url } presigned direct PUT via the storage edge (404 { direct:false } if off)
//   PUT ?uploadId&partNumber[&workspace]  → proxied part upload, returns { partNumber, etag }

function parse(req: Request) {
  const url = new URL(req.url);
  const uploadId = url.searchParams.get("uploadId") ?? "";
  const partNumber = Number(url.searchParams.get("partNumber"));
  const ok = Boolean(uploadId) && Number.isInteger(partNumber) && partNumber >= 1 && partNumber <= 10000;
  return { ok, uploadId, partNumber, workspace: url.searchParams.get("workspace") };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = parse(req);
  if (!p.ok) return Response.json({ error: "bad part params" }, { status: 400 });
  try {
    const sc = await requireSocial(p.workspace, "editor");
    if (!directMediaEnabled()) return Response.json({ direct: false }, { status: 404 });
    return Response.json({ url: await presignUploadPart(socialMediaKey(sc.workspaceId, id), p.uploadId, p.partNumber) });
  } catch (e) {
    return socialErrorResponse(e);
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = parse(req);
  if (!p.ok) return Response.json({ error: "bad part params" }, { status: 400 });
  try {
    const sc = await requireSocial(p.workspace, "editor");
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength === 0) return Response.json({ error: "empty part" }, { status: 400 });
    const etag = await uploadPart(socialMediaKey(sc.workspaceId, id), p.uploadId, p.partNumber, buf);
    return Response.json({ partNumber: p.partNumber, etag });
  } catch (e) {
    return socialErrorResponse(e);
  }
}
