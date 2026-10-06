import { NextResponse, type NextRequest } from "next/server";
import { startCloudOAuth } from "@/lib/cloud/oauth";
import { isCloudProvider } from "@/lib/cloud/types";

export const runtime = "nodejs";

// Begin connecting a Cloud storage provider (Google Drive, OneDrive, Dropbox, Box) — account → Cloud storage.
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isCloudProvider(provider)) return new NextResponse("not found", { status: 404 });
  return startCloudOAuth(req, provider);
}
