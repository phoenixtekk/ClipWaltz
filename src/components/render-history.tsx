"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Trash2, RectangleHorizontal, RectangleVertical, Square, Loader2, CloudUpload, Check, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { DownloadButton } from "@/components/download-controls";
import { deleteRender } from "@/lib/render-actions";
import type { RenderHistoryItem } from "@/lib/render";
import { isWide } from "@/lib/aspect";
import { unwrap } from "@/lib/action-result";
import { useDateFormat } from "@/lib/local-date";
import { myCloudProviders, saveRenderToCloud } from "@/lib/cloud-actions";
import { PROVIDER_LABEL, isCloudProvider, type CloudProviderId } from "@/lib/cloud/types";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const label = (p: string) => (isCloudProvider(p) ? PROVIDER_LABEL[p] : p);


/**
 * Every saved render for the project — download or delete any past version, not just the latest.
 * The most recent finished render is marked "Latest".
 */
export function RenderHistory({ renders }: { renders: RenderHistoryItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useState<string | null>(null);
  const fmt = useDateFormat();
  const when = (iso: string) => fmt(iso, "datetime", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const [connected, setConnected] = useState<CloudProviderId[]>([]);
  useEffect(() => {
    myCloudProviders().then((r) => { if (r.ok) setConnected(r.data); }).catch(() => {});
  }, []);
  // While a cloud save is queued or uploading, refresh every few seconds so its status updates.
  const saving = renders.some((r) => r.cloud.some((c) => c.status === "queued" || c.status === "uploading"));
  useEffect(() => {
    if (!saving) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [saving, router]);
  if (renders.length === 0) return null;

  function saveTo(renderId: string, p: CloudProviderId, version: number) {
    start(async () => {
      try {
        unwrap(await saveRenderToCloud(renderId, p));
        toast.success(`Saving v${version} to ${PROVIDER_LABEL[p]}…`);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not start the save.");
      }
    });
  }

  function onDelete(id: string, version: number) {
    if (!window.confirm(`Delete render v${version}? The downloadable video is removed permanently.`)) return;
    setDeleting(id);
    start(async () => {
      try {
        unwrap(await deleteRender(id));
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
          const Orient = isWide(r.aspect) ? RectangleHorizontal : r.aspect === "1:1" ? Square : RectangleVertical;
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
                {r.cloud.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.cloud.map((c) => {
                      const tip = c.status === "failed" ? c.error ?? "Save failed" : c.path ?? undefined;
                      const body = (
                        <>
                          {c.status === "done" ? <Check className="size-3" /> : c.status === "failed" ? <AlertTriangle className="size-3" /> : <Loader2 className="size-3 animate-spin" />}
                          {label(c.provider)}
                          {c.status === "done" && c.url ? <ExternalLink className="size-3" /> : null}
                        </>
                      );
                      const cls = cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]",
                        c.status === "done" ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                          : c.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary");
                      return c.status === "done" && c.url
                        ? <a key={c.id} href={c.url} target="_blank" rel="noopener noreferrer" title={tip} className={cls}>{body}</a>
                        : <span key={c.id} title={tip} className={cls}>{body}</span>;
                    })}
                  </div>
                ) : null}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger render={<button type="button" disabled={pending} aria-label={`Save v${r.version} to cloud storage`} title="Save to cloud storage" className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" />}>
                  <CloudUpload className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {connected.map((p) => {
                    const s = r.cloud.find((c) => c.provider === p);
                    const busy = s?.status === "queued" || s?.status === "uploading";
                    return (
                      <DropdownMenuItem key={p} disabled={busy} onClick={() => saveTo(r.id, p, r.version)}>
                        {s?.status === "failed" ? "Retry" : s?.status === "done" ? "Save again to" : "Save to"} {PROVIDER_LABEL[p]}
                      </DropdownMenuItem>
                    );
                  })}
                  {connected.length ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem onClick={() => router.push("/account/storage")}>
                    {connected.length ? "Cloud storage settings…" : "Connect cloud storage…"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
