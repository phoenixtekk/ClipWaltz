import { PostListPage } from "@/components/publish/post-list-page";

export const metadata = { title: "Posts · Publish" };

export default function PostsPage() {
  return <PostListPage filter="all" />;
}
