import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PublishCalendar } from "@/components/publish/publish-calendar";
import { workspaceBestSlots, MIN_POSTS } from "@/lib/social/best-time";
import { publishPage } from "@/lib/social/page-context";
import { calendarPosts } from "@/lib/social/ui";
import { providerName } from "@/lib/social/ui-types";

export const metadata = { title: "Calendar · Publish" };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// 6 weeks back to ~4 months ahead (the range the calendar text promises).
function range() {
  const now = Date.now();
  return { from: new Date(now - 45 * 86_400_000), to: new Date(now + 125 * 86_400_000), anchor: new Date(now).toISOString() };
}

export default async function CalendarPage() {
  const sc = await publishPage();
  if (!sc) return null;
  const w = range();
  const [posts, best] = await Promise.all([calendarPosts(sc.workspaceId, w.from, w.to), workspaceBestSlots(sc.workspaceId)]);
  return (
    <div className="space-y-4">
      {/* G6: the workspace's best slots, learnt from its own published posts (90 days). */}
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5 font-medium"><Clock className="size-4" /> Suggested times</span>
          {best.networks.length ? (
            best.networks.map((n) => (
              <span key={n.provider} className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground">{providerName(n.provider)}:</span>
                {n.slots.map((s) => (
                  <Badge key={`${s.weekday}-${s.hour}`} variant="secondary">
                    {DOW[s.weekday]} {String(s.hour).padStart(2, "0")}:00
                  </Badge>
                ))}
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">
              Not enough history yet — a network needs {MIN_POSTS} published posts with results. The composer shows general guidance until then.
            </span>
          )}
          <span className="text-xs text-muted-foreground">Times in {best.timezone}.</span>
        </CardContent>
      </Card>
      <PublishCalendar posts={posts} anchor={w.anchor} />
    </div>
  );
}
