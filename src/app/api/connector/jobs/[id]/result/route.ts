import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { clip, connectorFromRequest, unauthorized } from "@/lib/connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 64_000; // a WaltzDeck reply is a few KB; this stops abuse (the worker parses the reply)

// The computer's answer to a job it claimed. Only that computer, only while the job is running.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await connectorFromRequest(req);
  if (!c) return unauthorized();
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { ok?: unknown; text?: unknown; error?: unknown };
  const ok = body.ok === true && typeof body.text === "string";
  if (ok && (body.text as string).length > MAX_TEXT) return Response.json({ error: "reply too large" }, { status: 413 });
  const [row] = await db
    .update(schema.connectorJobs)
    .set(
      ok
        ? { status: "done", result: body.text as string, finishedAt: new Date() }
        : { status: "failed", error: clip(body.error, 300) || "the computer reported an error", finishedAt: new Date() },
    )
    .where(and(eq(schema.connectorJobs.id, id), eq(schema.connectorJobs.connectorId, c.id), eq(schema.connectorJobs.status, "running")))
    .returning({ id: schema.connectorJobs.id });
  if (!row) return Response.json({ error: "no such running job" }, { status: 404 });
  await db.update(schema.connectors).set({ lastSeenAt: new Date() }).where(eq(schema.connectors.id, c.id));
  return Response.json({ ok: true });
}
