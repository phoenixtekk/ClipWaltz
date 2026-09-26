"use server";
import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { requireAdmin } from "./admin";

// Beta feedback: the "Send feedback" item in the user menu. Reviewed on /admin.
const KINDS = new Set(["idea", "bug", "praise", "other"]);
export type FeedbackItem = { id: string; email: string | null; page: string | null; kind: string; message: string; status: string; createdAt: string };

export async function submitFeedback(kind: string, message: string, page: string | null): Promise<void> {
  const userId = await requireUserId();
  const text = message.trim().slice(0, 4000);
  if (text.length < 3) throw new Error("Please write a little more");
  const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId));
  await db.insert(schema.feedback).values({
    id: randomUUID(), userId, email: u?.email ?? null,
    page: page ? page.slice(0, 200) : null, kind: KINDS.has(kind) ? kind : "other", message: text,
  });
  revalidatePath("/admin");
}

export async function listFeedback(limit = 50): Promise<FeedbackItem[]> {
  await requireAdmin();
  const rows = await db.select().from(schema.feedback).orderBy(desc(schema.feedback.createdAt)).limit(Math.min(200, limit));
  return rows.map((r) => ({ id: r.id, email: r.email, page: r.page, kind: r.kind, message: r.message, status: r.status, createdAt: r.createdAt.toISOString() }));
}

export async function setFeedbackStatus(id: string, status: "new" | "read" | "done"): Promise<void> {
  await requireAdmin();
  if (!["new", "read", "done"].includes(status)) throw new Error("Bad status");
  await db.update(schema.feedback).set({ status }).where(eq(schema.feedback.id, id));
  revalidatePath("/admin");
}
