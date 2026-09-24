"use server";
import { randomUUID } from "crypto";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { userCanAccessProject } from "./workspace";
import { requireUserId } from "./auth";
import { requireAdmin } from "./admin";
import { applyGrant } from "./tier";
import { sendEmail, simpleEmail } from "./email";

const WINNER_COMP_DAYS = 30;

/** Start a new Monthly Theme Challenge. One active contest at a time. */
export async function createContest(input: { theme: string; description?: string }): Promise<void> {
  const admin = await requireAdmin();
  const theme = input.theme.trim().slice(0, 120);
  if (!theme) throw new Error("Enter a theme");

  const [active] = await db
    .select({ id: schema.contests.id })
    .from(schema.contests)
    .where(eq(schema.contests.status, "active"))
    .limit(1);
  if (active) throw new Error("Close the current challenge before starting a new one");

  await db.insert(schema.contests).values({
    id: randomUUID(),
    theme,
    description: input.description?.trim().slice(0, 400) || null,
    createdBy: admin.user.id,
  });
  revalidatePath("/admin");
  revalidatePath("/community");
}

/**
 * Close a contest and crown the likes-leader. The winner is auto-granted Pro for
 * WINNER_COMP_DAYS via the comp system (applyGrant), and emailed.
 */
export async function closeContest(contestId: string): Promise<{ winner: string | null }> {
  await requireAdmin();
  const [c] = await db
    .select({ id: schema.contests.id, status: schema.contests.status, theme: schema.contests.theme })
    .from(schema.contests)
    .where(eq(schema.contests.id, contestId));
  if (!c) throw new Error("Contest not found");
  if (c.status !== "active") throw new Error("Contest is already closed");

  const likeCount = sql<number>`(select count(*)::int from render_likes rl where rl.render_id = ${schema.renders.id})`;
  const [top] = await db
    .select({
      renderId: schema.renders.id,
      ownerId: schema.projects.ownerId,
      email: schema.user.email,
      name: schema.user.name,
      likes: likeCount,
    })
    .from(schema.contestEntries)
    .innerJoin(schema.renders, eq(schema.contestEntries.renderId, schema.renders.id))
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .innerJoin(schema.user, eq(schema.projects.ownerId, schema.user.id))
    .where(and(eq(schema.contestEntries.contestId, contestId), isNotNull(schema.renders.outputKey)))
    .orderBy(desc(likeCount))
    .limit(1);

  let winnerName: string | null = null;
  if (top) {
    const expiresAt = new Date(Date.now() + WINNER_COMP_DAYS * 24 * 60 * 60 * 1000);
    await applyGrant(top.ownerId, "pro", expiresAt);
    winnerName = top.name || "the winner";
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.clipwaltz.com";
    await sendEmail({
      to: top.email,
      subject: `You won the ClipWaltz "${c.theme}" challenge! 🏆`,
      html: simpleEmail(
        "You won! 🏆",
        `Your video topped the <b>${c.theme}</b> Monthly Theme Challenge. We've unlocked <b>ClipWaltz Pro</b> for you for ${WINNER_COMP_DAYS} days — enjoy!`,
        { label: "Open ClipWaltz", url: `${base}/projects` },
      ),
      text: `You won the ClipWaltz "${c.theme}" challenge — Pro unlocked for ${WINNER_COMP_DAYS} days. ${base}/projects`,
    }).catch(() => {});
  }

  await db
    .update(schema.contests)
    .set({
      status: "closed",
      closedAt: new Date(),
      winnerRenderId: top?.renderId ?? null,
      winnerUserId: top?.ownerId ?? null,
    })
    .where(eq(schema.contests.id, contestId));

  revalidatePath("/admin");
  revalidatePath("/community");
  return { winner: winnerName };
}

/** Enter one of your public renders into the active contest. */
export async function enterContest(renderId: string): Promise<{ theme: string }> {
  const userId = await requireUserId();
  const [active] = await db
    .select({ id: schema.contests.id, theme: schema.contests.theme })
    .from(schema.contests)
    .where(eq(schema.contests.status, "active"))
    .orderBy(desc(schema.contests.startsAt))
    .limit(1);
  if (!active) throw new Error("No challenge is running right now");

  const [r] = await db
    .select({
      ownerId: schema.projects.ownerId,
      projectId: schema.renders.projectId,
      visibility: schema.renders.visibility,
      outputKey: schema.renders.outputKey,
    })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .where(eq(schema.renders.id, renderId));
  if (!r || r.ownerId !== userId || !(await userCanAccessProject(userId, r.projectId, "editor"))) {
    throw new Error("Render not found");
  }
  if (!r.outputKey || r.visibility !== "public") throw new Error("Make the video Public first, then enter");

  await db
    .insert(schema.contestEntries)
    .values({ id: randomUUID(), contestId: active.id, renderId, userId })
    .onConflictDoNothing();

  revalidatePath("/community");
  return { theme: active.theme };
}

/** Withdraw a render from the active contest. */
export async function withdrawContest(renderId: string): Promise<void> {
  const userId = await requireUserId();
  const [active] = await db
    .select({ id: schema.contests.id })
    .from(schema.contests)
    .where(eq(schema.contests.status, "active"))
    .orderBy(desc(schema.contests.startsAt))
    .limit(1);
  if (!active) return;
  await db
    .delete(schema.contestEntries)
    .where(
      and(
        eq(schema.contestEntries.contestId, active.id),
        eq(schema.contestEntries.renderId, renderId),
        eq(schema.contestEntries.userId, userId),
      ),
    );
  revalidatePath("/community");
}
