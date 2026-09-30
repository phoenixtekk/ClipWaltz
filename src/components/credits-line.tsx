"use client";
// AI credits next to every button that starts AI work (owner decision 2026-09-29): what it costs, what's left this
// month, and — when it doesn't fit — when the allowance resets. The server enforces the same numbers (credits-server).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Coins } from "lucide-react";
import { cn } from "cn";
import { getMyCredits } from "@/lib/credits-actions";
import type { CreditBalance } from "@/lib/credits";

/** The balance, re-read whenever `refreshKey` changes (e.g. after a job starts or ends). */
export function useCredits(refreshKey: unknown = 0): CreditBalance | null {
  const [bal, setBal] = useState<CreditBalance | null>(null);
  const load = useCallback(async () => {
    try { setBal(await getMyCredits()); } catch { /* keep the last value */ }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, refreshKey]);
  return bal;
}

export const notEnough = (bal: CreditBalance | null, cost: number) => !!bal && cost > bal.left;

export function CreditsLine({ cost, balance, className }: { cost: number; balance: CreditBalance | null; className?: string }) {
  if (cost <= 0) return <p className={cn("text-[11px] text-muted-foreground", className)}>No AI credits needed.</p>;
  const short = notEnough(balance, cost);
  const reset = balance ? new Date(balance.resetsAt).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "";
  return (
    <p className={cn("inline-flex flex-wrap items-center gap-1 text-[11px]", short ? "text-destructive" : "text-muted-foreground", className)}>
      <Coins className="size-3.5" aria-hidden />
      <span>Uses {cost} AI credit{cost === 1 ? "" : "s"}</span>
      {balance ? (
        <span>
          · {balance.left} of {balance.allowance} left this month
          {short ? <> — not enough (resets {reset}). {balance.tier !== "pro" ? <Link href="/account/billing" className="underline">Get more with an upgrade</Link> : "Try a shorter clip or lower quality."}</> : null}
        </span>
      ) : null}
      {!short ? <span className="opacity-70">· refunded if it fails</span> : null}
    </p>
  );
}
