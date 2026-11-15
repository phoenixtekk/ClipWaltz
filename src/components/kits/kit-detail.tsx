"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Copy, Download, ExternalLink, FileArchive, Film, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";
import { unwrap } from "@/lib/action-result";
import { deletePostKit, getPostKit, rewritePostKit, updatePostKitItem } from "@/lib/kits/kit-actions";
import { kitIsWriting, kitNetwork, type KitAsset, type KitItem, type KitView } from "@/lib/kits/types";

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Your browser blocked the clipboard. Select the text and copy it instead.");
  }
}

/** Publish → Post kits → one kit: per network, the words to paste and the files to attach, plus a posted checklist. */
export function KitDetail({ initial }: { initial: KitView }) {
  const router = useRouter();
  const [kit, setKit] = useState(initial);
  const [busy, start] = useTransition();
  // A build that stopped saving 5 minutes ago died (e.g. an app restart): offer Write again instead of waiting forever.
  const [now, setNow] = useState(() => Date.now());
  const writing = kitIsWriting(kit, now);
  const stuck = kit.status === "writing" && !writing;

  // While captions are being written, refresh the kit every 3 s so each network fills in as it is done.
  useEffect(() => {
    if (!writing) return;
    const t = setInterval(async () => {
      const r = await getPostKit(kit.id).catch(() => null);
      if (r?.ok) setKit(r.data);
      setNow(Date.now());
    }, 3000);
    return () => clearInterval(t);
  }, [writing, kit.id]);

  function rewrite(provider?: string) {
    start(async () => {
      try {
        unwrap(await rewritePostKit(kit.id, provider));
        const t = Date.now();
        setNow(t);
        setKit((k) => ({ ...k, status: "writing", error: null, updatedAt: new Date(t).toISOString() }));
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function remove() {
    if (!confirm("Delete this kit and its pictures? Posts you already made on the networks are not affected.")) return;
    start(async () => {
      try {
        unwrap(await deletePostKit(kit.id));
        router.push("/publish/kits");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const onItem = (next: KitItem) => setKit((k) => ({ ...k, items: k.items.map((i) => (i.provider === next.provider ? next : i)) }));
  const posted = kit.items.filter((i) => i.postedAt).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{kit.title || "Untitled kit"}</CardTitle>
          <CardDescription>
            {sourceText(kit)} · {posted}/{kit.items.length} posted · nothing is posted for you
          </CardDescription>
          <CardAction className="flex flex-wrap gap-2">
            <a href={`/api/kits/${kit.id}/zip`} className={buttonVariants({ variant: "default", size: "sm" })}><FileArchive /> Download all (.zip)</a>
            {kit.videoUrl ? <a href={kit.videoUrl} className={buttonVariants({ variant: "outline", size: "sm" })}><Film /> Download video</a> : null}
            {kit.canEdit ? (
              <>
                <Button size="sm" variant="outline" disabled={busy || writing} onClick={() => rewrite()}><RefreshCw /> Write all again</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={remove} aria-label="Delete kit"><Trash2 /></Button>
              </>
            ) : null}
          </CardAction>
        </CardHeader>
        {kit.brief || kit.link ? (
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            {kit.brief ? <p className="line-clamp-3 whitespace-pre-line">{kit.brief}</p> : null}
            {kit.link ? <p>Link: <a href={kit.link} target="_blank" rel="noreferrer" className="underline">{kit.link}</a></p> : null}
          </CardContent>
        ) : null}
      </Card>

      {writing ? (
        <Alert>
          <Loader2 className="animate-spin" />
          <AlertTitle>Writing captions…</AlertTitle>
          <AlertDescription>Each network fills in when it&apos;s done, usually 10–30 seconds each. You can leave this page; the kit keeps going.</AlertDescription>
        </Alert>
      ) : kit.status === "failed" || stuck ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Some of the kit isn&apos;t done</AlertTitle>
          <AlertDescription>{stuck ? "Writing stopped before it finished. Press Write all again." : kit.error ?? "Press Write all again."}</AlertDescription>
        </Alert>
      ) : null}

      <ul className="grid gap-4 xl:grid-cols-2">
        {kit.items.map((it) => (
          <li key={it.provider}>
            <NetworkCard kit={kit} item={it} writing={writing} onItem={onItem} onRewrite={() => rewrite(it.provider)} busy={busy} />
          </li>
        ))}
        {!kit.items.length && writing ? [0, 1].map((i) => <li key={i}><Skeleton className="h-64 rounded-xl" /></li>) : null}
      </ul>
    </div>
  );
}

function sourceText(k: KitView): string {
  const s = k.source;
  if (s.kind === "render") return `From the video “${s.title}”`;
  if (s.kind === "export") return `From the export “${s.title}”`;
  if (s.kind === "design") return `From the design “${s.title}”`;
  if (s.kind === "upload") return "From your uploads";
  return "Text only";
}

function NetworkCard({ kit, item, writing, busy, onItem, onRewrite }: {
  kit: KitView; item: KitItem; writing: boolean; busy: boolean; onItem: (i: KitItem) => void; onRewrite: () => void;
}) {
  const net = kitNetwork(item.provider);
  const label = net?.label ?? item.provider;
  const [title, setTitle] = useState(item.title);
  const [caption, setCaption] = useState(item.caption);
  const [url, setUrl] = useState(item.postedUrl ?? "");
  const [saving, startSave] = useTransition();

  // Pick up text the AI writes while the card is on screen (but never overwrite what the person is typing).
  const [seen, setSeen] = useState({ t: item.title, c: item.caption });
  if (seen.t !== item.title || seen.c !== item.caption) {
    setSeen({ t: item.title, c: item.caption });
    if (title === seen.t) setTitle(item.title);
    if (caption === seen.c) setCaption(item.caption);
  }

  const pending = writing && !item.caption;
  const pics: KitAsset[] = kit.assets.filter((a) => a.kind === "image" && a.format === item.format).sort((a, b) => a.index - b.index);
  const over = net?.captionMax ? caption.length > net.captionMax : false;

  function save(patch: Parameters<typeof updatePostKitItem>[2], quiet = true) {
    if (!kit.canEdit) return;
    startSave(async () => {
      try {
        onItem(unwrap(await updatePostKitItem(kit.id, item.provider, patch)));
        if (!quiet) toast.success("Saved.");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <Card className={cn("h-full", item.postedAt && "border-[color:var(--cw-violet)]/50")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {label}
          {item.postedAt ? <Badge><CheckCircle2 /> Posted</Badge> : null}
          {item.format ? <Badge variant="outline">{item.format}</Badge> : null}
        </CardTitle>
        <CardAction className="flex gap-1">
          {net ? (
            <a href={net.site} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Open {label} <ExternalLink />
            </a>
          ) : null}
          {kit.canEdit ? (
            <Button size="sm" variant="ghost" disabled={busy || writing} onClick={onRewrite} aria-label={`Write the ${label} caption again`} title="Write again">
              <RefreshCw />
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {item.notes.map((n) => (
          <p key={n} className="text-xs text-amber-600 dark:text-amber-400"><TriangleAlert className="mr-1 inline size-3.5 align-[-2px]" />{n}</p>
        ))}

        {net?.titleMax ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={`t-${item.provider}`}>Title</Label>
              <span className="text-xs text-muted-foreground">{title.length}/{net.titleMax}</span>
            </div>
            <div className="flex gap-2">
              <Input id={`t-${item.provider}`} value={title} maxLength={net.titleMax} disabled={!kit.canEdit}
                onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== item.title && save({ title })} />
              <Button size="icon-sm" variant="outline" aria-label="Copy title" onClick={() => copyText(title, "Title")}><Copy /></Button>
            </div>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`c-${item.provider}`}>Caption</Label>
            <span className={cn("text-xs", over ? "text-destructive" : "text-muted-foreground")}>
              {caption.length.toLocaleString()}{net?.captionMax ? `/${net.captionMax.toLocaleString()}` : ""}
            </span>
          </div>
          {pending ? (
            <Skeleton className="h-40" />
          ) : (
            <Textarea id={`c-${item.provider}`} rows={8} value={caption} disabled={!kit.canEdit}
              onChange={(e) => setCaption(e.target.value)} onBlur={() => caption !== item.caption && save({ caption })} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={pending || !caption} onClick={() => copyText(caption, `${label} caption`)}><Copy /> Copy caption</Button>
            {item.hashtags.length ? (
              <Button size="sm" variant="outline" onClick={() => copyText(item.hashtags.join(" "), "Hashtags")}><Copy /> Hashtags only</Button>
            ) : null}
            {kit.link ? <Button size="sm" variant="outline" onClick={() => copyText(kit.link!, "Link")}><Copy /> Link</Button> : null}
          </div>
        </div>

        {pics.length ? (
          <div className="space-y-1.5">
            <Label>Pictures ({pics.length})</Label>
            <ul className="flex flex-wrap gap-2">
              {pics.map((a) => (
                <li key={a.mediaId} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/kits/${kit.id}/file/${a.mediaId}`} alt={`${label} picture ${a.index + 1}`} loading="lazy"
                    className="h-28 w-auto rounded-md border bg-muted object-contain" />
                  <a href={`/api/kits/${kit.id}/file/${a.mediaId}?download=1`} aria-label={`Download ${a.filename}`} title="Download"
                    className={cn(buttonVariants({ variant: "secondary", size: "icon-sm" }), "absolute right-1 bottom-1 opacity-90")}>
                    <Download />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : kit.videoUrl && net?.takesVideo ? (
          <p className="text-xs text-muted-foreground"><Film className="mr-1 inline size-3.5 align-[-2px]" />Attach the video ({kit.videoName}) — Download video at the top.</p>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={Boolean(item.postedAt)} disabled={!kit.canEdit || saving} onCheckedChange={(v) => save({ posted: Boolean(v) })} />
          Posted
        </Label>
        <Input className="h-8 min-w-0 flex-1" value={url} placeholder="Link to the post (optional)" disabled={!kit.canEdit}
          onChange={(e) => setUrl(e.target.value)} onBlur={() => url !== (item.postedUrl ?? "") && save({ postedUrl: url || null })} />
        {saving ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : item.postedUrl ? (
          <a href={item.postedUrl} target="_blank" rel="noreferrer" aria-label="Open the post" className="text-muted-foreground"><Check className="size-4" /></a>
        ) : null}
      </CardFooter>
    </Card>
  );
}
