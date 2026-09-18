import { redirect } from "next/navigation";

// The community feed moved to /community; keep /feed as a redirect for old links.
export default function FeedRedirect() {
  redirect("/community");
}
