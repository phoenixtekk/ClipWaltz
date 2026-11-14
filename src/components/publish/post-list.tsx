"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check, Copy, ExternalLink, Film, ImageIcon, Link2, Link2Off, Loader2, MoreHorizontal, Pencil, Repeat2, RotateCw, Send,
  Star, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LocalDate } from "@/components/local-date";
import { unwrap } from "@/lib/action-result";
import {
  decidePost, deletePost, duplicatePost, publishNow, retryTarget, setFavorite, setShareLink, unschedulePost,
} from "@/lib/social/ui-actions";
import { providerName, type PostView } from "@/lib/social/ui-types";
import { ApprovalBadge, StatusBadge } from "./status-badge";

const EDITABLE = new Set(["draft", "queued", "scheduled", "failed"]);

/** A list of posts with their per-channel results and the actions a post supports in its state. */
export function PostList({
  posts,
  empty,
  canApprove = false,
}: {
  posts: PostView[];
  empty: React.ReactNode;
  canApprove?: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [confirm, setConfirm] = useState<PostView | null>(null);

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

  async function copyShare(p: PostView) {
    const token = p.shareToken ?? unwrap(await setShareLink(p.id, true));
    const url = `${window.location.origin}/r/${token}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    toast.success("Review link copied. Anyone with it can read the post (not edit it).");
  }

  if (posts.length === 0) return <>{empty}</>;

  return (
    <>
      <ul className="space-y-3">
        {posts.map((p) => (
          <li key={p.id}>
            <Card size="sm">
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={p.status} />
                      <ApprovalBadge status={p.approvalStatus} />
                      {p.shareToken ? <Badge variant="outline"><Link2 /> Shared</Badge> : null}
                      {p.renderId || p.exportId ? <Badge variant="outline"><Film /> ClipWaltz video</Badge> : null}
                      <span className="text-xs text-muted-foreground">
                        {p.status === "scheduled" && p.scheduledAt ? (
                          <>Goes out <LocalDate value={p.scheduledAt} /></>
                        ) : p.publishedAt ? (
                          <>Published <LocalDate value={p.publishedAt} /></>
                        ) : (
                          <>Created <LocalDate value={p.createdAt} /></>
                        )}
                      </span>
                    </div>
                    <p className="line-clamp-3 text-sm whitespace-pre-wrap">{p.text}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {p.destinations.map((d) => (
                        <Badge key={d.key} variant="secondary">{d.label}</Badge>
                      ))}
                      {p.media.length ? (
                        <span className="inline-flex items-center gap-1">
                          {p.media.some((m) => m.kind === "video") ? <Film className="size-3" /> : <ImageIcon className="size-3" />}
                          {p.media.length} file{p.media.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={p.favorite ? "Remove from favorites" : "Add to favorites"}
                      aria-pressed={p.favorite}
                      disabled={busy}
                      onClick={() => run(async () => unwrap(await setFavorite(p.id, !p.favorite)))}
                    >
                      <Star className={cn(p.favorite && "fill-amber-400 text-amber-500")} />
                    </Button>
                    {EDITABLE.has(p.status) ? (
                      <Link href={`/publish/compose?post=${p.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                        <Pencil /> Edit
                      </Link>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" disabled={busy} />}>
                        {busy ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {EDITABLE.has(p.status) && p.approvalStatus !== "pending" && p.approvalStatus !== "rejected" ? (
                          <DropdownMenuItem onClick={() => run(async () => unwrap(await publishNow(p.id)), "Publishing…")}>
                            <Send /> Publish now
                          </DropdownMenuItem>
                        ) : null}
                        {p.status === "scheduled" || p.status === "queued" ? (
                          <DropdownMenuItem onClick={() => run(async () => unwrap(await unschedulePost(p.id)), "Moved back to drafts.")}>
                            <X /> Unschedule
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          onClick={() =>
                            run(async () => {
                              const id = unwrap(await duplicatePost(p.id));
                              router.push(`/publish/compose?post=${id}`);
                            }, "Copied into a new draft.")
                          }
                        >
                          <Repeat2 /> Re-share as a new draft
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => run(() => copyShare(p))}>
                          <Copy /> Copy review link
                        </DropdownMenuItem>
                        {p.shareToken ? (
                          <DropdownMenuItem onClick={() => run(async () => unwrap(await setShareLink(p.id, false)), "Review link turned off.")}>
                            <Link2Off /> Turn off review link
                          </DropdownMenuItem>
                        ) : null}
                        {canApprove && p.approvalStatus === "pending" ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => run(async () => unwrap(await decidePost(p.id, "approved")), "Approved.")}>
                              <Check /> Approve
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => run(async () => unwrap(await decidePost(p.id, "rejected")), "Rejected.")}>
                              <X /> Reject
                            </DropdownMenuItem>
                          </>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" disabled={p.status === "publishing"} onClick={() => setConfirm(p)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {p.targets.length ? (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {p.targets.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{t.label ?? providerName(t.provider)}</span>
                        <StatusBadge status={t.status} />
                        {t.metrics ? (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {[
                              t.metrics.views != null ? `${t.metrics.views} views` : null,
                              t.metrics.likes != null ? `${t.metrics.likes} likes` : null,
                              t.metrics.comments != null ? `${t.metrics.comments} comments` : null,
                            ].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                        {t.url ? (
                          <a href={t.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost", size: "xs" })}>
                            <ExternalLink /> View
                          </a>
                        ) : null}
                        {t.status === "failed" ? (
                          <Button size="xs" variant="outline" disabled={busy} onClick={() => run(async () => unwrap(await retryTarget(p.id, t.id)), "Retrying…")}>
                            <RotateCw /> Retry
                          </Button>
                        ) : null}
                        {t.status === "handoff" ? (
                          <Link href="/publish/by-hand" className={buttonVariants({ variant: "outline", size: "xs" })}>Post by hand</Link>
                        ) : null}
                        {t.error ? <p className="w-full text-xs text-destructive">{t.error}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {p.warnings.length ? (
                  <ul className="space-y-0.5">
                    {p.warnings.map((w, i) => (
                      <li key={i} className="text-xs text-amber-700 dark:text-amber-400">{w}</li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <Dialog open={confirm !== null} onOpenChange={(o) => (o ? null : setConfirm(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this post?</DialogTitle>
            <DialogDescription>
              It is removed from ClipWaltz with its uploaded files. Anything already published on a network stays there.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const p = confirm;
                setConfirm(null);
                if (p) run(async () => unwrap(await deletePost(p.id)), "Post deleted.");
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
