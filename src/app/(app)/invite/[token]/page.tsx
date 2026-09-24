import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getInvitePreview } from "@/lib/workspace-actions";
import { withArticle } from "@/lib/workspace";
import { AcceptInviteButton, VerifyEmailButton } from "@/components/accept-invite-button";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Workspace invite" };

const STATUS_TEXT = {
  invalid: "This invite link isn't valid.",
  expired: "This invite has expired. Ask for a new one.",
  used: "This invite has already been used.",
  revoked: "This invite was withdrawn. Ask for a new one if you still need access.",
} as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [preview, session] = await Promise.all([getInvitePreview(token), getSession()]);
  const myEmail = session?.user.email?.toLowerCase() ?? "";
  const verified = !!session?.user.emailVerified;

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="cw-glass space-y-4 rounded-2xl p-6 text-center">
        {preview.status === "ok" ? (
          <>
            <h1 className="cw-gradient-text text-2xl font-semibold">Join “{preview.workspaceName}”</h1>
            <p className="text-sm text-muted-foreground">
              {preview.inviterName ?? "Someone"} invited you as <b>{withArticle(preview.role)}</b>.
            </p>
            {myEmail === preview.email && !verified ? (
              <VerifyEmailButton email={preview.email} callbackURL={`/invite/${token}`} />
            ) : myEmail === preview.email ? (
              <AcceptInviteButton token={token} />
            ) : (
              <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                This invite was sent to <b>{preview.email}</b>, but you&apos;re signed in as <b>{myEmail}</b>. Sign out
                and sign in (or create an account) with the invited address to accept.
              </p>
            )}
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Invite unavailable</h1>
            <p className="text-sm text-muted-foreground">{STATUS_TEXT[preview.status]}</p>
            <Button render={<Link href="/projects" />} variant="outline">
              Go to your projects
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
