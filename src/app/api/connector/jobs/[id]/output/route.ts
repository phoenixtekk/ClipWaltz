import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { connectorFromRequest, unauthorized } from "@/lib/connector";
import { deleteObject, putObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Under the app's 55 MB request limit (next.config proxyClientMaxBodySize); an 11 s 320×576 talking clip was 1.9 MB. */
const MAX_BYTES = 50 * 1024 * 1024;

// Connector v0.2 (comfy.run): the finished video, as the raw request body (video/mp4). Only the computer running the
// job, only while it runs, once. Stored at connector/<connectorId>/<jobId>.mp4; the worker copies it into the project and
// deletes it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await connectorFromRequest(req);
  if (!c) return unauthorized();
  const { id } = await params;
  if ((req.headers.get("content-type") ?? "").split(";")[0].trim() !== "video/mp4") {
    return Response.json({ error: "send the video as video/mp4" }, { status: 415 });
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return Response.json({ error: "video too large" }, { status: 413 });
  const [job] = await db
    .select({ id: schema.connectorJobs.id, outputKey: schema.connectorJobs.outputKey })
    .from(schema.connectorJobs)
    .where(and(eq(schema.connectorJobs.id, id), eq(schema.connectorJobs.connectorId, c.id),
      eq(schema.connectorJobs.status, "running"), eq(schema.connectorJobs.kind, "comfy.run")));
  if (!job) return Response.json({ error: "no such running job" }, { status: 404 });
  if (job.outputKey) return Response.json({ error: "already uploaded" }, { status: 409 });

  // Read with a running cap (content-length can be absent or wrong).
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  if (!reader) return Response.json({ error: "empty body" }, { status: 400 });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return Response.json({ error: "video too large" }, { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  // An MP4 starts with an ISO-BMFF box: bytes 4..8 are "ftyp".
  if (bytes.length < 12 || bytes.subarray(4, 8).toString("latin1") !== "ftyp") {
    return Response.json({ error: "not an MP4 video" }, { status: 415 });
  }
  const key = `connector/${c.id}/${id}.mp4`;
  await putObject(key, bytes, "video/mp4");
  const [row] = await db
    .update(schema.connectorJobs)
    .set({ outputKey: key, progress: 100 })
    .where(and(eq(schema.connectorJobs.id, id), eq(schema.connectorJobs.connectorId, c.id), eq(schema.connectorJobs.status, "running")))
    .returning({ id: schema.connectorJobs.id });
  if (!row) {
    await deleteObject(key).catch(() => {}); // the job ended (cancelled / timed out) while this was uploading
    return Response.json({ error: "no such running job" }, { status: 404 });
  }
  return Response.json({ ok: true, bytes: bytes.length });
}
