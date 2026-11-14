import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { decide } from "@/lib/social/approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// G9 external client approval through the review link (/r/<token>) — no login. POST { decision: "approved" |
// "changes_requested", note?, name? }. The token IS the credential and is scoped to exactly one post: it decides that
// post only, and only while it is awaiting approval. Turning the link off (or deleting the post) clears the token, so a
// revoked link answers 404. Public path (src/proxy.ts PUBLIC_PATHS).
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return Response.json({ error: "Not found." }, { status: 404 });
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { decision?: string; note?: string; name?: string };
  if (b.decision !== "approved" && b.decision !== "changes_requested") {
    return Response.json({ error: "Choose Approve or Request changes." }, { status: 400 });
  }
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 2000) : "";
  if (b.decision === "changes_requested" && !note) {
    return Response.json({ error: "Say what needs to change." }, { status: 400 });
  }
  const [post] = await db
    .select({ id: schema.socialPosts.id, workspaceId: schema.socialPosts.workspaceId, approvalStatus: schema.socialPosts.approvalStatus })
    .from(schema.socialPosts)
    .where(eq(schema.socialPosts.shareToken, token));
  if (!post) return Response.json({ error: "Not found." }, { status: 404 });
  if (post.approvalStatus !== "pending") {
    return Response.json({ error: "This post is not waiting for approval any more." }, { status: 409 });
  }
  const ok = await decide({
    workspaceId: post.workspaceId,
    postId: post.id,
    decision: b.decision,
    viaToken: true,
    reviewerName: typeof b.name === "string" ? b.name : null,
    note,
  });
  if (!ok) return Response.json({ error: "This post is not waiting for approval any more." }, { status: 409 });
  return Response.json({ ok: true });
}
