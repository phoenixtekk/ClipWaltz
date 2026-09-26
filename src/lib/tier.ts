import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type Tier = "free" | "plus" | "pro";

/**
 * Effective tier for a user. An active, unexpired subscription (comp grant or Stripe)
 * wins; a canceled/expired one drops to free; otherwise the `user.plan` column. This is
 * the single source of truth for tier gating (billing display + render watermark).
 */
export async function getEffectiveTier(userId: string): Promise<Tier> {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId))
    .orderBy(desc(schema.subscriptions.updatedAt))
    .limit(1);
  if (sub) {
    const active = sub.status === "active" || sub.status === "trialing";
    const notExpired = !sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() > Date.now();
    return active && notExpired ? ((sub.tier as Tier) ?? "free") : "free";
  }
  const [u] = await db
    .select({ plan: schema.user.plan })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return (u?.plan as Tier) ?? "free";
}

/**
 * Upsert a comp/paid grant: a subscriptions row (no Stripe ids) + the `user.plan` column.
 * expiresAt null = lifetime. tier "free" revokes.
 */
export async function applyGrant(userId: string, tier: Tier, expiresAt: Date | null) {
  const status = tier === "free" ? "canceled" : "active";
  const [before] = await db.select({ plan: schema.user.plan }).from(schema.user).where(eq(schema.user.id, userId));
  const [existing] = await db
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId))
    .orderBy(desc(schema.subscriptions.updatedAt))
    .limit(1);
  if (existing) {
    await db
      .update(schema.subscriptions)
      .set({ tier, status, currentPeriodEnd: expiresAt, updatedAt: new Date() })
      .where(eq(schema.subscriptions.id, existing.id));
  } else {
    await db.insert(schema.subscriptions).values({
      id: randomUUID(),
      userId,
      tier,
      status,
      currentPeriodEnd: expiresAt ?? undefined,
    });
  }
  await db.update(schema.user).set({ plan: tier, updatedAt: new Date() }).where(eq(schema.user.id, userId));
  if (before && before.plan !== tier) {
    const { track } = await import("./analytics");
    await track("plan_changed", { userId, props: { from: before.plan, to: tier, source: "grant", expires: expiresAt ? expiresAt.toISOString() : null } });
  }
}
