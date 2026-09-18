import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
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

/** Fetch an object as a web stream (for proxied downloads through the app). */
export async function getObject(
  key: string,
): Promise<{ body: ReadableStream; contentType?: string; size?: number }> {
  const out = await s3().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const body = (
    out.Body as unknown as { transformToWebStream: () => ReadableStream }
  ).transformToWebStream();
  return { body, contentType: out.ContentType, size: out.ContentLength };
}
