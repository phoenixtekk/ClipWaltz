import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAuthUserId } from "./auth";

export type FeedItem = {
  renderId: string;
  title: string;
  aspect: string;
  creator: string;
  likes: number;
  sharedAt: string;
};

const likeCount = sql<number>`(select count(*)::int from render_likes rl where rl.render_id = ${schema.renders.id})`;

/** Recent public renders for the community feed (public — no auth needed). */
export async function getPublicFeed(limit = 60): Promise<FeedItem[]> {
  const rows = await db
    .select({
      renderId: schema.renders.id,
      aspect: schema.renders.aspect,
      sharedAt: schema.renders.sharedAt,
      title: schema.projects.title,
      creator: schema.user.name,
      likes: likeCount,
    })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .innerJoin(schema.user, eq(schema.projects.ownerId, schema.user.id))
    .where(and(eq(schema.renders.visibility, "public"), isNotNull(schema.renders.outputKey)))
    .orderBy(desc(schema.renders.sharedAt))
    .limit(limit);
  return rows.map((r) => ({
    renderId: r.renderId,
    title: r.title,
    aspect: r.aspect,
    creator: r.creator || "Someone",
    likes: r.likes,
    sharedAt: (r.sharedAt ?? new Date()).toISOString(),
  }));
}

export type SharedRender = {
  renderId: string;
  title: string;
  aspect: string;
  creator: string;
  likes: number;
  likedByMe: boolean;
} | null;

/** A single shared render for the public watch page (public/unlisted only). */
export async function getSharedRender(renderId: string): Promise<SharedRender> {
  const [r] = await db
    .select({
      id: schema.renders.id,
      aspect: schema.renders.aspect,
      visibility: schema.renders.visibility,
      outputKey: schema.renders.outputKey,
      title: schema.projects.title,
      creator: schema.user.name,
      likes: likeCount,
    })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .innerJoin(schema.user, eq(schema.projects.ownerId, schema.user.id))
    .where(eq(schema.renders.id, renderId));
  if (!r || !r.outputKey || r.visibility === "private") return null;

  const uid = await getAuthUserId();
  let likedByMe = false;
  if (uid) {
    const [l] = await db
      .select({ id: schema.renderLikes.id })
      .from(schema.renderLikes)
      .where(and(eq(schema.renderLikes.renderId, renderId), eq(schema.renderLikes.userId, uid)));
    likedByMe = !!l;
  }
  return {
    renderId: r.id,
    title: r.title,
    aspect: r.aspect,
    creator: r.creator || "Someone",
    likes: r.likes,
    likedByMe,
  };
}
