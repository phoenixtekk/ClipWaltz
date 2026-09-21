import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// S3-compatible client for the self-hosted MinIO on linuxg7 (bucket `clipwaltz`).
// forcePathStyle is required for MinIO. Credentials are a bucket-scoped service
// account (least privilege), from env — never hardcoded.
const endpoint = process.env.S3_ENDPOINT ?? "http://192.168.166.169:9000";
const region = process.env.S3_REGION ?? "us-east-1";
export const S3_BUCKET = process.env.S3_BUCKET ?? "clipwaltz";

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "",
      },
    });
  }
  return _s3;
}

export async function putObject(key: string, body: Uint8Array, contentType?: string) {
  await s3().send(
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

// ---- Resumable multipart upload (proxied — MinIO stays LAN-only) --------------
export async function createMultipart(key: string, contentType?: string): Promise<string> {
  const out = await s3().send(
    new CreateMultipartUploadCommand({ Bucket: S3_BUCKET, Key: key, ContentType: contentType }),
  );
  if (!out.UploadId) throw new Error("no upload id");
  return out.UploadId;
}

export async function uploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  body: Uint8Array,
): Promise<string> {
  const out = await s3().send(
    new UploadPartCommand({ Bucket: S3_BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body }),
  );
  if (!out.ETag) throw new Error("no etag");
  return out.ETag;
}

export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[],
): Promise<void> {
  await s3().send(
    new CompleteMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: [...parts].sort((a, b) => a.PartNumber - b.PartNumber) },
    }),
  );
}

export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  await s3().send(new AbortMultipartUploadCommand({ Bucket: S3_BUCKET, Key: key, UploadId: uploadId }));
}

/** Short-lived presigned GET URL (viewer must be able to reach the MinIO endpoint). */
export async function presignGet(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn });
}

/** Fetch an object's raw bytes (small objects only — e.g. a photo for WaltzMatch analysis). */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const out = await s3().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  return (out.Body as unknown as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
}

/**
 * Fetch an object as a web stream (for proxied downloads through the app). Pass the request's
 * AbortSignal so a client disconnect cancels the S3 read; the returned stream is wrapped so a
 * client abort can't throw "Controller is already closed" up as an uncaught exception.
 */
export async function getObject(
  key: string,
  signal?: AbortSignal,
): Promise<{ body: ReadableStream; contentType?: string; size?: number }> {
  const out = await s3().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { abortSignal: signal });
  const src = (
    out.Body as unknown as { transformToWebStream: () => ReadableStream<Uint8Array> }
  ).transformToWebStream();
  const reader = src.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch {
        try { controller.close(); } catch { /* already closed on abort */ }
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    },
  });
  return { body, contentType: out.ContentType, size: out.ContentLength };
}

// Above this response size we STREAM from S3 instead of buffering the whole thing into memory.
// Buffering the full object (the old behaviour) let a single large download — e.g. a `.insv`
// original or a big render, or any request with `Range: bytes=0-` — pull multi-GB into the app
// process (observed: ~21 GB RSS, event loop pegged, every route timing out). 16 MB comfortably
// covers thumbnails, short audio, and typical media range chunks via the fast buffered path.
const STREAM_THRESHOLD = 16 * 1024 * 1024;

/**
 * Serve a MinIO object over HTTP with Range support, WITHOUT ever buffering a whole large object.
 *
 * - Learns size + type with a cheap HEAD (no body).
 * - Responses ≤ STREAM_THRESHOLD are buffered (fast, and the historically hang-free path).
 * - Larger responses are streamed straight from the ranged S3 body (bounded memory). We set an
 *   explicit `Content-Length`, which is what lets Next flush the stream instead of stalling
 *   (the earlier "streamed body hangs / code 000" was a Content-Length-less stream).
 * - `Accept-Ranges` + 206 give `<audio>`/`<video>` proper seeking; `bytes=0-` no longer OOMs.
 */
export async function serveObject(
  req: Request,
  key: string,
  fallbackType: string,
  opts: { download?: string; cacheControl?: string } = {},
): Promise<Response> {
  const cacheControl = opts.cacheControl ?? "private, max-age=3600";
  const rangeHeader = req.headers.get("range");
  const m = rangeHeader ? /bytes=(\d+)-(\d*)/.exec(rangeHeader) : null;

  const head = await s3().send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const totalSize = Number(head.ContentLength ?? 0);
  const contentType = head.ContentType ?? fallbackType;

  let start = 0;
  let end = totalSize > 0 ? totalSize - 1 : 0;
  let status = 200;
  if (m) {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), totalSize - 1) : totalSize - 1;
    if (totalSize > 0 && (start >= totalSize || start > end)) {
      return new Response(null, {
        status: 416,
        headers: { "accept-ranges": "bytes", "content-range": `bytes */${totalSize}` },
      });
    }
    status = 206;
  }
  const length = totalSize > 0 ? end - start + 1 : 0;
  const rangeSpec = status === 206 && totalSize > 0 ? `bytes=${start}-${end}` : undefined;

  const headers: Record<string, string> = {
    "content-type": contentType,
    "accept-ranges": "bytes",
    "cache-control": cacheControl,
  };
  if (totalSize > 0) headers["content-length"] = String(length);
  if (opts.download) headers["content-disposition"] = `attachment; filename="${opts.download}"`;
  if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${totalSize}`;

  const out = await s3().send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key, Range: rangeSpec }),
    { abortSignal: req.signal },
  );

  // Small enough → buffer (fast, hang-free).
  if (totalSize > 0 && length <= STREAM_THRESHOLD) {
    const bytes = await (
      out.Body as unknown as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return new Response(bytes as unknown as BodyInit, { status, headers });
  }

  // Large (or unknown size) → stream the ranged body; memory stays bounded to in-flight chunks.
  const webStream = (
    out.Body as unknown as { transformToWebStream: () => ReadableStream<Uint8Array> }
  ).transformToWebStream();
  return new Response(webStream as unknown as BodyInit, { status, headers });
}
