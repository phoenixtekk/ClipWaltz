import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { clip, connectorFromRequest, unauthorized } from "@/lib/connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Heartbeat + what the computer can run: its version and the Ollama models installed there.
export async function POST(req: Request) {
  const c = await connectorFromRequest(req);
  if (!c) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { version?: unknown; platform?: unknown; models?: unknown; error?: unknown };
  const models = Array.isArray(body.models)
    ? [...new Set(body.models.map((m) => clip(m, 100)).filter((m) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(m)))].slice(0, 100)
    : [];
  await db
    .update(schema.connectors)
    .set({
      version: clip(body.version, 20) || c.version,
      platform: clip(body.platform, 40) || c.platform,
      models,
      lastSeenAt: new Date(),
      ...(clip(body.error, 300) ? { lastError: clip(body.error, 300), lastErrorAt: new Date() } : {}),
    })
    .where(eq(schema.connectors.id, c.id));
  return Response.json({ ok: true, name: c.name, model: c.model });
}
