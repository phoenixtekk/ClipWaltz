import { PostListPage } from "@/components/publish/post-list-page";

export const metadata = { title: "Shared · Publish" };

export default function SharedPage() {
  return <PostListPage filter="shared" intro="Posts with a review link. Anyone with the link can read the post and see its media, but cannot change it. Turn a link off from the post's menu." />;
}
