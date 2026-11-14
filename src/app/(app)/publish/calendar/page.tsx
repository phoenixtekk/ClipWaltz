import { PublishCalendar } from "@/components/publish/publish-calendar";
import { publishPage } from "@/lib/social/page-context";
import { calendarPosts } from "@/lib/social/ui";

export const metadata = { title: "Calendar · Publish" };

// 6 weeks back to ~4 months ahead (the range the calendar text promises).
function range() {
  const now = Date.now();
  return { from: new Date(now - 45 * 86_400_000), to: new Date(now + 125 * 86_400_000), anchor: new Date(now).toISOString() };
}

export default async function CalendarPage() {
  const sc = await publishPage();
  if (!sc) return null;
  const w = range();
  const posts = await calendarPosts(sc.workspaceId, w.from, w.to);
  return <PublishCalendar posts={posts} anchor={w.anchor} />;
}
