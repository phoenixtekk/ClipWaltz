import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { sendEmail, simpleEmail } from "@/lib/email";

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
      title: schema.projects.title,
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
