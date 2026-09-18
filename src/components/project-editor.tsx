"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Trash2, Film, Image as ImageIcon, Music } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { AssetSummary } from "@/lib/assets";
import type { Track } from "@/lib/music";
import { deleteAsset } from "@/lib/asset-actions";
import { setProjectMusic, setProjectLength, setProjectAspect, moveAsset } from "@/lib/project-actions";

export function ProjectEditor({
  projectId,
  assets,
  tracks,
  musicTrackId,
  lengthSec,
  aspect,
}: {
  projectId: string;
  assets: AssetSummary[];
  tracks: Track[];
  musicTrackId: string | null;
  lengthSec: number;
  aspect: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const runAction = (fn: () => Promise<unknown>, err: string) =>
    start(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || err);
      }
    });

  return (
    <div className={cn("space-y-6", pending && "opacity-60")}>
      {/* clips */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Clips · in order</h2>
        {assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clips — import some first.</p>
        ) : (
          <ul className="space-y-2">
            {assets.map((a, i) => (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
              >
                <span className="w-5 text-xs text-muted-foreground">{i + 1}</span>
                {a.kind === "video" ? (
                  <Film className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move up"
                    disabled={pending || i === 0}
                    onClick={() => runAction(() => moveAsset(projectId, a.id, "up"), "Could not reorder.")}
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move down"
                    disabled={pending || i === assets.length - 1}
                    onClick={() => runAction(() => moveAsset(projectId, a.id, "down"), "Could not reorder.")}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Remove "${a.name}"?`))
                        runAction(() => deleteAsset(projectId, a.id), "Could not remove.");
                    }}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* music */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Music className="size-4" /> Music
        </h2>
        <div className="flex flex-wrap gap-2">
          <TrackChip
            selected={!musicTrackId}
            label="No music"
            onClick={() => runAction(() => setProjectMusic(projectId, null), "Could not update music.")}
            disabled={pending}
          />
          {tracks.map((t) => (
            <TrackChip
              key={t.id}
              selected={musicTrackId === t.id}
              label={`${t.title}${t.mood ? ` · ${t.mood}` : ""}${t.bpm ? ` · ${t.bpm} BPM` : ""}`}
              onClick={() => runAction(() => setProjectMusic(projectId, t.id), "Could not update music.")}
              disabled={pending}
            />
          ))}
        </div>
      </section>

      {/* aspect */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Aspect</h2>
        <div className="flex flex-wrap gap-2">
          {[
            { key: "9:16", label: "9:16 vertical" },
            { key: "16:9", label: "16:9 wide" },
          ].map((a) => (
            <TrackChip
              key={a.key}
              selected={aspect === a.key}
              label={a.label}
              onClick={() => runAction(() => setProjectAspect(projectId, a.key), "Could not set aspect.")}
              disabled={pending}
            />
          ))}
        </div>
      </section>

      {/* length */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Length</h2>
        <div className="flex flex-wrap gap-2">
          {[15, 30, 60].map((s) => (
            <TrackChip
              key={s}
              selected={lengthSec === s}
              label={`${s}s`}
              onClick={() => runAction(() => setProjectLength(projectId, s), "Could not set length.")}
              disabled={pending}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function TrackChip({
  selected,
  label,
  onClick,
  disabled,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
