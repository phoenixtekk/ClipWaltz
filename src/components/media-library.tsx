"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash2, Film, Image as ImageIcon, Loader2, Pencil, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { MediaItem } from "@/lib/media";
import { addMediaToProject, deleteMedia, renameMedia } from "@/lib/media-actions";

type Tab = "all" | "video" | "photo" | "360" | "unused";
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "video", label: "Videos" },
  { key: "photo", label: "Photos" },
  { key: "360", label: "360" },
  { key: "unused", label: "Unused" },
];

function fmtSize(b: number | null) {
  if (!b) return "";
  return b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

export function MediaLibrary({
  media,
  projects,
}: {
  media: MediaItem[];
  projects: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("all");
  const [pending, start] = useTransition();

  const shown = useMemo(() => {
    switch (tab) {
      case "video": return media.filter((m) => m.kind === "video");
      case "photo": return media.filter((m) => m.kind === "photo");
      case "360": return media.filter((m) => m.sourceFormat);
      case "unused": return media.filter((m) => m.usedIn === 0);
      default: return media;
    }
  }, [media, tab]);

  function act(fn: () => Promise<unknown>, err: string) {
    start(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || err);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-0.5 text-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-md px-3 py-1 font-medium transition-colors",
              tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="cw-glass rounded-xl p-10 text-center text-sm text-muted-foreground">
          {tab === "all" ? "No files yet — import media in a project and it'll appear here." : "Nothing here."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((m) => {
            const converting = m.sourceFormat && m.conversionState !== "ready" && m.conversionState !== "failed";
            return (
              <div key={m.id} className="cw-glass flex flex-col overflow-hidden rounded-xl">
                <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-muted">
                  {converting ? (
                    <div className="flex flex-col items-center gap-1 text-muted-foreground">
                      <Loader2 className="size-5 animate-spin text-[color:var(--cw-violet)]" />
                      <span className="text-[10px] font-semibold">360 converting…</span>
                    </div>
                  ) : m.conversionState === "failed" ? (
                    <span className="text-xs font-semibold text-destructive">360 conversion failed</span>
                  ) : m.kind === "video" ? (
                    <video src={`/api/media/${m.id}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/media/${m.id}`} alt="" className="size-full object-cover" />
                  )}
                  <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {m.kind === "video" ? <Film className="size-3" /> : <ImageIcon className="size-3" />}
                    {m.sourceFormat ? "360" : m.kind}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-1 p-2.5">
                  <p className="truncate text-sm font-medium" title={m.name}>{m.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {fmtDate(m.createdAt)}{m.sizeBytes ? ` · ${fmtSize(m.sizeBytes)}` : ""} · used in {m.usedIn}
                  </p>
                  <div className="mt-auto flex items-center gap-1 pt-1.5">
                    <a
                      href={`/api/media/${m.id}?download=1`}
                      className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
                      aria-label={`Download ${m.name}`}
                    >
                      <Download className="size-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        const n = window.prompt("Rename file", m.name);
                        if (n != null) act(() => renameMedia(m.id, n), "Could not rename.");
                      }}
                      disabled={pending}
                      className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-60"
                      aria-label="Rename"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    {projects.length > 0 ? (
                      <div className="relative flex-1">
                        <select
                          aria-label="Add to a project"
                          disabled={pending || !!converting}
                          defaultValue=""
                          onChange={(e) => {
                            const pid = e.target.value;
                            e.target.value = "";
                            if (pid) act(() => addMediaToProject(m.id, pid), "Could not add to project.");
                          }}
                          className="h-7 w-full rounded-md border border-border bg-background pl-6 pr-1 text-[11px] outline-none focus:border-primary disabled:opacity-60"
                        >
                          <option value="">Add to…</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>{p.title}</option>
                          ))}
                        </select>
                        <FolderPlus className="pointer-events-none absolute left-1.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete "${m.name}"? This removes it from your library and any projects using it.`))
                          act(() => deleteMedia(m.id), "Could not delete.");
                      }}
                      disabled={pending}
                      className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground hover:text-destructive disabled:opacity-60"
                      aria-label={`Delete ${m.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
