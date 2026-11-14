import { isAdminEmail } from "@/lib/admin";
import { requireSocial, socialErrorResponse } from "@/lib/social/access";
import { getConnectionById, persistConnection } from "@/lib/social/connections";
import { CONNECTORS } from "@/lib/social/credentials";
import { assertChannelCapacity, ChannelLimitError } from "@/lib/social/limits";
import type { ProviderId } from "@/lib/social/publishing/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/connections/<provider>  { workspaceId?, id?, label?, …provider fields }
//
// Save a paste-credential connection (Bluesky, Telegram, Discord, Slack, Teams, Discourse, dev.to, Medium, email,
// TxtYa, Reddit, Facebook Group, Instagram, and the token-paste variants of X / YouTube / TikTok). Admin+ on the
// workspace. The credential is validated against the network first (src/lib/social/credentials.ts), then stored
// encrypted. `id` updates an existing connection of this workspace; "new" or absent adds (or updates the same account).
// Mastodon is connected through OAuth (/api/social/oauth/mastodon/start?instance=…), not here.
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const connector = (CONNECTORS as Record<string, (typeof CONNECTORS)[ProviderId]>)[provider];
  if (!connector) return Response.json({ error: "Unknown network." }, { status: 404 });

  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  try {
    const sc = await requireSocial(typeof body.workspaceId === "string" ? body.workspaceId : null, "admin");
    // The email destination sends through ClipWaltz's own SES account, so only site admins (ADMIN_EMAILS) may add one.
    if (provider === "email" && !isAdminEmail(sc.email)) {
      return Response.json({ error: "Email destinations are limited to ClipWaltz administrators." }, { status: 403 });
    }
    const id = typeof body.id === "string" && body.id ? body.id : undefined;

    // Updating a connection this workspace already has costs no channel; anything else needs room in the plan.
    const updating = id && id !== "new" ? await getConnectionById(id, sc.workspaceId) : null;
    if (!updating) await assertChannelCapacity(sc.workspaceId, 1);

    const r = await connector(body, { workspaceId: sc.workspaceId });
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status ?? 400 });

    const connId = await persistConnection(provider as ProviderId, id, r.data, sc.workspaceId, sc.userId);
    return Response.json({ ok: true, id: connId, ...(r.info ?? {}), ...(r.warning ? { warning: r.warning } : {}) });
  } catch (e) {
    if (e instanceof ChannelLimitError) return Response.json({ error: e.message, limit: e.limit }, { status: 402 });
    return socialErrorResponse(e);
  }
}
