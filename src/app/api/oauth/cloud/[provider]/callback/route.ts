import { NextResponse, type NextRequest } from "next/server";
import { finishCloudOAuth } from "@/lib/cloud/oauth";
import { isCloudProvider } from "@/lib/cloud/types";

export const runtime = "nodejs";

// OAuth redirect for OneDrive, Dropbox and Box (Google Drive uses its existing /api/oauth/google/drive/callback).
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isCloudProvider(provider) || provider === "google_drive") return new NextResponse("not found", { status: 404 });
  return finishCloudOAuth(req, provider);
}
