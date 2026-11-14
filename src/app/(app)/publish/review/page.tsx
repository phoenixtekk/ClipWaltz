import { PostListPage } from "@/components/publish/post-list-page";

export const metadata = { title: "Approvals · Publish" };

// G9: everything waiting for an approver in the active workspace. Approvers see Approve / Request changes on each post;
// everyone else sees what is waiting (the server re-checks the approver capability on every decision).
export default function ReviewPage() {
  return (
    <PostListPage
      filter="approval"
      intro="Posts waiting for an approver. Nothing here is published until it is approved; a scheduled post goes out at its time once approved (or on the next minute if that time has passed)."
    />
  );
}
