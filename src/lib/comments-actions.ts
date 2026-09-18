"use server";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId, getSession } from "./auth";
import { isAdminEmail } from "./admin";
import { getRenderComments, type CommentItem } from "./comments";

/** Re-fetch a render's comments (used by the client to refresh). */
export async function listRenderComments(renderId: string): Promise<CommentItem[]> {
  return getRenderComments(renderId);
}

/** Post a comment on a shared (non-private) render. Returns the full updated thread. */
export async function addRenderComment(renderId: string, body: string): Promise<CommentItem[]> {
  const userId = await requireUserId();
  const text = body.trim().slice(0, 1000);
  if (!text) throw new Error("Comment can't be empty");

  const [r] = await db
    .select({ visibility: schema.renders.visibility, outputKey: schema.renders.outputKey })
    .from(schema.renders)
    .where(eq(schema.renders.id, renderId));
  if (!r || !r.outputKey || r.visibility === "private") throw new Error("Not available");

  await db.insert(schema.renderComments).values({ id: randomUUID(), renderId, userId, body: text });
  return getRenderComments(renderId);
}

/** Delete a comment — the author or an admin. Returns the updated thread. */
export async function deleteRenderComment(commentId: string): Promise<CommentItem[]> {
  const userId = await requireUserId();
  const [c] = await db
    .select({ userId: schema.renderComments.userId, renderId: schema.renderComments.renderId })
    .from(schema.renderComments)
    .where(eq(schema.renderComments.id, commentId));
  if (!c) throw new Error("Not found");

  const session = await getSession();
  const admin = session ? isAdminEmail(session.user.email) : false;
  if (c.userId !== userId && !admin) throw new Error("Not allowed");

  await db.delete(schema.renderComments).where(eq(schema.renderComments.id, commentId));
  return getRenderComments(c.renderId);
}
