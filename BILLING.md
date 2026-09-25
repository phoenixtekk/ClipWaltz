# ClipWaltz — Billing

**Processor: Stripe (direct)** — settled decision (Design & Build Plan §7.2). Web-first MVP,
so no App Store / Play IAP at launch.

## Principles (standing billing rules)
- All Stripe access is isolated in **one module**: `src/lib/billing/` (`stripe.ts` constructs the
  client; `index.ts` is the public surface). **Never** import `stripe` elsewhere.
- **Processor-hosted Checkout only** — no card data touches our app. No card data ever logged.
- Keys come from **env**, never hardcoded, never in `NEXT_PUBLIC_*`.

## Stripe account
- **Account id:** `acct_1UGiVdER5GAokxDi` (TEST mode) — the account the app's `sk_test_`/`pk_test_` keys belong to. Checkout verified live (`cs_test_` session created). Products carry `tax_code = txcd_10000000` because this account has **Managed Payments** on (required, else checkout errors).
- ⚠️ An earlier MCP session created products in a *different* sandbox (`acct_1UGiVjCexeLlxm8E`); those are orphaned/unused. The app + env now point at `acct_1UGiVdER…`.
- ⚠️ The Stripe MCP binds to whichever account was last authorized and drifts between projects.
  **Before any Stripe MCP work: re-auth, then verify the connected account id matches the value
  above** before writing anything. If this file still says TBD, capture the id here first.

## Tiers → price ids (env)
| Tier | Env var → price id (test) | Price | What it unlocks |
|---|---|---|---|
| Free | — | $0 | Watermark · 1080p · ~30s · 3 videos/mo · 7-day source retention |
| Plus | `STRIPE_PRICE_PLUS` = `price_1UH457ER5GAokxDibb6v4Ftu` | $15/mo | No watermark *(only while /admin → "Watermark paid plans" is off; default on since 2026-09-25 — pricing copy follows the switch)* · 1080p HD · 30 videos/mo · up to 60s · priority queue · 30-day retention |
| Pro | `STRIPE_PRICE_PRO` = `price_1UH458ER5GAokxDidE9Wrdc9` | $39/mo | Everything in Plus · fastest render · 100 videos/mo · up to 3 min · Project Vault |

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
- [x] **`STRIPE_SECRET_KEY`** present in dev + prod env (test mode). Verified 2026-09-25: key → account
      `acct_1UGiVdER5GAokxDi` (matches above).
- [x] **Webhook handling fixed + verified (2026-09-25):** `checkout.session.completed` now fetches the
      subscription (tier + period end from the subscription ITEM, API `2026-08-26.dahlia`), so the result no
      longer depends on event order (before: a subscription event arriving first was dropped and the paid user
      stayed Free). `trialing` counts as active. Tested with a real test-mode subscription (`pm_card_visa`),
      events delivered out of order to the handler, replay + forged-signature + cancel cases; cleaned up.
- Going live later needs **live** keys + a live-mode webhook + business/KYC from the dashboard.
