import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { clip, connectorFromRequest, unauthorized } from "@/lib/connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[a-z0-9][a-z0-9.-]{0,39}$/;

/** v0.2: { name, vramMb, driver } of the computer's NVIDIA GPU, or null. */
function gpuOf(v: unknown) {
  if (!v || typeof v !== "object") return null;
  const g = v as Record<string, unknown>;
  const vramMb = Math.round(Number(g.vramMb));
  if (!clip(g.name, 80) || !Number.isFinite(vramMb) || vramMb <= 0 || vramMb > 1_000_000) return null;
  return { name: clip(g.name, 80), vramMb, driver: clip(g.driver, 30) || null };
}

/** v0.2: { ok, version, error, ready: [template ids], missing: { templateId: ["what's missing"] } } of local ComfyUI. */
function comfyOf(v: unknown) {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  const ready = Array.isArray(c.ready) ? [...new Set(c.ready.map((t) => clip(t, 40)).filter((t) => ID.test(t)))].slice(0, 20) : [];
  const missing: Record<string, string[]> = {};
  if (c.missing && typeof c.missing === "object") {
    for (const [k, list] of Object.entries(c.missing as Record<string, unknown>).slice(0, 20)) {
      if (ID.test(k) && Array.isArray(list)) missing[k] = list.map((x) => clip(x, 120)).filter(Boolean).slice(0, 10);
    }
  }
  return { ok: c.ok === true, version: clip(c.version, 30) || null, error: clip(c.error, 200) || null, ready, missing };
}

// Heartbeat + what the computer can run: its version, the Ollama models installed there and (v0.2) its GPU and the
// ComfyUI templates it can run.
export async function POST(req: Request) {
  const c = await connectorFromRequest(req);
  if (!c) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { version?: unknown; platform?: unknown; models?: unknown; error?: unknown; gpu?: unknown; comfy?: unknown };
  const models = Array.isArray(body.models)
    ? [...new Set(body.models.map((m) => clip(m, 100)).filter((m) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(m)))].slice(0, 100)
    : [];
  await db
    .update(schema.connectors)
    .set({
      version: clip(body.version, 20) || c.version,
      platform: clip(body.platform, 40) || c.platform,
      models,
      // A v0.1 Connector sends neither: keep what was stored rather than wiping it.
      ...("gpu" in body ? { gpu: gpuOf(body.gpu) } : {}),
      ...("comfy" in body ? { comfy: comfyOf(body.comfy) } : {}),
      lastSeenAt: new Date(),
      ...(clip(body.error, 300) ? { lastError: clip(body.error, 300), lastErrorAt: new Date() } : {}),
    })
    .where(eq(schema.connectors.id, c.id));
  return Response.json({ ok: true, name: c.name, model: c.model });
}
