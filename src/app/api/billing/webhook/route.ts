import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { verifyWebhook, tierForPriceId } from "@/lib/billing";

export const runtime = "nodejs";

// Minimal shapes we read off Stripe events (avoids importing the full Stripe types here).
type CheckoutSession = {
  client_reference_id?: string | null;
  customer?: string | null;
  subscription?: string | null;
};
type Subscription = {
  id: string;
  customer: string;
  status: string;
  current_period_end?: number;
  items?: { data?: { price?: { id?: string } }[] };
};

async function upsertByUser(userId: string, patch: Partial<typeof schema.subscriptions.$inferInsert>) {
  const [existing] = await db
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId))
    .orderBy(desc(schema.subscriptions.updatedAt))
    .limit(1);
  if (existing) {
    await db
      .update(schema.subscriptions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.subscriptions.id, existing.id));
  } else {
    await db.insert(schema.subscriptions).values({
      id: randomUUID(),
      userId,
      tier: patch.tier ?? "free",
      status: patch.status ?? "active",
      ...patch,
    });
  }
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
      case "checkout.session.completed": {
        const s = event.data.object as unknown as CheckoutSession;
        if (s.client_reference_id) {
          await upsertByUser(s.client_reference_id, {
            stripeCustomerId: s.customer ?? undefined,
            stripeSubscriptionId: s.subscription ?? undefined,
            status: "active",
          });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as unknown as Subscription;
        const priceId = sub.items?.data?.[0]?.price?.id;
        const tier = event.type === "customer.subscription.deleted" ? "free" : tierForPriceId(priceId);
        const patch = {
          tier,
          status: sub.status,
          stripeSubscriptionId: sub.id,
          currentPeriodEnd: sub.current_period_end
            ? new Date(sub.current_period_end * 1000)
            : undefined,
        };
        await db
          .update(schema.subscriptions)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(schema.subscriptions.stripeCustomerId, sub.customer));
        const [row] = await db
          .select({ userId: schema.subscriptions.userId })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.stripeCustomerId, sub.customer));
        if (row) {
          await db
            .update(schema.user)
            .set({ plan: tier, updatedAt: new Date() })
            .where(eq(schema.user.id, row.userId));
        }
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
