"use server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, requireUserId } from "./auth";
import { createCheckoutSession, createPortalSession } from "./billing";

/** Start a hosted Stripe Checkout for a paid tier. Returns the redirect URL. */
export async function startCheckout(tier: "plus" | "pro"): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const userId = session.user.id;
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId))
    .orderBy(desc(schema.subscriptions.updatedAt))
    .limit(1);
  const cs = await createCheckoutSession({
    tier,
    userId,
    email: session.user.email ?? undefined,
    customerId: sub?.stripeCustomerId ?? undefined,
  });
  if (!cs.url) throw new Error("Could not create checkout session");
  return cs.url;
}

/** Open the Stripe billing portal for the current user. */
export async function openBillingPortal(): Promise<string> {
  const userId = await requireUserId();
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId))
    .orderBy(desc(schema.subscriptions.updatedAt))
    .limit(1);
  if (!sub?.stripeCustomerId) throw new Error("No billing account yet");
  const ps = await createPortalSession(sub.stripeCustomerId);
  if (!ps.url) throw new Error("Could not open billing portal");
  return ps.url;
}
