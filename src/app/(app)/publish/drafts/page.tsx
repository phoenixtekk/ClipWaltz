import { PostListPage } from "@/components/publish/post-list-page";

export const metadata = { title: "Drafts · Publish" };

export default function DraftsPage() {
  // Drafts are work in progress: editor+ (a viewer still sees every post under Posts).
  return <PostListPage filter="drafts" minRole="editor" />;
}
