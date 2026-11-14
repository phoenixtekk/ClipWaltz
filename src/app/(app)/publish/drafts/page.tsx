import { PostListPage } from "@/components/publish/post-list-page";

export const metadata = { title: "Drafts · Publish" };

export default function DraftsPage() {
  return <PostListPage filter="drafts" />;
}
