import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { track } from "@/lib/analytics";
import { verifyWebhook, summarizeSubscription, fetchSubscriptionSummary, type SubscriptionSummary } from "@/lib/billing";

export const runtime = "nodejs";

// Minimal shape we read off checkout sessions (avoids importing Stripe types outside lib/billing).
type CheckoutSession = {
  client_reference_id?: string | null;
  customer?: string | null;
  subscription?: string | null;
};

async function latestRowFor(where: ReturnType<typeof eq>) {
  const [row] = await db.select({ id: schema.subscriptions.id, userId: schema.subscriptions.userId })
    .from(schema.subscriptions).where(where).orderBy(desc(schema.subscriptions.updatedAt)).limit(1);
  return row ?? null;
}

// Write a Stripe subscription onto the user's subscriptions row + user.plan. Idempotent (Stripe
// retries and may deliver events in any order).
async function applySummary(userId: string, s: SubscriptionSummary, deleted = false) {
  const tier = deleted || ["canceled", "incomplete_expired", "unpaid"].includes(s.status) ? "free" : s.tier;
  const patch = {
    tier,
    status: deleted ? "canceled" : s.status,
    stripeCustomerId: s.customerId,
    stripeSubscriptionId: s.subscriptionId,
    currentPeriodEnd: s.currentPeriodEnd ?? undefined,
    updatedAt: new Date(),
  };
  const existing = await latestRowFor(eq(schema.subscriptions.userId, userId));
  const [before] = await db.select({ plan: schema.user.plan }).from(schema.user).where(eq(schema.user.id, userId));
  if (existing) {
    await db.update(schema.subscriptions).set(patch).where(eq(schema.subscriptions.id, existing.id));
  } else {
    await db.insert(schema.subscriptions).values({ id: randomUUID(), userId, ...patch });
  }
  await db.update(schema.user).set({ plan: tier, updatedAt: new Date() }).where(eq(schema.user.id, userId));
  // Free → paid history (subscriptions keeps only the latest state).
  if (before && before.plan !== tier) await track("plan_changed", { userId, props: { from: before.plan, to: tier, source: "stripe", status: s.status } });
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new NextResponse("Missing stripe-signature", { status: 400 });

  let event;
  try {
    const raw = await req.text();
    event = verifyWebhook(raw, signature);
  } catch (err) {
    return new NextResponse(`Webhook error: ${(err as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      // The session carries our user id; the subscription's tier is fetched from Stripe so the
      // outcome doesn't depend on whether customer.subscription.* arrived first (Stripe doesn't
      // guarantee event order — a paid user used to stay "free" when it didn't).
      case "checkout.session.completed": {
        const s = event.data.object as unknown as CheckoutSession;
        if (s.client_reference_id && s.subscription) {
          await applySummary(s.client_reference_id, await fetchSubscriptionSummary(s.subscription));
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        // Re-fetch the CURRENT state: Stripe retries/reorders events, so an old "updated(active)" must
        // not resurrect a subscription that a later "deleted" already ended.
        const evSub = summarizeSubscription(event.data.object as unknown as Parameters<typeof summarizeSubscription>[0]);
        const sum = await fetchSubscriptionSummary(evSub.subscriptionId).catch(() => evSub);
        const row =
          (await latestRowFor(eq(schema.subscriptions.stripeSubscriptionId, sum.subscriptionId))) ??
          (await latestRowFor(eq(schema.subscriptions.stripeCustomerId, sum.customerId)));
        // Unknown yet = the checkout.session.completed event hasn't linked the user; it will.
        if (row) await applySummary(row.userId, sum, sum.status === "canceled");
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // Log and 500 so Stripe retries.
    console.error("[billing:webhook] handler error", err);
    return new NextResponse("handler error", { status: 500 });
  }

  return NextResponse.json({ received: true });
}
