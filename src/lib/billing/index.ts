import { getStripe } from "./stripe";

// ---------------------------------------------------------------------------
// ClipWaltz billing — the single billing module (direct Stripe, per settled
// decision §7.2). Processor-hosted Checkout only; no card data touches our app.
// All Stripe access flows through here so the processor stays swappable.
// ---------------------------------------------------------------------------

export type Tier = "free" | "plus" | "pro";

export const TIERS: Record<
  Tier,
  { name: string; priceId: string | null; blurb: string }
> = {
  free: { name: "Free", priceId: null, blurb: "Watermark · 720p · ~30s · limited music" },
  plus: {
    name: "Plus",
    priceId: process.env.STRIPE_PRICE_PLUS ?? null,
    blurb: "No watermark · 1080p · longer videos · full music library",
  },
  pro: {
    name: "Pro",
    priceId: process.env.STRIPE_PRICE_PRO ?? null,
    blurb: "4K · brand kit · priority render · Project Vault",
  },
};

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** Create a processor-hosted Checkout Session for a paid tier upgrade. */
export async function createCheckoutSession(opts: {
  tier: Exclude<Tier, "free">;
  userId: string;
  email?: string;
  customerId?: string;
}) {
  const priceId = TIERS[opts.tier].priceId;
  if (!priceId) throw new Error(`No Stripe price configured for tier "${opts.tier}"`);
  const base = appBaseUrl();
  return getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: opts.userId,
    ...(opts.customerId ? { customer: opts.customerId } : { customer_email: opts.email }),
    success_url: `${base}/account/billing?upgraded=1`,
    cancel_url: `${base}/account/billing`,
    allow_promotion_codes: true,
  });
}

/** Verify + parse a Stripe webhook event (raw body + signature header). */
export function verifyWebhook(rawBody: string, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}

/** Map a Stripe price id back to a ClipWaltz tier. */
export function tierForPriceId(priceId: string | null | undefined): Tier {
  if (priceId && priceId === TIERS.plus.priceId) return "plus";
  if (priceId && priceId === TIERS.pro.priceId) return "pro";
  return "free";
}

export type SubscriptionSummary = {
  subscriptionId: string;
  customerId: string;
  status: string;
  tier: Tier;
  currentPeriodEnd: Date | null;
};

/**
 * Normalise a Stripe subscription object (webhook payload or API response). API 2025-03+ (this SDK:
 * 2026-08-26.dahlia) moved `current_period_end` from the subscription onto its ITEMS, so read the
 * price and the period end from the first item.
 */
export function summarizeSubscription(sub: {
  id: string;
  customer: string | { id: string };
  status: string;
  items?: { data?: { price?: { id?: string } | null; current_period_end?: number | null }[] };
}): SubscriptionSummary {
  const item = sub.items?.data?.[0];
  return {
    subscriptionId: sub.id,
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    status: sub.status,
    tier: tierForPriceId(item?.price?.id),
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
  };
}

/** Fetch + normalise a subscription by id (used when a webhook arrives before we know the tier). */
export async function fetchSubscriptionSummary(subscriptionId: string): Promise<SubscriptionSummary> {
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  return summarizeSubscription(sub as unknown as Parameters<typeof summarizeSubscription>[0]);
}

/** Stripe-hosted billing portal (manage/cancel a subscription). */
export async function createPortalSession(customerId: string) {
  return getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appBaseUrl()}/account/billing`,
  });
}

/** Whether Stripe keys are present (page degrades gracefully when not). */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}
