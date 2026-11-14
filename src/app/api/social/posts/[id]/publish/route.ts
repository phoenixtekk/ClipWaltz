import { requireSocial, socialErrorResponse } from "@/lib/social/access";
import { getPost } from "@/lib/social/posts";
import { publishPost } from "@/lib/social/publish-post";
import { retryTargetNow } from "@/lib/social/retry-targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/posts/<id>/publish { workspaceId?, targetId? }  editor+
//   no targetId → publish the post now (idempotent: a second call while it is publishing does nothing)
//   targetId    → retry that one failed destination now
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { workspaceId?: string; targetId?: string };
  try {
    const sc = await requireSocial(b.workspaceId ?? null, "editor");
    if (!(await getPost(sc.workspaceId, id))) return Response.json({ error: "Not found" }, { status: 404 });
    if (b.targetId) {
      const ok = await retryTargetNow(b.targetId, id);
      return ok ? Response.json({ ok: true }) : Response.json({ error: "Only a failed destination can be retried." }, { status: 409 });
    }
    const r = await publishPost(id);
    return Response.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    return socialErrorResponse(e);
  }
}
