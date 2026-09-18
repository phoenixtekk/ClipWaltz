"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Trash2, Film, Image as ImageIcon, Type, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AssetSummary } from "@/lib/assets";
import { deleteAsset } from "@/lib/asset-actions";
import {
  setProjectLength,
  setProjectAspect,
  setProjectStyle,
  moveAsset,
} from "@/lib/project-actions";

const FILTERS = [
  { key: "none", label: "None" },
  { key: "warm", label: "Warm" },
  { key: "cool", label: "Cool" },
  { key: "vivid", label: "Vivid" },
  { key: "bw", label: "B&W" },
  { key: "vintage", label: "Vintage" },
];

export function ProjectEditor({
  projectId,
  assets,
  lengthSec,
  aspect,
  titleText,
  styleFilter,
  transition,
  motion,
  fades,
  smartCut,
  beatSync,
}: {
  projectId: string;
  assets: AssetSummary[];
  lengthSec: number;
  aspect: string;
  titleText: string | null;
  styleFilter: string;
  transition: string;
  motion: boolean;
  fades: boolean;
  smartCut: boolean;
  beatSync: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(titleText ?? "");

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

      {/* style */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4" /> Style
        </h2>

        <div className="space-y-1.5">
          <label htmlFor="cw-title" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Type className="size-3.5" /> Title / caption (optional)
          </label>
          <Input
            id="cw-title"
            value={title}
            maxLength={80}
            placeholder="e.g. Italy 2026"
            disabled={pending}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if ((title.trim() || null) !== (titleText ?? null))
                runAction(() => setProjectStyle(projectId, { titleText: title }), "Could not save title.");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Filter</p>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <TrackChip
                key={f.key}
                selected={styleFilter === f.key}
                label={f.label}
                onClick={() => runAction(() => setProjectStyle(projectId, { styleFilter: f.key }), "Could not set filter.")}
                disabled={pending}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Transition</p>
            <div className="flex gap-2">
              {[{ k: "cut", l: "Cut" }, { k: "crossfade", l: "Crossfade" }].map((t) => (
                <TrackChip
                  key={t.k}
                  selected={transition === t.k}
                  label={t.l}
                  onClick={() => runAction(() => setProjectStyle(projectId, { transition: t.k }), "Could not set transition.")}
                  disabled={pending}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Effects</p>
            <div className="flex flex-wrap gap-2">
              <TrackChip
                selected={smartCut}
                label="✦ Smart cut"
                onClick={() => runAction(() => setProjectStyle(projectId, { smartCut: !smartCut }), "Could not toggle smart cut.")}
                disabled={pending}
              />
              <TrackChip
                selected={beatSync}
                label="♪ Beat sync"
                onClick={() => runAction(() => setProjectStyle(projectId, { beatSync: !beatSync }), "Could not toggle beat sync.")}
                disabled={pending}
              />
              <TrackChip
                selected={motion}
                label="Ken Burns"
                onClick={() => runAction(() => setProjectStyle(projectId, { motion: !motion }), "Could not toggle motion.")}
                disabled={pending}
              />
              <TrackChip
                selected={fades}
                label="Fade in/out"
                onClick={() => runAction(() => setProjectStyle(projectId, { fades: !fades }), "Could not toggle fades.")}
                disabled={pending}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Smart cut keeps the liveliest moment of each video; Beat sync times cuts to the music.
            </p>
          </div>
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
