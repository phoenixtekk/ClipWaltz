import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { getEffectiveTier } from "./tier";

export type MyBilling = {
  tier: string; // free | plus | pro
  status: string;
  hasCustomer: boolean;
};

/** Current user's billing state (effective tier + latest subscription metadata). */
export async function getMyBilling(): Promise<MyBilling> {
  const userId = await requireUserId();
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId))
    .orderBy(desc(schema.subscriptions.updatedAt))
    .limit(1);
  const tier = await getEffectiveTier(userId);
  return {
    tier,
    status: sub?.status ?? "active",
    hasCustomer: !!sub?.stripeCustomerId,
  };
}
