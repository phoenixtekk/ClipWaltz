"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, Download, ExternalLink, Film, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LocalDate } from "@/components/local-date";
import { unwrap } from "@/lib/action-result";
import { markHandoffPosted } from "@/lib/social/ui-actions";
import { providerName } from "@/lib/social/ui-types";
import type { HandoffItem } from "@/lib/social/ui";

/** "Post by hand": destinations with no API (Facebook Groups). Copy, paste, then mark it posted. */
export function HandoffQueue({ waiting, done }: { waiting: HandoffItem[]; done: HandoffItem[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [urls, setUrls] = useState<Record<string, string>>({});

  async function copy(text: string) {
    await navigator.clipboard.writeText(text).then(
      () => toast.success("Copied."),
      () => toast.error("Could not copy — select the text instead."),
    );
  }

  function mark(i: HandoffItem) {
    start(async () => {
      try {
        unwrap(await markHandoffPosted(i.targetId, urls[i.targetId] ?? ""));
        toast.success("Marked as posted.");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <div className="space-y-6">
      {waiting.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-600" /> Nothing is waiting for you.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {waiting.map((i) => {
            const full = i.link ? `${i.text.trim()}\n\n${i.link}` : i.text.trim();
            return (
              <li key={i.targetId}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {i.label ?? providerName(i.provider)} <Badge variant="outline">Waiting for you</Badge>
                    </CardTitle>
                    <CardDescription>Ready since <LocalDate value={i.updatedAt} /></CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm whitespace-pre-wrap">{full}</p>
                    {i.media.length ? (
                      <ul className="flex flex-wrap gap-2">
                        {i.media.map((m) => (
                          <li key={m.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
                            {m.previewUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- signed media URL
                              <img src={m.previewUrl} alt="" className="size-8 rounded object-cover" />
                            ) : (
                              <Film className="size-4" />
                            )}
                            {m.filename}
                            {m.previewUrl ? (
                              <a href={m.previewUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${m.filename}`}><Download className="size-3.5" /></a>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => void copy(full)}><Copy /> Copy text</Button>
                      {i.destinationUrl ? (
                        <a href={i.destinationUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                          <ExternalLink /> Open the group
                        </a>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      <Input
                        className="min-w-56 flex-1"
                        type="url"
                        placeholder="Link to the post once it's up (optional)"
                        aria-label="Link to the post"
                        value={urls[i.targetId] ?? ""}
                        onChange={(e) => setUrls((u) => ({ ...u, [i.targetId]: e.target.value }))}
                      />
                      <Button disabled={busy} onClick={() => mark(i)}>
                        {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Mark as posted
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {done.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Posted by hand</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {done.map((i) => (
                <li key={i.targetId} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{i.text}</span>
                  <span className="text-xs text-muted-foreground">{i.label ?? providerName(i.provider)}</span>
                  {i.url ? (
                    <a href={i.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost", size: "xs" })}><ExternalLink /> View</a>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
