"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        // Better Auth 1.6+: requestPasswordReset (older: forgetPassword).
        const res = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
        if (res.error) throw new Error(res.error.message);
        setSent(true);
      } catch (err) {
        toast.error((err as Error).message || "Could not send reset email");
      }
    });
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold">Reset your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">We&apos;ll email you a reset link.</p>
      </div>
      {sent ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          If an account exists for <span className="font-medium text-foreground">{email}</span>, a reset
          link is on its way.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-6">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-muted-foreground">
        <Link href="/sign-in" className="text-primary hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
}
