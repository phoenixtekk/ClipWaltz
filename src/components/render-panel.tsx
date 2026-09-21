"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, AlertTriangle, Link as LinkIcon, Check, FileText, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { notifyRenderDone } from "@/lib/notify-client";
import { createRender, getRenderCheckpoint } from "@/lib/render-actions";
import type { RenderCheckpoint } from "@/lib/render";
import { shareRender } from "@/lib/feed-actions";
import { EnterContestButton } from "@/components/enter-contest";
import { DownloadButton, DownloadFolderChip } from "@/components/download-controls";
import { RenderCheckpointModal, SKIP_KEY } from "@/components/render-checkpoint-modal";

type R = { id: string; status: string; version: number; hasOutput: boolean; visibility: string; description?: string | null } | null;
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
  title,
}: {
  projectId: string;
  initial: R;
  canRender: boolean;
  contest?: Contest;
  title?: string;
}) {
  const router = useRouter();
  const [render, setRender] = useState<R>(initial);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [checkpoint, setCheckpoint] = useState<RenderCheckpoint | null>(null);
  const [checking, setChecking] = useState(false);
  const notifiedRef = useRef<string | null>(null);
  const active = !!render && (render.status === "queued" || render.status === "rendering");
  const isRerender = !!render?.hasOutput;

  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/render/status`, { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { render: R };
        setRender(j.render);
        if (j.render && (j.render.status === "done" || j.render.status === "failed")) {
          // In-tab (per-browser) notification — fire once per render id.
          if (j.render.status === "done" && notifiedRef.current !== j.render.id) {
            notifiedRef.current = j.render.id;
            notifyRenderDone(
              "Your ClipWaltz video is ready 🎬",
              title ? `“${title}” has finished rendering.` : "Your video has finished rendering.",
              `/projects/${projectId}`,
            );
          }
          router.refresh();
        }
      } catch {
        /* transient — keep polling */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [active, projectId, router, title]);

  // Step 1: build the checkpoint (fresh settings read from the server, so what we show is exactly
  // what will render). Skip straight to rendering only when the user opted out AND nothing needs
  // their attention.
  function requestRender() {
    setChecking(true);
    (async () => {
      try {
        const cp = await getRenderCheckpoint(projectId);
        const needsAttention = cp.hasBlocking || cp.warnings.some((w) => w.level !== "info");
        let skip = false;
        try {
          skip = localStorage.getItem(SKIP_KEY) === "1";
        } catch {
          /* storage blocked — always show */
        }
        if (skip && !needsAttention) doCreate();
        else setCheckpoint(cp);
      } catch (e) {
        toast.error((e as Error).message || "Could not prepare the render.");
      } finally {
        setChecking(false);
      }
    })();
  }

  // Step 2: actually queue the render.
  function doCreate() {
    start(async () => {
      try {
        const id = await createRender(projectId);
        setCheckpoint(null);
        setRender({ id, status: "queued", version: (render?.version ?? 0) + 1, hasOutput: false, visibility: "private", description: null });
      } catch (e) {
        toast.error((e as Error).message || "Could not start the render.");
      }
    });
  }

  const checkpointModal = checkpoint ? (
    <RenderCheckpointModal
      checkpoint={checkpoint}
      isRerender={isRerender}
      pending={pending}
      onConfirm={doCreate}
      onCancel={() => setCheckpoint(null)}
    />
  ) : null;

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
            <DownloadButton url={`/api/renders/${render.id}/download`} fallbackName="clipwaltz-video.mp4" />
            {render.description ? <CopyPostButton text={render.description} /> : null}
            <Button variant="outline" onClick={requestRender} disabled={pending || checking}>
              {checking ? "Checking…" : "Re-render"}
            </Button>
          </div>
        </div>
        <DownloadFolderChip />
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
        {render.description ? <DescriptionBox text={render.description} /> : null}
        {checkpointModal}
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
      <Button onClick={requestRender} disabled={!canRender || pending || checking}>
        {pending ? "Starting…" : checking ? "Checking…" : "Render HD →"}
      </Button>
      {checkpointModal}
    </div>
  );
}

/** Copy the ready-to-post description; sits next to the Download button. */
function CopyPostButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error("Could not copy the post text."),
    );
  }
  return (
    <Button variant="outline" onClick={copy} title="Copy the ready-to-post description">
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : "Copy post"}
    </Button>
  );
}

function DescriptionBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error("Could not copy."),
    );
  }
  return (
    <div className="space-y-1.5 border-t border-emerald-600/20 pt-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <FileText className="size-3.5" /> Ready-to-post description
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <textarea
        readOnly
        value={text}
        rows={10}
        className="w-full resize-y rounded-lg border border-border bg-background p-2.5 text-xs leading-relaxed outline-none"
      />
    </div>
  );
}
