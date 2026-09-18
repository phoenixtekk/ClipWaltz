"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { grantAccess, revokeAccess } from "@/lib/admin-actions";

export function AdminGrantForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<"plus" | "pro">("plus");
  const [mode, setMode] = useState<"lifetime" | "expires">("lifetime");
  const [expiresAt, setExpiresAt] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const res = await grantAccess({
          email,
          tier,
          lifetime: mode === "lifetime",
          expiresAt: mode === "expires" ? expiresAt : null,
        });
        toast.success(
          res.applied === "user"
            ? `Granted ${tier} to ${email}.`
            : `Invite sent — ${email} unlocks ${tier} on signup.`,
        );
        setEmail("");
        setExpiresAt("");
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message || "Could not grant access.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="grant-email">Email</Label>
          <Input
            id="grant-email"
            type="email"
            placeholder="person@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grant-tier">Tier</Label>
          <select
            id="grant-tier"
            value={tier}
            onChange={(e) => setTier(e.target.value as "plus" | "pro")}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="plus">Plus</option>
            <option value="pro">Pro</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Duration</Label>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              checked={mode === "lifetime"}
              onChange={() => setMode("lifetime")}
            />
            Lifetime
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              checked={mode === "expires"}
              onChange={() => setMode("expires")}
            />
            Expires on
          </label>
          <Input
            type="date"
            value={expiresAt}
            disabled={mode !== "expires"}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="h-9 w-auto disabled:opacity-50"
          />
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Granting…" : "Grant access"}
      </Button>
      <p className="text-xs text-muted-foreground">
        If the email already has an account the grant applies immediately; otherwise an invite is
        emailed and access unlocks automatically when they sign up.
      </p>
    </form>
  );
}

export function RevokeButton({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Revoke paid access for ${email}?`)) return;
        start(async () => {
          try {
            await revokeAccess(userId);
            toast.success(`Revoked — ${email} is now Free.`);
            router.refresh();
          } catch (err) {
            toast.error((err as Error).message || "Could not revoke.");
          }
        });
      }}
    >
      Revoke
    </Button>
  );
}
