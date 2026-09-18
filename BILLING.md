# ClipWaltz — Billing

**Processor: Stripe (direct)** — settled decision (Design & Build Plan §7.2). Web-first MVP,
so no App Store / Play IAP at launch.

## Principles (standing billing rules)
- All Stripe access is isolated in **one module**: `src/lib/billing/` (`stripe.ts` constructs the
  client; `index.ts` is the public surface). **Never** import `stripe` elsewhere.
- **Processor-hosted Checkout only** — no card data touches our app. No card data ever logged.
- Keys come from **env**, never hardcoded, never in `NEXT_PUBLIC_*`.

## Stripe account
- **Account id:** `acct_1UGiVjCexeLlxm8E` (**ClipWaltz sandbox**, TEST mode). Verify the MCP is bound to this before any write.
- ⚠️ The Stripe MCP binds to whichever account was last authorized and drifts between projects.
  **Before any Stripe MCP work: re-auth, then verify the connected account id matches the value
  above** before writing anything. If this file still says TBD, capture the id here first.

## Tiers → price ids (env)
| Tier | Env var → price id (test) | Price | What it unlocks |
|---|---|---|---|
| Free | — | $0 | Watermark · 1080p · ~30s · 3 videos/mo · 7-day source retention |
| Plus | `STRIPE_PRICE_PLUS` = `price_1UGrZkCexeLlxm8ERjuUrEEn` | $15/mo | No watermark · 1080p HD · 30 videos/mo · up to 60s · priority queue · 30-day retention |
| Pro | `STRIPE_PRICE_PRO` = `price_1UGrZsCexeLlxm8ETnBzgmek` | $39/mo | Everything in Plus · fastest render · 100 videos/mo · up to 3 min · Project Vault |

> **Pricing decided 2026-09-17** ($0 / $15 / $39). Rationale: renders run on owned hardware
> (AI box + fleet + self-hosted MinIO), so marginal cost is ~pennies — priced on **value**,
> benchmarked to consumer/creator video SaaS, not cost-plus. `webhook endpoint` =
> `we_1UGra1CexeLlxm8EZjhfzk6j` → `https://www.clipwaltz.com/api/billing/webhook`.

## Comp / admin grants (no Stripe)
Admins (`ADMIN_EMAILS`) can grant Plus/Pro to any email at `/admin` — lifetime or with an expiry
date. A grant writes a `subscriptions` row (no Stripe ids) + `user.plan`; `getEffectiveTier`
(`src/lib/tier.ts`) treats an active, unexpired subscription (comp **or** Stripe) as the tier and
is the single gate for billing display + render watermark. Unknown emails get a pending `invites`
row that redeems on signup (Better Auth after-create hook).

## Wiring
- **Checkout:** `createCheckoutSession({ tier, userId, email })` → subscription-mode hosted Checkout.
- **Webhook:** `POST /api/billing/webhook` verifies the signature (`STRIPE_WEBHOOK_SECRET`) and
  (P2) upserts the `subscriptions` row on `checkout.session.completed` /
  `customer.subscription.updated|deleted`. Map price→tier via `tierForPriceId()`.
- **Test mode:** use Stripe test keys + the CLI to forward webhooks in dev.

## Setup status (2026-09-17, TEST mode)
- [x] Products **Plus** ($15/mo) + **Pro** ($39/mo) with recurring prices — created via MCP; ids in env.
- [x] Webhook endpoint `we_1UGra1CexeLlxm8EZjhfzk6j` created; signing secret in env (`STRIPE_WEBHOOK_SECRET`).
- [x] Account id recorded above (`acct_1UGiVjCexeLlxm8E`).
- [ ] **`STRIPE_SECRET_KEY`** — still needed: paste the ClipWaltz sandbox **test** secret key (or a
      restricted key with product/price/checkout/customer/subscription scopes) into env
      (dev `.env.local`, prod `/home/lacy/clipwaltz/.env.local`, `_keys/clipwaltz.txt`), then
      `pm2 restart clipwaltz`. Until then `isStripeConfigured()` is false and the billing page
      degrades gracefully; comp/admin grants still work (they don't touch Stripe).
- Going live later needs **live** keys + a live-mode webhook + business/KYC from the dashboard.
