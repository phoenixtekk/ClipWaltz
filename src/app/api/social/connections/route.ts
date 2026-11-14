import { requireSocial, socialErrorResponse } from "@/lib/social/access";
import {
  deleteConnectionById, listConnections, publicConnection, setConnectionAiContext, setConnectionPaused,
} from "@/lib/social/connections";
import { channelAllowance } from "@/lib/social/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The workspace's connected channels (P1 API; the Networks page in P2 is built on it).
//   GET    ?workspace=<id>                         viewer+  → channels WITHOUT credentials + plan allowance
//   PATCH  { workspaceId?, id, paused?, aiContext? } admin+  → pause/resume, per-network AI brief
//   DELETE ?workspace=<id>&id=<connectionId>         admin+  → disconnect

export async function GET(req: Request) {
  try {
    const sc = await requireSocial(new URL(req.url).searchParams.get("workspace"), "viewer");
    const [conns, allowance] = await Promise.all([listConnections(sc.workspaceId), channelAllowance(sc.workspaceId)]);
    return Response.json({ workspaceId: sc.workspaceId, connections: conns.map(publicConnection), allowance });
  } catch (e) {
    return socialErrorResponse(e);
  }
}

export async function PATCH(req: Request) {
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { workspaceId?: string; id?: string; paused?: boolean; aiContext?: string | null };
  try {
    const sc = await requireSocial(b.workspaceId ?? null, "admin");
    if (!b.id) return Response.json({ error: "id is required" }, { status: 400 });
    let found = true;
    if (typeof b.paused === "boolean") found = await setConnectionPaused(b.id, b.paused, sc.workspaceId);
    if (found && b.aiContext !== undefined) await setConnectionAiContext(b.id, b.aiContext, sc.workspaceId);
    return found ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return socialErrorResponse(e);
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  try {
    const sc = await requireSocial(url.searchParams.get("workspace"), "admin");
    const id = url.searchParams.get("id") || "";
    const ok = await deleteConnectionById(id, sc.workspaceId);
    return ok ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return socialErrorResponse(e);
  }
}
