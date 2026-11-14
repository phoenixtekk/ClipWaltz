import { PostListPage } from "@/components/publish/post-list-page";

export const metadata = { title: "Favorites · Publish" };

export default function FavoritesPage() {
  return <PostListPage filter="favorites" />;
}
