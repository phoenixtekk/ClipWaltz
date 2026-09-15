import { NextResponse, type NextRequest } from "next/server";
import { verifyWebhook } from "@/lib/billing";

// Stripe webhook receiver. Verifies the signature, then (in the P2 billing
// milestone) upserts the subscriptions row. Uses the raw body — do not parse JSON
// before verifying.
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

  switch (event.type) {
    case "checkout.session.completed":
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      // TODO (P2 billing): upsert subscriptions (tier via tierForPriceId, status,
      // stripeCustomerId, stripeSubscriptionId, currentPeriodEnd).
      break;
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
