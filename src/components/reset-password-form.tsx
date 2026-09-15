"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get("token") || "";
  const error = sp.get("error");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const res = await authClient.resetPassword({ newPassword: password, token });
        if (res.error) throw new Error(res.error.message);
        toast.success("Password updated — sign in with your new password.");
        router.push("/sign-in");
      } catch (err) {
        toast.error((err as Error).message || "Could not reset password");
      }
    });
  }

  if (error || !token) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold">Invalid or expired link</h1>
        <p className="mt-2 text-sm text-muted-foreground">Please request a new reset link.</p>
        <p className="mt-4">
          <Link href="/forgot-password" className="text-primary hover:underline">Request a new link</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold">Choose a new password</h1>
      </div>
      <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-6">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoFocus
            placeholder="At least 8 characters"
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Updating…" : "Update password"}
        </Button>
      </form>
    </div>
  );
}
