"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, ImageUp, Mic, Pencil, Plus, Rss, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { LocalDate } from "@/components/local-date";
import { unwrap } from "@/lib/action-result";
import { removePodcastEpisode, savePodcastShow, setPodcastShowActive, uploadPodcastCover } from "@/lib/social/p5-actions";
import type { ShowSummary } from "@/lib/podcast/shows";

interface Draft {
  id?: string;
  title: string;
  description: string;
  author: string;
  category: string;
  subcategory: string;
  language: string;
  explicit: boolean;
  link: string;
  copyright: string;
  slug: string;
  locked: boolean; // has episodes: the address can't change
}

function toDraft(s: ShowSummary | null): Draft {
  return {
    id: s?.id,
    title: s?.title ?? "",
    description: s?.description ?? "",
    author: s?.author ?? "",
    category: s?.category ?? "Technology",
    subcategory: s?.subcategory ?? "",
    language: s?.language ?? "en-us",
    explicit: s?.explicit ?? false,
    link: s?.link ?? "",
    copyright: s?.copyright ?? "",
    slug: s?.slug ?? "",
    locked: Boolean(s?.episodes.length),
  };
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

/** Publish → Podcast: self-hosted shows with an Apple-compliant RSS feed, episodes and download counts. */
export function PodcastStudio({
  shows,
  categories,
  canManage,
}: {
  shows: ShowSummary[];
  categories: Record<string, string[]>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [coverFor, setCoverFor] = useState<string | null>(null);

  function run(fn: () => Promise<unknown>, ok?: string) {
    start(async () => {
      try {
        await fn();
        if (ok) toast.success(ok);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const subs = draft ? categories[draft.category] ?? [] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Host a podcast here: each show has a public RSS feed you submit once to Apple Podcasts, Spotify and the rest.
          Episodes come from explainer videos sent to the show — their audio becomes the episode. Downloads are counted the
          IAB way (one per listener per day, after a minute of audio), with no cookies and no stored IP addresses.
        </p>
        {canManage ? <Button onClick={() => setDraft(toDraft(null))}><Plus /> New show</Button> : null}
      </div>

      {shows.length === 0 ? (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">No shows yet.</CardContent></Card>
      ) : null}

      {shows.map((s) => (
        <Card key={s.id}>
          <CardHeader>
            <div className="flex flex-wrap items-start gap-4">
              {s.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- the public cover route, not a static asset
                <img src={s.coverUrl} alt="" className="size-24 rounded-lg border border-border object-cover" />
              ) : (
                <div className="flex size-24 items-center justify-center rounded-lg border border-border"><Mic className="size-6 text-muted-foreground" /></div>
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {s.title}
                  {s.active ? <Badge variant="secondary">Live</Badge> : <Badge variant="outline">Off</Badge>}
                </CardTitle>
                <CardDescription className="line-clamp-2">{s.description}</CardDescription>
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  <Rss className="size-3.5" />
                  <code className="truncate">{s.feedUrl}</code>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => navigator.clipboard.writeText(s.feedUrl).then(() => toast.success("Feed address copied."))}
                  >
                    <Copy /> Copy
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setDraft(toDraft(s))}><Pencil /> Edit</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { setCoverFor(s.id); fileRef.current?.click(); }}>
                  <ImageUp /> Upload cover (JPEG, square, 1400–3000 px)
                </Button>
                <Label className="flex items-center gap-2 font-normal">
                  <Switch checked={s.active} disabled={busy} onCheckedChange={(v) => run(async () => unwrap(await setPodcastShowActive(s.id, v)))} />
                  Feed is public
                </Label>
              </div>
            ) : null}
            {s.episodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No episodes yet. Make an explainer (Publish → Explainers, or an Auto Post rule in explainer mode) and include this show.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Episode</TableHead>
                    <TableHead>Published</TableHead>
                    <TableHead className="text-right">Length</TableHead>
                    <TableHead className="text-right">Downloads</TableHead>
                    {canManage ? <TableHead /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.episodes.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="max-w-[28rem] truncate">{e.title}</TableCell>
                      <TableCell><LocalDate value={e.publishedAt} kind="date" /></TableCell>
                      <TableCell className="text-right">{mmss(e.durationSec)}</TableCell>
                      <TableCell className="text-right">{e.downloads}</TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              if (confirm(`Remove “${e.title}” from the feed? Listeners who already downloaded it keep their copy.`)) {
                                run(async () => unwrap(await removePodcastEpisode(e.id)), "Episode removed from the feed.");
                              }
                            }}
                          >
                            <Trash2 /> Remove
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg"
        className="hidden"
        onChange={(ev) => {
          const f = ev.target.files?.[0];
          ev.target.value = "";
          if (!f || !coverFor) return;
          const fd = new FormData();
          fd.set("showId", coverFor);
          fd.set("file", f);
          run(async () => unwrap(await uploadPodcastCover(fd)), "Cover updated.");
        }}
      />

      <Dialog open={draft !== null} onOpenChange={(o) => (o ? null : setDraft(null))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit show" : "New podcast show"}</DialogTitle>
            <DialogDescription>
              These fields go into the feed exactly as Apple Podcasts reads them. A cover is generated from the title; upload your own any time.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pc-title">Title</Label>
                <Input id="pc-title" value={draft.title} maxLength={255} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pc-desc">Description</Label>
                <Textarea id="pc-desc" rows={4} value={draft.description} maxLength={4000} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pc-author">Author</Label>
                  <Input id="pc-author" value={draft.author} onChange={(e) => setDraft({ ...draft, author: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pc-lang">Language</Label>
                  <Input id="pc-lang" value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} placeholder="en-us" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select
                    value={draft.category}
                    onValueChange={(v) => setDraft({ ...draft, category: String(v), subcategory: "" })}
                    items={Object.keys(categories).map((c) => ({ value: c, label: c }))}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.keys(categories).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Subcategory</Label>
                  <Select
                    value={draft.subcategory || "none"}
                    onValueChange={(v) => setDraft({ ...draft, subcategory: v === "none" ? "" : String(v) })}
                    items={[{ value: "none", label: "None" }, ...subs.map((c) => ({ value: c, label: c }))]}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {subs.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pc-slug">Feed address</Label>
                <Input
                  id="pc-slug"
                  value={draft.slug}
                  disabled={draft.locked}
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                  placeholder="made from the title"
                />
                <p className="text-xs text-muted-foreground">
                  /p/<b>{draft.slug || "…"}</b>/rss.xml{draft.locked ? " — fixed: this show has episodes and subscribers follow this address." : ""}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pc-link">Website</Label>
                  <Input id="pc-link" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} placeholder="https://" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pc-copy">Copyright</Label>
                  <Input id="pc-copy" value={draft.copyright} onChange={(e) => setDraft({ ...draft, copyright: e.target.value })} />
                </div>
              </div>
              <Label className="flex items-center gap-2 font-normal">
                <Switch checked={draft.explicit} onCheckedChange={(v) => setDraft({ ...draft, explicit: v })} /> Explicit content
              </Label>
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={busy || !draft?.title.trim() || !draft?.description.trim()}
              onClick={() => {
                const d = draft;
                if (!d) return;
                run(async () => {
                  const r = unwrap(await savePodcastShow({
                    id: d.id, title: d.title, description: d.description, author: d.author, category: d.category,
                    subcategory: d.subcategory, language: d.language, explicit: d.explicit, link: d.link,
                    copyright: d.copyright, slug: d.slug,
                  }));
                  setDraft(null);
                  toast.success(`Saved. Feed: ${r.feedUrl}`);
                });
              }}
            >
              Save show
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
