import "server-only";
import { and, asc, eq, gte, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getEffectiveTier } from "./tier";
import { CREDIT_ALLOWANCE, nextReset, type CreditBalance } from "./credits";

// Server side of AI credits (see src/lib/credits.ts). Spend = Σ generation_jobs.credits requested by the user this
// UTC month, excluding failed / cancelled / retried jobs (their credits come back on their own). The month's
// allowance = the plan's + admin grants made this UTC month (credit_grants; they expire at the reset).

const REFUNDED = ["failed", "cancelled", "retried"];
export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function usedThisMonth(q: typeof db | Tx, userId: string): Promise<number> {
  const [r] = await q.select({ n: sql<number>`coalesce(sum(${schema.generationJobs.credits}), 0)::int` }).from(schema.generationJobs)
    .where(and(eq(schema.generationJobs.requestedBy, userId), gte(schema.generationJobs.createdAt, monthStart()), notInArray(schema.generationJobs.status, REFUNDED)));
  return r?.n ?? 0;
}

async function grantedThisMonth(q: typeof db | Tx, userId: string): Promise<number> {
  const [r] = await q.select({ n: sql<number>`coalesce(sum(${schema.creditGrants.amount}), 0)::int` }).from(schema.creditGrants)
    .where(and(eq(schema.creditGrants.userId, userId), gte(schema.creditGrants.createdAt, monthStart())));
  return r?.n ?? 0;
}

/** This month's grants for one user (Billing page). */
export async function listGrantsThisMonth(userId: string) {
  return db.select({ id: schema.creditGrants.id, amount: schema.creditGrants.amount, note: schema.creditGrants.note, createdAt: schema.creditGrants.createdAt })
    .from(schema.creditGrants)
    .where(and(eq(schema.creditGrants.userId, userId), gte(schema.creditGrants.createdAt, monthStart())))
    .orderBy(asc(schema.creditGrants.createdAt));
}

export async function getCreditBalance(userId: string): Promise<CreditBalance> {
  const tier = await getEffectiveTier(userId);
  const planAllowance = CREDIT_ALLOWANCE[tier];
  const [used, bonus] = await Promise.all([usedThisMonth(db, userId), grantedThisMonth(db, userId)]);
  const allowance = planAllowance + bonus;
  return { tier, allowance, planAllowance, bonus, used, left: Math.max(0, allowance - used), resetsAt: nextReset().toISOString() };
}

/** Thrown when a job costs more than what's left; the message is shown to the user as is. */
export class NotEnoughCredits extends Error {}

/**
 * Check the balance and insert the job in ONE transaction, serialised per user (advisory lock), so two clicks can't
 * both spend the last credits. `insert` must write the generation_jobs row with `credits: cost` through `tx`.
 */
export async function spendCredits<T>(userId: string, cost: number, insert: (tx: Tx) => Promise<T>): Promise<T> {
  const tier = await getEffectiveTier(userId);
  const planAllowance = CREDIT_ALLOWANCE[tier];
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credits:${userId}`}))`);
    if (cost > 0) {
      const [used, bonus] = await Promise.all([usedThisMonth(tx, userId), grantedThisMonth(tx, userId)]);
      const allowance = planAllowance + bonus;
      if (used + cost > allowance) {
        const left = Math.max(0, allowance - used);
        const reset = nextReset().toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
        const plan = `${planAllowance} on the ${tier === "free" ? "Free" : tier === "plus" ? "Plus" : "Pro"} plan${bonus ? ` + ${bonus} bonus` : ""}`;
        throw new NotEnoughCredits(
          `This needs ${cost} AI credit${cost === 1 ? "" : "s"} and you have ${left} left this month (${plan}; ` +
          `it resets on ${reset}). ${tier === "pro" ? "Try a shorter clip or a lower quality." : "Upgrade for more, or try a shorter clip."}`,
        );
      }
    }
    return insert(tx);
  });
}
