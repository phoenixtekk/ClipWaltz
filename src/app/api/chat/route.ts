import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { requireUserId } from "@/lib/auth";
import { getChatMessages } from "@/lib/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Global community chat room (lightweight, polled). Read + post require auth.
export async function GET() {
  try {
    await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  const messages = await getChatMessages();
  return NextResponse.json({ messages });
}

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  let body = "";
  try {
    const j = (await req.json()) as { body?: string };
    body = (j.body ?? "").trim().slice(0, 500);
  } catch {
    /* ignore malformed */
  }
  if (!body) return new NextResponse("empty", { status: 400 });

  await db.insert(schema.chatMessages).values({ id: randomUUID(), userId, body });
  const messages = await getChatMessages();
  return NextResponse.json({ messages });
}
