import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getEffectiveTier, type Tier } from "./tier";

// Monthly render allowance per tier — drives the "usage vs plan" meter on the dashboard.
// null = unlimited. Kept here (not the DB) so it's easy to tune.
export const RENDER_QUOTA: Record<Tier, number | null> = {
  free: 5,
  plus: 60,
  pro: null,
};

export type DashboardStats = {
  projects: number;
  rendered: number; // finished videos (public or private)
  minutes: number; // approximate output minutes (sum of rendered project lengths)
  likes: number; // likes received across shared videos
  comments: number; // comments received across shared videos
  rendersThisMonth: number;
  tier: Tier;
  quota: number | null; // monthly render allowance (null = unlimited)
};

/** Aggregate stats for the signed-in user's dashboard. One round of small COUNT/SUM queries. */
export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const doneRender = and(
    eq(schema.projects.ownerId, userId),
    isNotNull(schema.renders.outputKey),
  );

  const [
    [{ n: projects }],
    [{ n: rendered, mins }],
    [{ n: likes }],
    [{ n: comments }],
    [{ n: rendersThisMonth }],
    tier,
  ] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.projects)
      .where(eq(schema.projects.ownerId, userId)),
    db
      .select({
        n: sql<number>`count(*)::int`,
        mins: sql<number>`coalesce(sum(${schema.projects.lengthSec}),0)::int`,
      })
      .from(schema.renders)
      .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
      .where(doneRender),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.renderLikes)
      .innerJoin(schema.renders, eq(schema.renderLikes.renderId, schema.renders.id))
      .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
      .where(eq(schema.projects.ownerId, userId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.renderComments)
      .innerJoin(schema.renders, eq(schema.renderComments.renderId, schema.renders.id))
      .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
      .where(eq(schema.projects.ownerId, userId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.renders)
      .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
      .where(and(eq(schema.projects.ownerId, userId), gte(schema.renders.createdAt, monthStart))),
    getEffectiveTier(userId),
  ]);

  return {
    projects,
    rendered,
    minutes: Math.round((mins ?? 0) / 60),
    likes,
    comments,
    rendersThisMonth,
    tier,
    quota: RENDER_QUOTA[tier],
  };
}
