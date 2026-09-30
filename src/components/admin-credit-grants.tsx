"use client";
// /admin → AI credit grants: extra credits for one user for the current month (on top of their plan's allowance;
// they expire at the monthly reset). Each grant has a note the user also sees on Billing; revoke deletes it.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocalDate } from "@/components/local-date";
import { grantCredits, revokeCreditGrant, type AdminCreditGrant } from "@/lib/admin-actions";
import { MAX_CREDIT_GRANT } from "@/lib/credits";
import { unwrap } from "@/lib/action-result";

export function AdminCreditGrants({ grants, resetsOn }: { grants: AdminCreditGrant[]; resetsOn: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("50");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [revoking, setRevoking] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const res = unwrap(await grantCredits({ email, amount: Number(amount), note }));
        toast.success(`Gave ${res.amount} credits to ${res.email} for this month.`);
        setEmail("");
        setNote("");
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message || "Could not grant the credits.");
      }
    });
  }

  function revoke(g: AdminCreditGrant) {
    if (!window.confirm(`Take back ${g.amount} credits from ${g.email}? They leave this month's balance.`)) return;
    setRevoking(g.id);
    start(async () => {
      try {
        unwrap(await revokeCreditGrant(g.id));
        toast.success(`Revoked ${g.amount} credits from ${g.email}.`);
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message || "Could not revoke the grant.");
      } finally {
        setRevoking(null);
      }
    });
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <div className="space-y-1.5">
            <Label htmlFor="credit-email">Email</Label>
            <Input id="credit-email" type="email" placeholder="person@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="credit-amount">Credits</Label>
            <Input id="credit-amount" type="number" min={1} max={MAX_CREDIT_GRANT} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="credit-note">Note (the user sees it on their Billing page)</Label>
          <Input id="credit-note" maxLength={200} placeholder="e.g. Refund for the render that failed on Sep 29" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button type="submit" disabled={pending}>{pending && !revoking ? "Granting…" : "Grant credits"}</Button>
        <p className="text-xs text-muted-foreground">
          Adds to the user&apos;s plan allowance for this month only — grants expire at the reset on {resetsOn}, like the allowance.
          The account must already exist.
        </p>
      </form>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 text-right font-medium">Credits</th>
              <th className="px-4 py-2 font-medium">Note</th>
              <th className="px-4 py-2 font-medium">Granted</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {grants.map((g) => (
              <tr key={g.id}>
                <td className="px-4 py-2">
                  <div className="font-medium">{g.name || "—"}</div>
                  <div className="text-xs text-muted-foreground">{g.email}</div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">+{g.amount}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{g.note || "—"}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  <LocalDate value={g.createdAt} options={{ dateStyle: "medium", timeStyle: "short" }} />
                  {g.grantedBy ? <div>by {g.grantedBy}</div> : null}
                </td>
                <td className="px-4 py-2 text-right">
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => revoke(g)}>{revoking === g.id ? "Revoking…" : "Revoke"}</Button>
                </td>
              </tr>
            ))}
            {grants.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No credit grants this month.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
