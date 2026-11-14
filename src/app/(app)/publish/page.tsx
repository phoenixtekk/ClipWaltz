import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, FileText, Hand, PenSquare, Plug, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { LocalDate } from "@/components/local-date";
import { StatusBadge } from "@/components/publish/status-badge";
import { channelAllowance } from "@/lib/social/limits";
import { publishPage } from "@/lib/social/page-context";
import { publishDashboard } from "@/lib/social/ui";

export const metadata = { title: "Publish" };

export default async function PublishDashboardPage() {
  const sc = await publishPage();
  if (!sc) return null;
  const [d, allowance] = await Promise.all([publishDashboard(sc.workspaceId), channelAllowance(sc.workspaceId)]);

  const tiles = [
    { label: "Scheduled", value: d.counts.scheduled, href: "/publish/calendar", icon: CalendarClock },
    { label: "Drafts", value: d.counts.drafts, href: "/publish/drafts", icon: FileText },
    { label: "Published (30 days)", value: d.counts.published30, href: "/publish/posts", icon: CheckCircle2 },
    { label: "Failed", value: d.counts.failed, href: "/publish/posts", icon: AlertTriangle },
    { label: "Waiting for you", value: d.counts.handoff, href: "/publish/by-hand", icon: Hand },
    { label: "Awaiting approval", value: d.counts.approval, href: "/publish/posts", icon: ShieldCheck },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/publish/compose" className={buttonVariants()}><PenSquare /> New post</Link>
        <Link href="/publish/networks" className={buttonVariants({ variant: "outline" })}><Plug /> Networks</Link>
        <p className="ml-auto text-sm text-muted-foreground">Tip: every finished video has a <strong>Publish</strong> button that starts a post with it.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-xl transition-shadow hover:shadow-md">
            <Card size="sm">
              <CardContent className="space-y-1">
                <t.icon className="size-4 text-[color:var(--cw-violet)]" />
                <p className="text-2xl font-semibold tabular-nums">{t.value}</p>
                <p className="text-xs text-muted-foreground">{t.label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Coming up</CardTitle>
              <CardDescription>The next scheduled posts.</CardDescription>
            </CardHeader>
            <CardContent>
              {d.upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {d.upcoming.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="w-40 shrink-0 text-xs text-muted-foreground">{p.scheduledAt ? <LocalDate value={p.scheduledAt} /> : null}</span>
                      <Link href={`/publish/compose?post=${p.id}`} className="min-w-0 flex-1 truncate hover:underline">{p.text}</Link>
                      <span className="hidden truncate text-xs text-muted-foreground sm:block">{p.destinations.map((x) => x.label).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {d.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">No posts have gone out yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {d.recent.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                      <StatusBadge status={p.status} />
                      <Link href="/publish/posts" className="min-w-0 flex-1 truncate hover:underline">{p.text}</Link>
                      <span className="hidden text-xs text-muted-foreground sm:block">{p.publishedAt ? <LocalDate value={p.publishedAt} /> : null}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Channels</CardTitle>
            <CardDescription>
              {allowance.limit === 0 ? "Connecting channels is part of Plus and Pro." : `${allowance.used} of ${allowance.limit} on your plan`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={allowance.limit ? Math.min(100, (allowance.used / allowance.limit) * 100) : 100} aria-label="Channels used" />
            <div className="flex flex-wrap gap-2">
              <Link href="/publish/networks" className={buttonVariants({ variant: "outline", size: "sm" })}>Manage networks</Link>
              {allowance.used >= allowance.limit && allowance.tier !== "pro" ? (
                <Link href="/account/billing" className={buttonVariants({ size: "sm" })}>Upgrade</Link>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
