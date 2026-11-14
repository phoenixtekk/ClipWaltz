"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { unwrap } from "@/lib/action-result";
import { addCompetitorSource, refreshCompetitorSource, removeCompetitorSource, summarizeCompetitorSource } from "@/lib/competitor-actions";

type Post = { id: string; url: string | null; title: string | null; text: string; publishedAt: string | null };
type Source = {
  id: string; name: string; kind: string; ref: string; summary: string | null; summaryAt: string | null; lastFetchedAt: string | null;
  lastError: string | null; perWeek: number | null; posts: Post[];
};

const KINDS = [
  { key: "rss", label: "Blog / news feed (RSS or Atom)", placeholder: "https://example.com/feed" },
  { key: "bluesky", label: "Bluesky account", placeholder: "brand.bsky.social" },
  { key: "mastodon", label: "Mastodon account", placeholder: "@brand@mastodon.social" },
] as const;

// Shown so an empty list is never mistaken for "they don't post".
const NOT_AVAILABLE = [
  { name: "Facebook, Instagram, Threads", why: "no public API without the account owner's login" },
  { name: "X, LinkedIn, TikTok", why: "no public API without the account owner's login" },
  { name: "YouTube", why: "needs a YouTube Data API key (not set up yet)" },
  { name: "Meta Ad Library (their ads)", why: "needs a verified Meta developer identity; covers non-political ads only where they ran in the EU/UK" },
];

export function CompetitorBoard({ sources, canEdit }: { sources: Source[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("rss");
  const [name, setName] = useState("");
  const [ref, setRef] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      try {
        await fn();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });

  return (
    <div className="space-y-6">
      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Eye className="size-4" /> Follow a competitor</CardTitle>
            <CardDescription>Public posts only, read through each network&apos;s official public API or the site&apos;s own feed. Nothing needs their login.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const r = unwrap(await addCompetitorSource({ name, kind, ref }));
                  if ("error" in r.refresh) toast.warning(`Added, but reading it failed: ${r.refresh.error}`);
                  else toast.success(`Added — ${r.refresh.posts} recent posts.`);
                  setName("");
                  setRef("");
                  router.refresh();
                });
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="cmp-kind">Source</Label>
                <select id="cmp-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                  {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cmp-name">Name</Label>
                <Input id="cmp-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Competitor name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cmp-ref">Address or account</Label>
                <Input id="cmp-ref" required value={ref} onChange={(e) => setRef(e.target.value)} placeholder={KINDS.find((k) => k.key === kind)?.placeholder} />
              </div>
              <Button type="submit" disabled={busy || !ref.trim()}>{busy ? <Loader2 className="animate-spin" /> : null} Follow</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {sources.length === 0 ? <p className="text-sm text-muted-foreground">You&apos;re not following anyone yet.</p> : null}
      {sources.map((s) => (
        <Card key={s.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {s.name} <Badge variant="secondary">{KINDS.find((k) => k.key === s.kind)?.label ?? s.kind}</Badge>
            </CardTitle>
            <CardDescription>
              {s.ref} · {s.posts.length} recent posts{s.perWeek != null ? ` · about ${s.perWeek} a week` : ""}
              {s.lastFetchedAt ? ` · read ${new Date(s.lastFetchedAt).toLocaleString()}` : ""}
            </CardDescription>
            {s.lastError ? <p className="text-sm text-destructive">{s.lastError}</p> : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => {
                  const r = unwrap(await refreshCompetitorSource(s.id));
                  toast.success(`${r.posts} posts read.`);
                  router.refresh();
                })}><RefreshCw /> Refresh</Button>
                <Button size="sm" variant="outline" disabled={busy || s.posts.length < 3} onClick={() => run(async () => {
                  unwrap(await summarizeCompetitorSource(s.id));
                  router.refresh();
                })}><Sparkles /> AI summary</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => {
                  if (!confirm(`Stop following ${s.name}? Its saved posts are deleted.`)) return;
                  unwrap(await removeCompetitorSource(s.id));
                  router.refresh();
                })}><Trash2 /> Remove</Button>
              </div>
            ) : null}
            {s.summary ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm whitespace-pre-line">
                <p className="mb-1 text-xs text-muted-foreground">AI summary of their public posts{s.summaryAt ? ` · ${new Date(s.summaryAt).toLocaleDateString()}` : ""} — a guide, not a benchmark.</p>
                {s.summary}
              </div>
            ) : null}
            {s.posts.length ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? "Hide posts" : "Show posts"}</Button>
                {open === s.id ? (
                  <ul className="divide-y divide-border">
                    {s.posts.map((p) => (
                      <li key={p.id} className="py-2 text-sm">
                        <p className="text-xs text-muted-foreground">{p.publishedAt ? new Date(p.publishedAt).toLocaleString() : "No date"}</p>
                        {p.title ? <p className="font-medium">{p.title}</p> : null}
                        <p className="line-clamp-3">{p.text}</p>
                        {p.url ? <a className="text-xs underline" href={p.url} target="_blank" rel="noopener noreferrer nofollow">Open</a> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Not available</CardTitle>
          <CardDescription>ClipWaltz only reads what a network lets anyone read through its official API. These can&apos;t be followed here:</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {NOT_AVAILABLE.map((n) => <li key={n.name}><span className="font-medium">{n.name}</span> — {n.why}</li>)}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
