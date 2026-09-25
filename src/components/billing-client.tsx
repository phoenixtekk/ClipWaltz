"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { startCheckout, openBillingPortal } from "@/lib/billing-actions";

const TIER_INFO = [
  { key: "free", name: "Free", blurb: "Watermark · 720p · ~30s · limited music" },
  { key: "plus", name: "Plus", blurb: "1080p · longer videos · full music library" },
  { key: "pro", name: "Pro", blurb: "4K · brand kit · priority render · Project Vault" },
];

export function BillingClient({
  currentTier,
  configured,
  hasCustomer,
  paidWatermarked,
}: {
  currentTier: string;
  configured: boolean;
  hasCustomer: boolean;
  paidWatermarked: boolean;
}) {
  const [pending, start] = useTransition();

  function upgrade(tier: "plus" | "pro") {
    start(async () => {
      try {
        const url = await startCheckout(tier);
        window.location.href = url;
      } catch (e) {
        toast.error((e as Error).message || "Could not start checkout.");
      }
    });
  }

  function portal() {
    start(async () => {
      try {
        const url = await openBillingPortal();
        window.location.href = url;
      } catch (e) {
        toast.error((e as Error).message || "Could not open the billing portal.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {!configured ? (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Billing isn&apos;t configured yet (Stripe keys pending). Tiers are shown for preview.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TIER_INFO.map((t) => {
          const isCurrent = currentTier === t.key;
          return (
            <div
              key={t.key}
              className={cn(
                "flex flex-col gap-3 rounded-xl border p-4",
                isCurrent ? "border-primary bg-primary/10" : "border-border bg-card",
              )}
            >
              <div>
                <p className="text-sm font-semibold">{t.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.key === "plus" && !paidWatermarked ? `No watermark · ${t.blurb}` : t.blurb}</p>
              </div>
              <div className="mt-auto">
                {isCurrent ? (
                  <Button size="sm" className="w-full" disabled>
                    Current plan
                  </Button>
                ) : t.key === "free" ? (
                  <span className="block text-center text-xs text-muted-foreground">
                    {hasCustomer ? "Manage below" : "—"}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!configured || pending}
                    onClick={() => upgrade(t.key as "plus" | "pro")}
                  >
                    {pending ? "…" : `Upgrade to ${t.name}`}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hasCustomer ? (
        <Button variant="outline" onClick={portal} disabled={pending}>
          Manage billing
        </Button>
      ) : null}
    </div>
  );
}
