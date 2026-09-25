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
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";

// The default AWS SDK socket pool is 50; under bursty media traffic that enqueues hundreds of
// requests ("socket usage at capacity=50" warnings). Give it a much larger keep-alive pool.
const S3_MAX_SOCKETS = Number(process.env.S3_MAX_SOCKETS ?? 256);
const s3RequestHandler = new NodeHttpHandler({
  httpAgent: new HttpAgent({ keepAlive: true, maxSockets: S3_MAX_SOCKETS }),
  httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets: S3_MAX_SOCKETS }),
});

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
      requestHandler: s3RequestHandler,
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

// ---- Storage edge: direct browser ↔ MinIO via presigned URLs (ADR-0003) --------------------------
// S3_PUBLIC_ENDPOINT (e.g. https://media.clipwaltz.com) is MinIO's API published through the
// Cloudflare tunnel (no Access; bucket private). URLs are SIGNED FOR THAT HOST — SigV4 covers the
// Host header, which cloudflared forwards unchanged — so this client only presigns, never sends.
// The app still authorizes every request first; MEDIA_DIRECT=0 falls back to proxying.
const publicEndpoint = (process.env.S3_PUBLIC_ENDPOINT ?? "").replace(/\/$/, "");
const DOWNLOAD_TTL = 3600; // 1 h — covers a long watch session (seeks reuse the same URL)
const UPLOAD_PART_TTL = 900; // 15 min per 8 MB part

let _s3Public: S3Client | null = null;
function s3Public(): S3Client {
  if (!_s3Public) {
    _s3Public = new S3Client({
      endpoint: publicEndpoint,
      region,
      forcePathStyle: true,
      // Presigning happens before the browser has the bytes: the SDK's default flexible checksums
      // would bake the CRC32 of an EMPTY body into UploadPart URLs (x-amz-checksum-crc32=AAAAAA==).
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "",
      },
    });
  }
  return _s3Public;
}

/** True when browsers should move media bytes directly to/from MinIO (storage edge configured). */
export function directMediaEnabled(): boolean {
  return !!publicEndpoint && process.env.MEDIA_DIRECT !== "0";
}

/** Presigned GET on the public media host; `download` forces a Save-as with that filename. */
export async function presignPublicGet(key: string, opts: { download?: string } = {}): Promise<string> {
  return getSignedUrl(
    s3Public(),
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ResponseContentDisposition: opts.download ? `attachment; filename="${opts.download.replace(/["\\\r\n]/g, "_")}"` : undefined,
      // `private` keeps Cloudflare from caching signed media (it serves cache hits without
      // re-checking the signature, so an expired URL would keep working); browsers may still cache.
      ResponseCacheControl: "private, max-age=3600",
    }),
    { expiresIn: DOWNLOAD_TTL },
  );
}

/** Presigned UploadPart on the public media host (the browser PUTs the part and reads its ETag). */
export async function presignUploadPart(key: string, uploadId: string, partNumber: number): Promise<string> {
  return getSignedUrl(
    s3Public(),
    new UploadPartCommand({ Bucket: S3_BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: UPLOAD_PART_TTL },
  );
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
  // Storage edge: the caller has already authorized — hand the browser a short-lived signed URL
  // so the bytes flow MinIO → Cloudflare → browser instead of through this process.
  if (directMediaEnabled()) {
    const url = await presignPublicGet(key, { download: opts.download });
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, no-store" } });
  }
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
