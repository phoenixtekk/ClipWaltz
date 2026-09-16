"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Download, Sparkles, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createRender } from "@/lib/render-actions";

type R = { id: string; status: string; version: number; hasOutput: boolean } | null;

export function RenderPanel({
  projectId,
  initial,
  canRender,
}: {
  projectId: string;
  initial: R;
  canRender: boolean;
}) {
  const router = useRouter();
  const [render, setRender] = useState<R>(initial);
  const [pending, start] = useTransition();
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
        setRender({ id, status: "queued", version: (render?.version ?? 0) + 1, hasOutput: false });
      } catch (e) {
        toast.error((e as Error).message || "Could not start the render.");
      }
    });
  }

  if (render?.status === "done" && render.hasOutput) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-4 py-3">
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
    );
  }

  if (active) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
        <Loader2 className="size-4 animate-spin text-primary" />
        <span className="font-medium">
          {render?.status === "queued" ? "Queued for rendering…" : "Rendering your video…"}
        </span>
        <span className="text-muted-foreground">
          You can leave — we&apos;ll have it ready shortly.
        </span>
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
          <span className="text-muted-foreground">
            Assemble your clips into a music video.
          </span>
        )}
      </div>
      <Button onClick={onRender} disabled={!canRender || pending}>
        {pending ? "Starting…" : "Render HD →"}
      </Button>
    </div>
  );
}
