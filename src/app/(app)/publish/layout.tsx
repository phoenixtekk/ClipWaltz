import { Send } from "lucide-react";
import { getSession } from "@/lib/auth";
import { socialAllowedFor } from "@/lib/social/access";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PublishNav } from "@/components/publish/publish-nav";

export const dynamic = "force-dynamic";

// Social Publishing (ADR-0011). Behind SOCIAL_PUBLISHING_ENABLED; while the flag is off only ADMIN_EMAILS accounts
// see it (src/lib/social/access.ts). Every page re-checks access through requireSocial.
export default async function PublishLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const allowed = socialAllowedFor(session?.user.email);

  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-6">
      <div className="space-y-3">
        <h1 className="cw-gradient-text flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Send className="size-5 text-[color:var(--cw-violet)]" /> Publish
        </h1>
        {allowed ? <PublishNav /> : null}
      </div>
      {allowed ? (
        children
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Social publishing is coming soon</CardTitle>
            <CardDescription>
              Posting and scheduling your videos to social networks from ClipWaltz isn&apos;t switched on for your account yet.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
