import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";

export type MyBilling = {
  tier: string; // free | plus | pro
  status: string;
  hasCustomer: boolean;
};

/** Current user's billing state (subscriptions row, falling back to user.plan). */
export async function getMyBilling(): Promise<MyBilling> {
  const userId = await requireUserId();
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId))
    .orderBy(desc(schema.subscriptions.updatedAt))
    .limit(1);
  if (sub) return { tier: sub.tier, status: sub.status, hasCustomer: !!sub.stripeCustomerId };
  const [u] = await db
    .select({ plan: schema.user.plan })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return { tier: u?.plan ?? "free", status: "active", hasCustomer: false };
}
