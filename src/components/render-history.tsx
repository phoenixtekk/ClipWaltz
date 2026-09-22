"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Trash2, RectangleHorizontal, RectangleVertical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DownloadButton } from "@/components/download-controls";
import { deleteRender } from "@/lib/render-actions";
import type { RenderHistoryItem } from "@/lib/render";

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Every saved render for the project — download or delete any past version, not just the latest.
 * The most recent finished render is marked "Latest".
 */
export function RenderHistory({ renders }: { renders: RenderHistoryItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useState<string | null>(null);
  if (renders.length === 0) return null;

  function onDelete(id: string, version: number) {
    if (!window.confirm(`Delete render v${version}? The downloadable video is removed permanently.`)) return;
    setDeleting(id);
    start(async () => {
      try {
        await deleteRender(id);
        toast.success(`Deleted render v${version}.`);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not delete the render.");
      } finally {
        setDeleting(null);
      }
    });
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <History className="size-4 text-[color:var(--cw-violet)]" /> Render history
        <span className="text-xs font-normal text-muted-foreground">({renders.length})</span>
      </h3>
      <ul className="divide-y divide-border">
        {renders.map((r, i) => {
          const Orient = r.aspect === "16:9" ? RectangleHorizontal : RectangleVertical;
          return (
            <li key={r.id} className="flex items-center gap-2 py-2">
              <Orient className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  <span className="font-medium">v{r.version}</span>
                  {i === 0 ? <span className="ml-1.5 rounded-full bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">Latest</span> : null}
                  {r.visibility !== "private" ? <span className="ml-1.5 text-[10px] text-muted-foreground">· {r.visibility}</span> : null}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{r.aspect} · {when(r.createdAt)}</p>
              </div>
              <DownloadButton url={`/api/renders/${r.id}/download`} fallbackName={`clipwaltz-v${r.version}.mp4`} />
              <button
                type="button"
                onClick={() => onDelete(r.id, r.version)}
                disabled={pending}
                aria-label={`Delete render v${r.version}`}
                className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              >
                {deleting === r.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
