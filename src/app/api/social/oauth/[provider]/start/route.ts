import type { NextRequest } from "next/server";
import { startSocialOAuth } from "@/lib/social/oauth/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Begin a social-network OAuth connect for a workspace (admin+). ?workspace=<id> (default: personal workspace);
// Mastodon also takes ?instance=<host>. Per-provider logic: src/lib/social/oauth/registry.ts.
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  return startSocialOAuth(req, provider);
}
