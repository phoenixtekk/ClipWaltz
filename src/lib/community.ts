import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export type LeaderRow = {
  userId: string;
  name: string;
  image: string | null;
  value: number;
};

const publicReady = and(
  eq(schema.renders.visibility, "public"),
  isNotNull(schema.renders.outputKey),
);

/** Creators ranked by number of public creations (Most Posted). */
export async function getTopPosters(limit = 5): Promise<LeaderRow[]> {
  const value = sql<number>`count(${schema.renders.id})::int`;
  const rows = await db
    .select({ userId: schema.user.id, name: schema.user.name, image: schema.user.image, value })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .innerJoin(schema.user, eq(schema.projects.ownerId, schema.user.id))
    .where(publicReady)
    .groupBy(schema.user.id, schema.user.name, schema.user.image)
    .orderBy(desc(value))
    .limit(limit);
  return rows.map((r) => ({ ...r, name: r.name || "Someone" }));
}

/** Creators ranked by total likes across their public creations (Top Contributors). */
export async function getTopLiked(limit = 5): Promise<LeaderRow[]> {
  const value = sql<number>`count(${schema.renderLikes.id})::int`;
  const rows = await db
    .select({ userId: schema.user.id, name: schema.user.name, image: schema.user.image, value })
    .from(schema.renderLikes)
    .innerJoin(schema.renders, eq(schema.renderLikes.renderId, schema.renders.id))
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .innerJoin(schema.user, eq(schema.projects.ownerId, schema.user.id))
    .where(publicReady)
    .groupBy(schema.user.id, schema.user.name, schema.user.image)
    .orderBy(desc(value))
    .limit(limit);
  return rows.map((r) => ({ ...r, name: r.name || "Someone" }));
}
