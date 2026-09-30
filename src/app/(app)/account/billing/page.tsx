import { getMyBilling } from "@/lib/billing-data";
import { isStripeConfigured } from "@/lib/billing";
import { BillingClient } from "@/components/billing-client";
import { watermarkPaidPlans } from "@/lib/watermark";
import { getMyCredits } from "@/lib/credits-actions";
import { CREDIT_ALLOWANCE } from "@/lib/credits";
import { listGrantsThisMonth } from "@/lib/credits-server";
import { requireUserId } from "@/lib/auth";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const billing = await getMyBilling();
  const configured = isStripeConfigured();
  const paidWatermarked = await watermarkPaidPlans();
  const credits = await getMyCredits();
  const grants = credits.bonus ? await listGrantsThisMonth(await requireUserId()) : [];
  const reset = new Date(credits.resetsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
          Current: {billing.tier}
        </span>
      </div>

      {/* AI credits (owner decision 2026-09-29): monthly allowance per plan, failed jobs refunded automatically. */}
      <section className="cw-glass space-y-2 rounded-xl p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">AI credits</h2>
          <span className="text-sm tabular-nums">{credits.left} of {credits.allowance} left</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-[color:var(--cw-violet)]" style={{ width: `${Math.min(100, (credits.used / Math.max(1, credits.allowance)) * 100)}%` }} />
        </div>
        {grants.length ? (
          <ul className="space-y-1 rounded-lg border border-[color:var(--cw-violet)]/30 bg-[color:var(--cw-violet)]/5 p-2 text-xs">
            <li className="text-muted-foreground">Your {credits.planAllowance} plan credits + {credits.bonus} bonus this month:</li>
            {grants.map((g) => (
              <li key={g.id}>
                <span className="font-semibold tabular-nums text-[color:var(--cw-violet)]">+{g.amount}</span> bonus credits from ClipWaltz
                {g.note ? <span className="text-muted-foreground"> · {g.note}</span> : null}
              </li>
            ))}
            <li className="text-muted-foreground">Bonus credits expire at the monthly reset, like the allowance.</li>
          </ul>
        ) : null}
        <p className="text-xs text-muted-foreground">
          1 credit = 1 second of AI video (standard quality). Used by Waltz AI clips, Remix, AI enhance and WaltzDeck AI fill.
          Failed or cancelled jobs don&apos;t count. Resets on {reset}. Allowance: Free {CREDIT_ALLOWANCE.free} · Plus {CREDIT_ALLOWANCE.plus} · Pro {CREDIT_ALLOWANCE.pro} a month.
        </p>
      </section>

      <BillingClient
        currentTier={billing.tier}
        configured={configured}
        hasCustomer={billing.hasCustomer}
        paidWatermarked={paidWatermarked}
      />

      <p className="text-xs text-muted-foreground">
        Payments are handled by Stripe&apos;s hosted checkout — card details never touch ClipWaltz.
      </p>
    </div>
  );
}
