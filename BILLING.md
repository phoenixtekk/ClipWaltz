# ClipWaltz — Billing

**Processor: Stripe (direct)** — settled decision (Design & Build Plan §7.2). Web-first MVP,
so no App Store / Play IAP at launch.

## Principles (standing billing rules)
- All Stripe access is isolated in **one module**: `src/lib/billing/` (`stripe.ts` constructs the
  client; `index.ts` is the public surface). **Never** import `stripe` elsewhere.
- **Processor-hosted Checkout only** — no card data touches our app. No card data ever logged.
- Keys come from **env**, never hardcoded, never in `NEXT_PUBLIC_*`.

## Stripe account
- **Account id:** _TBD — set on first Stripe MCP re-auth._
- ⚠️ The Stripe MCP binds to whichever account was last authorized and drifts between projects.
  **Before any Stripe MCP work: re-auth, then verify the connected account id matches the value
  above** before writing anything. If this file still says TBD, capture the id here first.

## Tiers → price ids (env)
| Tier | Env var | What it unlocks |
|---|---|---|
| Free | — | Watermark · 720p · ~30s · limited music · 7-day source retention |
| Plus | `STRIPE_PRICE_PLUS` | No watermark · 1080p · longer videos · full music library |
| Pro | `STRIPE_PRICE_PRO` | 4K · brand kit · priority render · Project Vault |

> Final prices are **back-solved from cost-per-render** (Plan §7.1) — the real-4K cost spike
> must run before prices are set. Do not hardcode prices; create them in Stripe and reference by id.

## Wiring
- **Checkout:** `createCheckoutSession({ tier, userId, email })` → subscription-mode hosted Checkout.
- **Webhook:** `POST /api/billing/webhook` verifies the signature (`STRIPE_WEBHOOK_SECRET`) and
  (P2) upserts the `subscriptions` row on `checkout.session.completed` /
  `customer.subscription.updated|deleted`. Map price→tier via `tierForPriceId()`.
- **Test mode:** use Stripe test keys + the CLI to forward webhooks in dev.

## Setup checklist (do via Stripe MCP once re-authed to the correct account)
1. Create products **Plus** and **Pro** + recurring prices → put ids in `.env`.
2. Create a webhook endpoint → `https://www.clipwaltz.com/api/billing/webhook`; store its signing secret.
3. Record the account id at the top of this file.
