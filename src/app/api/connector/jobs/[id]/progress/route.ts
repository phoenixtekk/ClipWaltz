import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { connectorFromRequest, unauthorized } from "@/lib/connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Connector v0.2 (comfy.run): progress 0–99 of a long GPU job; also a heartbeat (the worker treats a running job with no
// word from the computer for 5 minutes as lost). Answers whether the job was cancelled, so the computer can stop.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await connectorFromRequest(req);
  if (!c) return unauthorized();
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { progress?: unknown };
  const p = Math.max(0, Math.min(99, Math.round(Number(body.progress) || 0)));
  const [row] = await db
    .update(schema.connectorJobs)
    .set({ progress: p })
    .where(and(eq(schema.connectorJobs.id, id), eq(schema.connectorJobs.connectorId, c.id), eq(schema.connectorJobs.status, "running")))
    .returning({ id: schema.connectorJobs.id });
  await db.update(schema.connectors).set({ lastSeenAt: new Date() }).where(eq(schema.connectors.id, c.id));
  return Response.json({ ok: true, cancelled: !row });
}
