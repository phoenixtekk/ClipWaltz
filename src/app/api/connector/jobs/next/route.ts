import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { connectorFromRequest, unauthorized } from "@/lib/connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Long-poll (≤ 25 s, checks every 2 s): claims the oldest queued job for this computer, or 204 when none arrived. Each
// call is also a heartbeat, so a waiting computer stays "online". One open poll per computer (per app instance): a newer
// poll ends the older one, so a token can't hold many connections open.
const openPolls = new Map<string, symbol>();

export async function GET(req: Request) {
  const c = await connectorFromRequest(req);
  if (!c) return unauthorized();
  const me = Symbol(c.id);
  openPolls.set(c.id, me);
  await db.update(schema.connectors).set({ lastSeenAt: new Date() }).where(eq(schema.connectors.id, c.id));
  const deadline = Date.now() + 25_000;
  try {
    while (Date.now() < deadline && !req.signal.aborted && openPolls.get(c.id) === me) {
      const claimed = await db.execute<{ id: string; kind: string; payload: unknown }>(sql`
      update connector_jobs set status = 'running', started_at = now()
      where id = (select id from connector_jobs where connector_id = ${c.id} and status = 'queued'
                  order by created_at limit 1 for update skip locked)
      returning id, kind, payload`);
      const job = claimed[0];
      if (job) return Response.json({ id: job.id, kind: job.kind, payload: job.payload });
      await new Promise((r) => setTimeout(r, 2000));
    }
    return new Response(null, { status: 204 });
  } finally {
    if (openPolls.get(c.id) === me) openPolls.delete(c.id);
  }
}
