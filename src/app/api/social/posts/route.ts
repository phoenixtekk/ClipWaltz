import { requireSocial, socialErrorResponse } from "@/lib/social/access";
import { createPost, listPosts, PostInputError, type CreatePostInput } from "@/lib/social/posts";
import { publishPost } from "@/lib/social/publish-post";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  ?workspace=<id>  viewer+  → recent posts
// POST { workspaceId?, text, link?, providers[], perNetwork?, mediaIds?, scheduledAt?, status?, requireApproval?,
//        publish? }  editor+  → create; `publish: true` publishes now (queued per destination in the social worker).
// No credits are charged for publishing (ADR-0011).
export async function GET(req: Request) {
  try {
    const sc = await requireSocial(new URL(req.url).searchParams.get("workspace"), "viewer");
    return Response.json({ posts: await listPosts(sc.workspaceId) });
  } catch (e) {
    return socialErrorResponse(e);
  }
}

export async function POST(req: Request) {
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Partial<CreatePostInput> & {
    workspaceId?: string;
    scheduledAt?: string | null;
    publish?: boolean;
  };
  try {
    const sc = await requireSocial(b.workspaceId ?? null, "editor");
    const scheduledAt = b.scheduledAt ? new Date(b.scheduledAt) : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return Response.json({ error: "Invalid scheduledAt." }, { status: 400 });
    const id = await createPost(sc.workspaceId, sc.userId, {
      text: String(b.text ?? ""),
      link: b.link ?? null,
      providers: Array.isArray(b.providers) ? b.providers.map(String) : [],
      perNetwork: b.perNetwork,
      mediaIds: Array.isArray(b.mediaIds) ? b.mediaIds.map(String) : [],
      scheduledAt,
      status: b.status,
      requireApproval: b.requireApproval === true,
    });
    if (b.publish && !scheduledAt) {
      const r = await publishPost(id);
      return Response.json({ id, publish: r }, { status: r.ok ? 200 : 409 });
    }
    return Response.json({ id });
  } catch (e) {
    if (e instanceof PostInputError) return Response.json({ error: e.message }, { status: 400 });
    return socialErrorResponse(e);
  }
}
