import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PostList } from "@/components/publish/post-list";
import { publishPage } from "@/lib/social/page-context";
import { listPostViews, type PostFilter } from "@/lib/social/ui";

const EMPTY: Record<string, string> = {
  all: "No posts yet.",
  drafts: "No drafts. “Save draft” in the composer keeps a post here until you're ready.",
  favorites: "No favorites yet. Star a post to keep it here for re-sharing.",
  shared: "No review links yet. Use “Copy review link” in any post's menu.",
};

/** Server component shared by Posts / Drafts / Favorites / Shared: one filtered list. */
export async function PostListPage({ filter, intro }: { filter: PostFilter; intro?: string }) {
  const sc = await publishPage();
  if (!sc) return null;
  const posts = await listPostViews(sc.workspaceId, filter);
  return (
    <div className="space-y-3">
      {intro ? <p className="text-sm text-muted-foreground">{intro}</p> : null}
      <PostList
        posts={posts}
        canApprove={sc.approver}
        empty={
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 py-6 text-sm text-muted-foreground">
              {EMPTY[filter] ?? "Nothing here."}
              <Link href="/publish/compose" className={buttonVariants({ size: "sm" })}>New post</Link>
            </CardContent>
          </Card>
        }
      />
    </div>
  );
}
