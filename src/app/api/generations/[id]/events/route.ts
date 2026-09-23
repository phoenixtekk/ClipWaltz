import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAuthUserId } from "@/lib/auth";

export const runtime = "nodejs";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

// SSE stream of a generation job's status/progress (owner-only). One persistent connection
// replaces client polling: the server reads the DB on a short interval and pushes changes,
// closing when the job reaches a terminal state (or the client disconnects).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getAuthUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });

  // Owner check once up front.
  const [own] = await db
    .select({ ownerId: schema.projects.ownerId })
    .from(schema.generationJobs)
    .innerJoin(schema.projects, eq(schema.generationJobs.projectId, schema.projects.id))
    .where(eq(schema.generationJobs.id, id));
  if (!own || own.ownerId !== userId) return new NextResponse("not found", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let last = "";
      let timer: ReturnType<typeof setInterval> | null = null;
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { close(); }
      };

      const tick = async () => {
        try {
          const [row] = await db
            .select({
              status: schema.generationJobs.status,
              progress: schema.generationJobs.progress,
              errorMessage: schema.generationJobs.errorMessage,
            })
            .from(schema.generationJobs)
            .where(eq(schema.generationJobs.id, id));
          if (!row) { send({ status: "gone" }); close(); return; }
          const key = `${row.status}:${row.progress}`;
          if (key !== last) {
            last = key;
            send({ status: row.status, progress: row.progress ?? 0, errorMessage: row.errorMessage ?? null });
          }
          if (TERMINAL.has(row.status)) close();
        } catch {
          /* transient DB hiccup — keep the stream open and retry next tick */
        }
      };

      req.signal.addEventListener("abort", close);
      void tick(); // emit current state immediately
      timer = setInterval(tick, 1500);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
