"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SOCIAL = (process.env.NEXT_PUBLIC_AUTH_SOCIAL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const SOCIAL_LABEL: Record<string, string> = { github: "GitHub", google: "Google" };

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const sp = useSearchParams();
  const redirect = sp.get("redirect") || "/dashboard";
  const isSignUp = mode === "sign-up";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const res = isSignUp
          ? await authClient.signUp.email({ name, email, password })
          : await authClient.signIn.email({ email, password });
        if (res.error) throw new Error(res.error.message || "Authentication failed");
        router.push(redirect);
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message || "Authentication failed");
      }
    });
  }

  async function social(provider: string) {
    try {
      await authClient.signIn.social({ provider, callbackURL: redirect });
    } catch {
      toast.error(`Could not start ${SOCIAL_LABEL[provider] || provider} sign-in`);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold">{isSignUp ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isSignUp ? "Sign up to get started." : "Sign in to continue."}
        </p>
      </div>

      {SOCIAL.length > 0 ? (
        <>
          <div className="space-y-2">
            {SOCIAL.map((p) => (
              <Button key={p} type="button" variant="outline" className="w-full" onClick={() => social(p)}>
                Continue with {SOCIAL_LABEL[p] || p}
              </Button>
            ))}
          </div>
          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}

      <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-6">
        {isSignUp ? (
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus={!isSignUp}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            {!isSignUp ? (
              <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
                Forgot password?
              </Link>
            ) : null}
          </div>
          <Input
            id="password"
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            placeholder={isSignUp ? "At least 8 characters" : undefined}
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link href="/sign-in" className="text-primary hover:underline">Sign in</Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/sign-up" className="text-primary hover:underline">Create an account</Link>
          </>
        )}
      </p>
    </div>
  );
}
