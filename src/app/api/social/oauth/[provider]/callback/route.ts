import type { NextRequest } from "next/server";
import { finishSocialOAuth } from "@/lib/social/oauth/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The redirect URI registered with every provider: ${APP_URL}/api/social/oauth/<provider>/callback.
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  return finishSocialOAuth(req, provider);
}
