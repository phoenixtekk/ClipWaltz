import { NextResponse } from "next/server";
import { runRetention } from "@/lib/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Internal: Free-plan upload retention (notice ~24 h ahead, delete after 7 days). Called every few
// hours by the generation worker on linuxg1; gated by the shared WORKER_CALLBACK_SECRET. `?dryRun=1`
// reports what would happen without emailing or deleting. Deleting also needs RETENTION_ENABLED=1.
export async function POST(req: Request) {
  const secret = process.env.WORKER_CALLBACK_SECRET;
  if (!secret || req.headers.get("x-worker-secret") !== secret) return new NextResponse("forbidden", { status: 403 });
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1" || process.env.RETENTION_ENABLED !== "1";
  const report = await runRetention({ dryRun });
  console.log(`[retention] ${JSON.stringify(report)}`);
  return NextResponse.json(report);
}
