import { HandoffQueue } from "@/components/publish/handoff-queue";
import { publishPage } from "@/lib/social/page-context";
import { handoffItems } from "@/lib/social/ui";

export const metadata = { title: "Post by hand · Publish" };

export default async function ByHandPage() {
  const sc = await publishPage();
  if (!sc) return null;
  const { waiting, done } = await handoffItems(sc.workspaceId);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Some destinations have no API: Meta removed the Facebook Groups API in April 2026. A post aimed at a group waits here with
        everything ready. Copy the text, post it in the group, then mark it posted so the post&apos;s history stays complete.
      </p>
      <HandoffQueue waiting={waiting} done={done} />
    </div>
  );
}
