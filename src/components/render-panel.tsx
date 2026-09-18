"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Download, Sparkles, AlertTriangle, Link as LinkIcon, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { createRender } from "@/lib/render-actions";
import { shareRender } from "@/lib/feed-actions";
import { EnterContestButton } from "@/components/enter-contest";

type R = { id: string; status: string; version: number; hasOutput: boolean; visibility: string } | null;
type Contest = { theme: string; entered: boolean } | null;

const VIS = [
  ["private", "Private"],
  ["unlisted", "Unlisted"],
  ["public", "Public"],
] as const;

export function RenderPanel({
  projectId,
  initial,
  canRender,
  contest,
}: {
  projectId: string;
  initial: R;
  canRender: boolean;
  contest?: Contest;
}) {
  const router = useRouter();
  const [render, setRender] = useState<R>(initial);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const active = !!render && (render.status === "queued" || render.status === "rendering");

  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/render/status`, { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { render: R };
        setRender(j.render);
        if (j.render && (j.render.status === "done" || j.render.status === "failed")) {
          router.refresh();
        }
      } catch {
        /* transient — keep polling */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [active, projectId, router]);

  function onRender() {
    start(async () => {
      try {
        const id = await createRender(projectId);
        setRender({ id, status: "queued", version: (render?.version ?? 0) + 1, hasOutput: false, visibility: "private" });
      } catch (e) {
        toast.error((e as Error).message || "Could not start the render.");
      }
    });
  }

  function doShare(v: string) {
    if (!render) return;
    start(async () => {
      try {
        const applied = await shareRender(render.id, v);
        setRender((cur) => (cur ? { ...cur, visibility: applied } : cur));
      } catch {
        toast.error("Could not update sharing.");
      }
    });
  }

  function copyLink() {
    if (!render) return;
    navigator.clipboard?.writeText(`${window.location.origin}/w/${render.id}`).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error("Could not copy the link."),
    );
  }

  if (render?.status === "done" && render.hasOutput) {
    return (
      <div className="space-y-3 rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium">Your video is ready.</span>
          </div>
          <div className="flex items-center gap-2">
            <Button render={<a href={`/api/renders/${render.id}/download`} />}>
              <Download className="size-4" /> Download
            </Button>
            <Button variant="outline" onClick={onRender} disabled={pending}>
              Re-render
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-emerald-600/20 pt-3 text-xs">
          <span className="text-muted-foreground">Share to the community:</span>
          {VIS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => doShare(k)}
              disabled={pending}
              aria-pressed={render.visibility === k}
              className={cn(
                "rounded-full border px-2.5 py-1 font-medium transition-colors disabled:opacity-60",
                render.visibility === k
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {l}
            </button>
          ))}
          {render.visibility !== "private" ? (
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              {copied ? <Check className="size-3.5" /> : <LinkIcon className="size-3.5" />}
              {copied ? "Copied" : "Copy link"}
            </button>
          ) : null}
        </div>
        {contest ? (
          <EnterContestButton
            renderId={render.id}
            theme={contest.theme}
            initialEntered={contest.entered}
            isPublic={render.visibility === "public"}
          />
        ) : null}
      </div>
    );
  }

  if (active) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
        <Loader2 className="size-4 animate-spin text-primary" />
        <span className="font-medium">
          {render?.status === "queued" ? "Queued for rendering…" : "Rendering your video…"}
        </span>
        <span className="text-muted-foreground">You can leave — we&apos;ll have it ready shortly.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-sm">
        {render?.status === "failed" ? (
          <span className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" /> Last render failed — try again.
          </span>
        ) : (
          <span className="text-muted-foreground">Assemble your clips into a music video.</span>
        )}
      </div>
      <Button onClick={onRender} disabled={!canRender || pending}>
        {pending ? "Starting…" : "Render HD →"}
      </Button>
    </div>
  );
}
