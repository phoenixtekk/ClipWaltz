"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { LocalDate } from "@/components/local-date";
import { unwrap } from "@/lib/action-result";
import { pollRenderJobs } from "@/lib/social/p5-actions";
import type { RenderJobView } from "@/lib/social/render-jobs";

const STAGE: Record<string, string> = {
  scripting: "Writing the script",
  voicing: "Recording the narration",
  assembling: "Rendering the video",
  meta: "Building the thumbnail and description",
  building: "Writing, narrating and rendering",
  ready: "Ready",
};

function statusLine(j: RenderJobView): string {
  if (j.status === "failed") return "Failed";
  if (j.status === "done") {
    if (j.postStatus === "draft") return "Ready — waiting in Drafts for your review";
    if (j.postStatus === "rendering") return "Finishing…";
    return "Done";
  }
  if (j.status === "queued" && j.progress === 0) return "Waiting for the render worker";
  return STAGE[j.stage ?? ""] ?? "Working";
}

/** Recent explainer / Short jobs, polled every 10 s while any is still in progress. */
export function RenderJobsList({ kind, initial }: { kind: "explainer" | "short"; initial: RenderJobView[] }) {
  const [jobs, setJobs] = useState(initial);
  // A server refresh (router.refresh after "Make") hands a new list: adopt it (React's "adjust state on prop change").
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setJobs(initial);
  }
  const active = jobs.some((j) => j.status === "queued" || j.status === "running" || (j.status === "done" && j.postStatus === "rendering"));

  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      try {
        setJobs(unwrap(await pollRenderJobs(kind)));
      } catch {
        /* keep the last list; the next tick retries */
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [active, kind]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent {kind === "short" ? "Shorts" : "explainers"}</CardTitle>
        <CardDescription>
          Finished videos become posts: review-first ones wait in Drafts, the rest publish to their channels right away.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {jobs.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : null}
        {jobs.map((j) => (
          <div key={j.id} className="space-y-1.5 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              {j.status === "failed" ? (
                <AlertTriangle className="size-4 text-destructive" />
              ) : j.status === "done" ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{j.title}</span>
              {j.ruleId ? <Badge variant="outline">Rule</Badge> : null}
              <span className="text-xs text-muted-foreground"><LocalDate value={j.createdAt} /></span>
            </div>
            <p className="text-xs text-muted-foreground">
              {statusLine(j)}
              {j.postId && j.status === "done" && j.postStatus !== "rendering" ? (
                <>
                  {" · "}
                  <Link className="underline" href={j.postStatus === "draft" ? "/publish/drafts" : "/publish/posts"}>
                    open the post
                  </Link>
                </>
              ) : null}
            </p>
            {j.status === "queued" || j.status === "running" ? <Progress value={j.progress} /> : null}
            {j.status === "failed" && j.error ? <p className="text-xs text-destructive">{j.error} (credits refunded)</p> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
