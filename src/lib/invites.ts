import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { applyGrant, type Tier } from "./tier";

/**
 * Redeem the most recent unredeemed admin invite for this email into a live grant.
 * Called from the Better Auth after-create hook when a new user signs up.
 */
export async function redeemInviteForEmail(email: string, userId: string) {
  const [inv] = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.email, email.toLowerCase()), isNull(schema.invites.redeemedAt)))
    .orderBy(desc(schema.invites.createdAt))
    .limit(1);
  if (!inv) return;
  await applyGrant(userId, inv.tier as Tier, inv.expiresAt ?? null);
  await db
    .update(schema.invites)
    .set({ redeemedAt: new Date(), redeemedUserId: userId })
    .where(eq(schema.invites.id, inv.id));
}
