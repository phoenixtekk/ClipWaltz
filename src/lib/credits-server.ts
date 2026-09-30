import "server-only";
import { and, eq, gte, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getEffectiveTier } from "./tier";
import { CREDIT_ALLOWANCE, nextReset, type CreditBalance } from "./credits";

// Server side of AI credits (see src/lib/credits.ts). Spend = Σ generation_jobs.credits requested by the user this
// UTC month, excluding failed / cancelled / retried jobs (their credits come back on their own).

const REFUNDED = ["failed", "cancelled", "retried"];
const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function usedThisMonth(q: typeof db | Tx, userId: string): Promise<number> {
  const [r] = await q.select({ n: sql<number>`coalesce(sum(${schema.generationJobs.credits}), 0)::int` }).from(schema.generationJobs)
    .where(and(eq(schema.generationJobs.requestedBy, userId), gte(schema.generationJobs.createdAt, monthStart()), notInArray(schema.generationJobs.status, REFUNDED)));
  return r?.n ?? 0;
}

export async function getCreditBalance(userId: string): Promise<CreditBalance> {
  const tier = await getEffectiveTier(userId);
  const allowance = CREDIT_ALLOWANCE[tier];
  const used = await usedThisMonth(db, userId);
  return { tier, allowance, used, left: Math.max(0, allowance - used), resetsAt: nextReset().toISOString() };
}

/** Thrown when a job costs more than what's left; the message is shown to the user as is. */
export class NotEnoughCredits extends Error {}

/**
 * Check the balance and insert the job in ONE transaction, serialised per user (advisory lock), so two clicks can't
 * both spend the last credits. `insert` must write the generation_jobs row with `credits: cost` through `tx`.
 */
export async function spendCredits<T>(userId: string, cost: number, insert: (tx: Tx) => Promise<T>): Promise<T> {
  const tier = await getEffectiveTier(userId);
  const allowance = CREDIT_ALLOWANCE[tier];
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credits:${userId}`}))`);
    if (cost > 0) {
      const used = await usedThisMonth(tx, userId);
      if (used + cost > allowance) {
        const left = Math.max(0, allowance - used);
        const reset = nextReset().toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
        throw new NotEnoughCredits(
          `This needs ${cost} AI credit${cost === 1 ? "" : "s"} and you have ${left} left this month (${allowance} on the ${tier === "free" ? "Free" : tier === "plus" ? "Plus" : "Pro"} plan; ` +
          `it resets on ${reset}). ${tier === "pro" ? "Try a shorter clip or a lower quality." : "Upgrade for more, or try a shorter clip."}`,
        );
      }
    }
    return insert(tx);
  });
}
