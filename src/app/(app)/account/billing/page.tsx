import { getMyBilling } from "@/lib/billing-data";
import { isStripeConfigured } from "@/lib/billing";
import { BillingClient } from "@/components/billing-client";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const billing = await getMyBilling();
  const configured = isStripeConfigured();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
          Current: {billing.tier}
        </span>
      </div>

      <BillingClient
        currentTier={billing.tier}
        configured={configured}
        hasCustomer={billing.hasCustomer}
      />

      <p className="text-xs text-muted-foreground">
        Payments are handled by Stripe&apos;s hosted checkout — card details never touch ClipWaltz.
      </p>
    </div>
  );
}
