import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export type ActiveContest = {
  id: string;
  theme: string;
  description: string | null;
  startsAt: string;
};

export type ContestEntry = {
  renderId: string;
  title: string;
  aspect: string;
  creatorId: string;
  creator: string;
  likes: number;
};

const likeCount = sql<number>`(select count(*)::int from render_likes rl where rl.render_id = ${schema.renders.id})`;

/** The single currently-active contest, if any. */
export async function getActiveContest(): Promise<ActiveContest | null> {
  const [c] = await db
    .select({
      id: schema.contests.id,
      theme: schema.contests.theme,
      description: schema.contests.description,
      startsAt: schema.contests.startsAt,
    })
    .from(schema.contests)
    .where(eq(schema.contests.status, "active"))
    .orderBy(desc(schema.contests.startsAt))
    .limit(1);
  return c ? { ...c, startsAt: c.startsAt.toISOString() } : null;
}

/** Entries for a contest, ranked by likes (votes) desc. */
export async function getContestBoard(contestId: string, limit = 60): Promise<ContestEntry[]> {
  const rows = await db
    .select({
      renderId: schema.renders.id,
      aspect: schema.renders.aspect,
      title: schema.projects.title,
      creatorId: schema.user.id,
      creator: schema.user.name,
      likes: likeCount,
    })
    .from(schema.contestEntries)
    .innerJoin(schema.renders, eq(schema.contestEntries.renderId, schema.renders.id))
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .innerJoin(schema.user, eq(schema.projects.ownerId, schema.user.id))
    .where(and(eq(schema.contestEntries.contestId, contestId), isNotNull(schema.renders.outputKey)))
    .orderBy(desc(likeCount))
    .limit(limit);
  return rows.map((r) => ({ ...r, creator: r.creator || "Someone" }));
}

/** Whether a render is entered in the given contest. */
export async function isRenderEntered(contestId: string, renderId: string): Promise<boolean> {
  const [e] = await db
    .select({ id: schema.contestEntries.id })
    .from(schema.contestEntries)
    .where(
      and(eq(schema.contestEntries.contestId, contestId), eq(schema.contestEntries.renderId, renderId)),
    );
  return !!e;
}

export type AdminContest = {
  id: string;
  theme: string;
  description: string | null;
  status: string;
  entries: number;
  winnerRenderId: string | null;
  winnerName: string | null;
  startsAt: string;
  closedAt: string | null;
};

/** All contests with entry counts + winner name (admin view). */
export async function getContestsAdmin(): Promise<AdminContest[]> {
  const entryCount = sql<number>`(select count(*)::int from contest_entries ce where ce.contest_id = ${schema.contests.id})`;
  const rows = await db
    .select({
      id: schema.contests.id,
      theme: schema.contests.theme,
      description: schema.contests.description,
      status: schema.contests.status,
      winnerRenderId: schema.contests.winnerRenderId,
      winnerUserId: schema.contests.winnerUserId,
      startsAt: schema.contests.startsAt,
      closedAt: schema.contests.closedAt,
      entries: entryCount,
    })
    .from(schema.contests)
    .orderBy(desc(schema.contests.startsAt))
    .limit(50);

  const winnerIds = rows.map((r) => r.winnerUserId).filter((x): x is string => !!x);
  const names = new Map<string, string>();
  if (winnerIds.length) {
    const us = await db
      .select({ id: schema.user.id, name: schema.user.name })
      .from(schema.user)
      .where(inArray(schema.user.id, winnerIds));
    for (const u of us) names.set(u.id, u.name || "Someone");
  }

  return rows.map((r) => ({
    id: r.id,
    theme: r.theme,
    description: r.description,
    status: r.status,
    entries: r.entries,
    winnerRenderId: r.winnerRenderId,
    winnerName: r.winnerUserId ? names.get(r.winnerUserId) ?? "Someone" : null,
    startsAt: r.startsAt.toISOString(),
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
  }));
}
