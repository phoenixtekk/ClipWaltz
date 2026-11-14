import { CommentsInbox } from "@/components/publish/comments-inbox";
import { roleAtLeast } from "@/lib/workspace";
import { publishPage } from "@/lib/social/page-context";
import { commentsInbox } from "@/lib/social/ui";

export const metadata = { title: "Comments · Publish" };

export default async function CommentsPage() {
  const sc = await publishPage();
  if (!sc) return null;
  const items = await commentsInbox(sc.workspaceId);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Comments on your posts from the last 60 days on Facebook, Instagram, Threads and Bluesky. Press Refresh to fetch the latest.
        Replies are posted from the channel the post went out on.
      </p>
      <CommentsInbox items={items} canReply={roleAtLeast(sc.role, "editor")} />
    </div>
  );
}
