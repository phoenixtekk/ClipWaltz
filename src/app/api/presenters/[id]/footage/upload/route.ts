import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireUserId } from "@/lib/auth";
import { FOOTAGE_KEEP_SECONDS, FOOTAGE_MAX_BYTES, FOOTAGE_MIN_SECONDS } from "@/lib/presenters";
import { UploadError, footagePresenter, saveFootage, storeNormalisedVideo } from "@/lib/presenter-media";
import { abortMultipart, completeMultipart, createMultipart, deleteObject, headObject, presignGet, uploadPart } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// Waltz Avatar: presenter footage too large for one request (Cloudflare refuses bodies over 100 MB with a 413), sent in
// parts to a MinIO multipart upload at presenters/<owner>/<id>/incoming-<token>, then normalised like footage/route.ts.
//   POST {action:"init"}                               → { token, uploadId }
//   PUT  ?token&uploadId&partNumber  (body = the part)  → { partNumber, etag }
//   POST {action:"complete", token, uploadId, parts}    → { seconds }
//   POST {action:"abort", token, uploadId}
// The key is rebuilt from the presenter and a server-made token, so a caller can never name another object.
const MAX_PART = 16 * 2 ** 20;
const MAX_PARTS = Math.ceil(FOOTAGE_MAX_BYTES / (5 * 2 ** 20)); // S3 parts are ≥ 5 MB except the last
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function target(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    throw new UploadError("unauthenticated", 401);
  }
  const { owner } = await footagePresenter(id, userId);
  return { id, owner, incoming: (token: string) => {
    if (!TOKEN.test(token)) throw new UploadError("Bad upload", 400);
    return `presenters/${owner}/${id}/incoming-${token}`;
  } };
}

function fail(e: unknown) {
  if (e instanceof UploadError) return new NextResponse(e.message, { status: e.status });
  console.error("[presenter footage upload]", (e as Error).message);
  return new NextResponse("Could not store the video. Try again.", { status: 502 });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const t = await target(req, ctx);
    const url = new URL(req.url);
    const key = t.incoming(url.searchParams.get("token") ?? "");
    const uploadId = url.searchParams.get("uploadId") ?? "";
    const partNumber = Number(url.searchParams.get("partNumber"));
    if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) throw new UploadError("Bad upload part", 400);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_PART) throw new UploadError("Upload part too large", 413);
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_PART) throw new UploadError("Bad upload part", 400);
    return NextResponse.json({ partNumber, etag: await uploadPart(key, uploadId, partNumber, buf) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let key: string | null = null;
  try {
    const t = await target(req, ctx);
    const body = (await req.json().catch(() => ({}))) as { action?: string; token?: string; uploadId?: string; parts?: { PartNumber: number; ETag: string }[] };
    if (body.action === "init") {
      const token = randomUUID();
      return NextResponse.json({ token, uploadId: await createMultipart(t.incoming(token), "application/octet-stream") });
    }
    key = t.incoming(body.token ?? "");
    if (!body.uploadId) throw new UploadError("Bad upload", 400);
    if (body.action === "abort") {
      await abortMultipart(key, body.uploadId).catch(() => {});
      return NextResponse.json({ aborted: true });
    }
    if (body.action !== "complete") throw new UploadError("Bad upload", 400);
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (!parts.length || parts.length > MAX_PARTS) throw new UploadError("Bad upload", 400);
    await completeMultipart(key, body.uploadId, parts);
    const { size } = await headObject(key);
    if (size > FOOTAGE_MAX_BYTES) throw new UploadError(`That file is too large (max ${Math.round(FOOTAGE_MAX_BYTES / 2 ** 20)} MB)`, 413);
    // ffmpeg reads the assembled upload straight from MinIO (LAN) — no copy on this server's disk.
    const out = `presenters/${t.owner}/${t.id}/footage-${randomUUID()}.mp4`;
    const { seconds } = await storeNormalisedVideo(await presignGet(key, 900), out, { max: FOOTAGE_MAX_BYTES, keepSeconds: FOOTAGE_KEEP_SECONDS, minSeconds: FOOTAGE_MIN_SECONDS, what: "video" });
    if (!(await saveFootage(t.id, t.owner, out))) return new NextResponse("This presenter is already being made", { status: 409 });
    return NextResponse.json({ seconds });
  } catch (e) {
    return fail(e);
  } finally {
    // The raw upload is never kept: only the normalised footage is.
    if (key) await deleteObject(key).catch(() => {});
  }
}
