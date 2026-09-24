"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acceptInvite } from "@/lib/workspace-actions";
import { authClient } from "@/lib/auth-client";

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="lg"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            const r = await acceptInvite(token);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            toast.success("You've joined the workspace.");
            router.push(`/projects?ws=${r.workspaceId}`);
          } catch {
            toast.error("Something went wrong. Please try again.");
          }
        })
      }
    >
      {pending ? "Joining…" : "Accept invite"}
    </Button>
  );
}

// Invites need a verified address (sign-up doesn't force it). Sends Better Auth's verification
// email; its link returns here so the invitee can accept.
export function VerifyEmailButton({ email, callbackURL }: { email: string; callbackURL: string }) {
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        First, confirm you own <b>{email}</b>. We&apos;ll email you a link that brings you back here.
      </p>
      <Button
        size="lg"
        disabled={pending || sent}
        onClick={() =>
          start(async () => {
            const { error } = await authClient.sendVerificationEmail({ email, callbackURL });
            if (error) {
              toast.error(error.message || "Couldn't send the email. Try again.");
              return;
            }
            setSent(true);
            toast.success("Check your inbox for the verification link.");
          })
        }
      >
        {sent ? "Email sent — check your inbox" : pending ? "Sending…" : "Send verification email"}
      </Button>
    </div>
  );
}
