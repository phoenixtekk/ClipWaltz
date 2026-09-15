import Stripe from "stripe";

// The ONLY place a Stripe client is constructed. Everything else in the app goes
// through @/lib/billing — never import "stripe" elsewhere (standing billing rule:
// isolate the processor SDK behind one module; keys come from env, never hardcoded).
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!_stripe) _stripe = new Stripe(key, { typescript: true });
  return _stripe;
}
