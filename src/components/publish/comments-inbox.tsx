"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, MessageCircle, RefreshCw, Reply } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { LocalDate } from "@/components/local-date";
import { unwrap } from "@/lib/action-result";
import { refreshComments, replyToComment } from "@/lib/social/ui-actions";
import { providerName } from "@/lib/social/ui-types";
import type { InboxTarget } from "@/lib/social/ui";

/** Comments on published posts (Facebook, Instagram, Threads, Bluesky), with replies sent from here. */
export function CommentsInbox({ items, canReply }: { items: InboxTarget[]; canReply: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [working, setWorking] = useState<string | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setWorking(key);
    start(async () => {
      try {
        await fn();
        if (ok) toast.success(ok);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setWorking(null);
      }
    });
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          No published posts on Facebook, Instagram, Threads or Bluesky in the last 60 days, so there are no comments to show.
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((t) => (
        <li key={t.targetId}>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <span className="line-clamp-1 min-w-0 flex-1">{t.text}</span>
                <Badge variant="secondary">{t.label ?? providerName(t.provider)}</Badge>
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                <MessageCircle className="size-3.5" /> {t.comments.length} comment{t.comments.length === 1 ? "" : "s"}
                {t.commentsAt ? <> · checked <LocalDate value={t.commentsAt} /></> : " · not checked yet"}
                <Button size="xs" variant="outline" disabled={busy} onClick={() => run(t.targetId, async () => unwrap(await refreshComments(t.targetId)), "Comments updated.")}>
                  {working === t.targetId ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
                </Button>
                {t.url ? (
                  <a href={t.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost", size: "xs" })}><ExternalLink /> Open</a>
                ) : null}
              </CardDescription>
            </CardHeader>
            {t.comments.length ? (
              <CardContent>
                <ul className="space-y-2">
                  {t.comments.map((c) => {
                    const key = `${t.targetId}:${c.id}`;
                    return (
                      <li key={c.id} className="rounded-lg border border-border p-2.5">
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{c.author}</span>
                          {c.createdAt ? <> · <LocalDate value={c.createdAt} /></> : null}
                        </p>
                        <p className="text-sm whitespace-pre-wrap">{c.text}</p>
                        {canReply ? (
                          replying === key ? (
                            <div className="mt-2 space-y-2">
                              <Textarea aria-label={`Reply to ${c.author}`} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={2000} />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  disabled={busy || !reply.trim()}
                                  onClick={() =>
                                    run(key, async () => {
                                      unwrap(await replyToComment(t.targetId, c.id, reply));
                                      setReplying(null);
                                      setReply("");
                                    }, "Reply sent.")
                                  }
                                >
                                  {working === key ? <Loader2 className="animate-spin" /> : <Reply />} Send reply
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setReplying(null)}>Cancel</Button>
                              </div>
                            </div>
                          ) : (
                            <Button size="xs" variant="ghost" className="mt-1" onClick={() => { setReplying(key); setReply(""); }}>
                              <Reply /> Reply
                            </Button>
                          )
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}
