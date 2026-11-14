import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LocalDate } from "@/components/local-date";
import { publishPage } from "@/lib/social/page-context";
import { analyticsRows } from "@/lib/social/ui";
import { providerName } from "@/lib/social/ui-types";

export const metadata = { title: "Analytics · Publish" };

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
const show = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US"));

export default async function AnalyticsPage() {
  const sc = await publishPage();
  if (!sc) return null;
  const rows = await analyticsRows(sc.workspaceId);

  const byNetwork = new Map<string, typeof rows>();
  for (const r of rows) byNetwork.set(r.provider, [...(byNetwork.get(r.provider) ?? []), r]);
  const networks = [...byNetwork.entries()]
    .map(([provider, list]) => ({
      provider,
      posts: list.length,
      likes: sum(list.map((r) => r.likes)),
      comments: sum(list.map((r) => r.comments)),
      shares: sum(list.map((r) => r.shares)),
      views: sum(list.map((r) => r.views)),
      measured: list.some((r) => r.metricsAt),
    }))
    .sort((a, b) => b.posts - a.posts);
  const engagement = (r: (typeof rows)[number]) => (r.likes ?? 0) + (r.comments ?? 0) + (r.shares ?? 0);
  const top = [...rows].filter((r) => r.metricsAt).sort((a, b) => engagement(b) - engagement(a)).slice(0, 15);
  const totals = {
    posts: rows.length,
    likes: sum(rows.map((r) => r.likes)),
    comments: sum(rows.map((r) => r.comments)),
    shares: sum(rows.map((r) => r.shares)),
    views: sum(rows.map((r) => r.views)),
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The last 90 days. Numbers refresh about once an hour for Facebook, Instagram, Threads and Bluesky; other networks don&apos;t share
        them with apps, so they show as “—”.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {([
          ["Published", totals.posts],
          ["Views", totals.views],
          ["Likes", totals.likes],
          ["Comments", totals.comments],
          ["Shares", totals.shares],
        ] as const).map(([label, value]) => (
          <Card key={label} size="sm">
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString("en-US")}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By network</CardTitle>
        </CardHeader>
        <CardContent>
          {networks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing published in the last 90 days.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Network</TableHead>
                  <TableHead className="text-right">Posts</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Likes</TableHead>
                  <TableHead className="text-right">Comments</TableHead>
                  <TableHead className="text-right">Shares</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {networks.map((n) => (
                  <TableRow key={n.provider}>
                    <TableCell className="font-medium">{providerName(n.provider)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n.posts}</TableCell>
                    <TableCell className="text-right tabular-nums">{n.measured ? show(n.views) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{n.measured ? show(n.likes) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{n.measured ? show(n.comments) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{n.measured ? show(n.shares) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top posts</CardTitle>
          <CardDescription>Ranked by likes + comments + shares.</CardDescription>
        </CardHeader>
        <CardContent>
          {top.length === 0 ? (
            <p className="text-sm text-muted-foreground">No measured posts yet. Numbers appear within about an hour of publishing to a supported network.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Post</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Likes</TableHead>
                  <TableHead className="text-right">Comments</TableHead>
                  <TableHead className="text-right">Shares</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.map((r) => (
                  <TableRow key={r.targetId}>
                    <TableCell className="max-w-72 truncate">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                          {r.text} <ExternalLink className="size-3 shrink-0" />
                        </a>
                      ) : r.text}
                    </TableCell>
                    <TableCell>{r.label ?? providerName(r.provider)}</TableCell>
                    <TableCell className="text-xs">{r.publishedAt ? <LocalDate value={r.publishedAt} kind="date" /> : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{show(r.views)}</TableCell>
                    <TableCell className="text-right tabular-nums">{show(r.likes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{show(r.comments)}</TableCell>
                    <TableCell className="text-right tabular-nums">{show(r.shares)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
