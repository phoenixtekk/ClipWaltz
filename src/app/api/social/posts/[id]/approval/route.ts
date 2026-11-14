import { requireApprover, socialErrorResponse } from "@/lib/social/access";
import { decideApproval } from "@/lib/social/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/posts/<id>/approval { workspaceId?, decision: "approved" | "rejected", note? } — approvers only (D9).
// "rejected" is shown to people as "Changes requested" (G9).
// Approving does not publish by itself: a scheduled post goes out at its time, anything else via Publish.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { workspaceId?: string; decision?: string; note?: string };
  if (b.decision !== "approved" && b.decision !== "rejected") {
    return Response.json({ error: 'decision must be "approved" or "rejected"' }, { status: 400 });
  }
  try {
    const sc = await requireApprover(b.workspaceId ?? null);
    const ok = await decideApproval(sc.workspaceId, id, sc.userId, b.decision, typeof b.note === "string" ? b.note : null);
    return ok ? Response.json({ ok: true }) : Response.json({ error: "No post awaiting approval with that id." }, { status: 404 });
  } catch (e) {
    return socialErrorResponse(e);
  }
}
