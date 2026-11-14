import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PostList } from "@/components/publish/post-list";
import { RoleRequired } from "@/components/publish/role-required";
import { roleAtLeast } from "@/lib/workspace";
import { publishPage } from "@/lib/social/page-context";
import { listPostViews, type PostFilter } from "@/lib/social/ui";

const EMPTY: Record<string, string> = {
  all: "No posts yet.",
  drafts: "No drafts. “Save draft” in the composer keeps a post here until you're ready.",
  favorites: "No favorites yet. Star a post to keep it here for re-sharing.",
  shared: "No review links yet. Use “Copy review link” in any post's menu.",
  approval: "Nothing is waiting for approval.",
};

/** Server component shared by Posts / Drafts / Favorites / Shared: one filtered list. */
export async function PostListPage({ filter, intro, minRole }: { filter: PostFilter; intro?: string; minRole?: "editor" }) {
  const sc = await publishPage();
  if (!sc) return null;
  if (minRole && !roleAtLeast(sc.role, minRole)) return <RoleRequired role={sc.role} need={minRole} />;
  const posts = await listPostViews(sc.workspaceId, filter);
  return (
    <div className="space-y-3">
      {intro ? <p className="text-sm text-muted-foreground">{intro}</p> : null}
      <PostList
        posts={posts}
        canApprove={sc.approver}
        requireApproval={sc.requireApproval}
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
