import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  authorImage: string | null;
};

/** Most recent global chat messages, returned oldest → newest for display. */
export async function getChatMessages(limit = 50): Promise<ChatMessage[]> {
  const rows = await db
    .select({
      id: schema.chatMessages.id,
      body: schema.chatMessages.body,
      createdAt: schema.chatMessages.createdAt,
      authorId: schema.user.id,
      authorName: schema.user.name,
      authorImage: schema.user.image,
    })
    .from(schema.chatMessages)
    .innerJoin(schema.user, eq(schema.chatMessages.userId, schema.user.id))
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(limit);
  return rows
    .map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      authorId: r.authorId,
      authorName: r.authorName || "Someone",
      authorImage: r.authorImage,
    }))
    .reverse();
}
