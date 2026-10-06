import { NextResponse, after } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { sendEmail, simpleEmail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import { enqueueRenderSaves, resumeStale } from "@/lib/cloud/saves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Internal: the render worker (AI box) calls this when a render finishes so the app —
// which holds the SES creds — sends the "video ready" email. Gated by a shared secret
// (WORKER_CALLBACK_SECRET on both the app and the worker); no user cookie involved.
export async function POST(req: Request) {
  const secret = process.env.WORKER_CALLBACK_SECRET;
  if (!secret || req.headers.get("x-worker-secret") !== secret) {
    return new NextResponse("forbidden", { status: 403 });
  }

  let renderId = "";
  try {
    const j = (await req.json()) as { renderId?: string };
    renderId = String(j.renderId ?? "");
  } catch {
    /* ignore */
  }
  if (!renderId) return new NextResponse("bad request", { status: 400 });

  const [row] = await db
    .select({
      status: schema.renders.status,
      outputKey: schema.renders.outputKey,
      campaignId: schema.renders.campaignId,
      title: schema.projects.title,
      projectId: schema.projects.id,
      ownerId: schema.projects.ownerId,
      email: schema.user.email,
    })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .innerJoin(schema.user, eq(schema.projects.ownerId, schema.user.id))
    .where(eq(schema.renders.id, renderId));

  if (!row || row.status !== "done" || !row.outputKey) {
    return new NextResponse("not ready", { status: 409 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.clipwaltz.com";

  // Cloud storage auto-save (every finished video, campaign variants included) — after the response; the uploads
  // themselves run on in this process (src/lib/cloud/saves.ts). Also picks up saves a restart interrupted.
  after(() => enqueueRenderSaves(renderId).then(() => resumeStale())
    .catch((e) => console.error("[render-ready] cloud save failed:", (e as Error).message)));

  // WaltzDeck campaign pack: one notification for the whole pack, when its last variant is done (the worker renders
  // one at a time, so exactly one variant sees "nothing left").
  if (row.campaignId) {
    const [{ left }] = await db.select({ left: sql<number>`count(*)::int` }).from(schema.renders)
      .where(and(eq(schema.renders.campaignId, row.campaignId), inArray(schema.renders.status, ["queued", "rendering"])));
    if (left > 0) return NextResponse.json({ ok: true, skipped: "campaign pack still rendering" });
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.renders)
      .where(and(eq(schema.renders.campaignId, row.campaignId), eq(schema.renders.status, "done")));
    await sendPushToUser(row.ownerId, {
      title: "Your campaign pack is ready 📣", body: `${n} videos for “${row.title}” are ready to share.`,
      url: `${base}/projects/${row.projectId}/deck`, tag: `pack-${row.campaignId}`,
    }).catch((e) => console.error("[render-ready] push failed:", (e as Error).message));
    await sendEmail({
      to: row.email,
      subject: "Your campaign pack is ready 📣",
      html: simpleEmail("Your campaign pack is ready 📣", `${n} videos for “${row.title}” are ready. Turn on share links to start counting views and clicks.`,
        { label: "Open the pack", url: `${base}/projects/${row.projectId}/deck` }),
    }).catch((e) => console.error("[render-ready] email failed:", (e as Error).message));
    return NextResponse.json({ ok: true, pack: row.campaignId });
  }

  // OS push to every browser the owner opted in on (never throws; prunes dead subs).
  await sendPushToUser(row.ownerId, {
    title: "Your ClipWaltz video is ready 🎬",
    body: `“${row.title}” has finished rendering in HD.`,
    url: `${base}/projects/${row.projectId}/edit`,
    tag: `render-${renderId}`,
  }).catch((e) => console.error("[render-ready] push failed:", (e as Error).message));

  await sendEmail({
    to: row.email,
    subject: "Your ClipWaltz video is ready 🎬",
    html: simpleEmail(
      "Your video is ready 🎬",
      `“${row.title}” has finished rendering in HD — watch, download or share it now.`,
      { label: "Open ClipWaltz", url: `${base}/projects` },
    ),
    text: `Your ClipWaltz video "${row.title}" is ready: ${base}/projects`,
  });

  return NextResponse.json({ ok: true });
}
