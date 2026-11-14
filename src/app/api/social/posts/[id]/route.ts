import { requireSocial, socialErrorResponse } from "@/lib/social/access";
import { getPost } from "@/lib/social/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/posts/<id>?workspace=<id> — a post with its per-destination results (viewer+).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const sc = await requireSocial(new URL(req.url).searchParams.get("workspace"), "viewer");
    const post = await getPost(sc.workspaceId, id);
    return post ? Response.json({ post }) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return socialErrorResponse(e);
  }
}
