import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type CommentItem = {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  authorImage: string | null;
};

/** Comments on a render, oldest first. */
export async function getRenderComments(renderId: string): Promise<CommentItem[]> {
  const rows = await db
    .select({
      id: schema.renderComments.id,
      body: schema.renderComments.body,
      createdAt: schema.renderComments.createdAt,
      authorId: schema.user.id,
      authorName: schema.user.name,
      authorImage: schema.user.image,
    })
    .from(schema.renderComments)
    .innerJoin(schema.user, eq(schema.renderComments.userId, schema.user.id))
    .where(eq(schema.renderComments.renderId, renderId))
    .orderBy(asc(schema.renderComments.createdAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    authorId: r.authorId,
    authorName: r.authorName || "Someone",
    authorImage: r.authorImage,
  }));
}
