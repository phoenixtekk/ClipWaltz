import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { connectorFromRequest, unauthorized } from "@/lib/connector";
import { serveObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Connector v0.2 (comfy.run): one input file of a job (the photo, the speech) by its name in the job. Only the computer
// running the job, only while it runs. The storage key never leaves the server (connector_jobs.inputs).
export async function GET(req: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const c = await connectorFromRequest(req);
  if (!c) return unauthorized();
  const { id, name } = await params;
  const [job] = await db
    .select({ inputs: schema.connectorJobs.inputs })
    .from(schema.connectorJobs)
    .where(and(eq(schema.connectorJobs.id, id), eq(schema.connectorJobs.connectorId, c.id), eq(schema.connectorJobs.status, "running")));
  const inputs = (job?.inputs ?? null) as Record<string, { key: string; mime: string }> | null;
  const key = inputs && Object.hasOwn(inputs, name) ? inputs[name] : null;
  if (!key) return Response.json({ error: "no such input" }, { status: 404 });
  return serveObject(req, key.key, key.mime, { cacheControl: "private, no-store" });
}
