"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Trash2, Film, Image as ImageIcon, Type, Sparkles, Eye, X, Loader2 } from "lucide-react";
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

const LIGHT_FX = [
  { key: "none", label: "None" },
  { key: "vignette", label: "Vignette" },
  { key: "glow", label: "Glow" },
  { key: "grain", label: "Film grain" },
  { key: "dreamy", label: "Dreamy" },
  { key: "noir", label: "Noir" },
];

const LENGTH_PRESETS = [
  { s: 15, label: "15s" },
  { s: 30, label: "30s" },
  { s: 60, label: "1m" },
  { s: 120, label: "2m" },
  { s: 180, label: "3m" },
  { s: 240, label: "4m" },
  { s: 300, label: "5m" },
];

export function ProjectEditor({
  projectId,
  assets,
  lengthSec,
  aspect,
  titleText,
  styleFilter,
  lightFx,
  transition,
  motion,
  fades,
  fadeOut,
  smartCut,
  beatSync,
  waltzToMusic,
  describe,
  loopToFill,
  hasRender,
  section,
}: {
  projectId: string;
  assets: AssetSummary[];
  lengthSec: number;
  aspect: string;
  titleText: string | null;
  styleFilter: string;
  lightFx: string;
  transition: string;
  motion: boolean;
  fades: boolean;
  fadeOut: boolean;
  smartCut: boolean;
  beatSync: boolean;
  waltzToMusic: boolean;
  describe: boolean;
  loopToFill: boolean;
  hasRender: boolean;
  section?: "clips" | "format" | "style";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(titleText ?? "");

  const isCustomLength = !LENGTH_PRESETS.some((p) => p.s === lengthSec);
  const [customMin, setCustomMin] = useState(isCustomLength ? String(Math.round(lengthSec / 60)) : "");
  const [preview, setPreview] = useState<{ id: string; kind: string; name: string } | null>(null);
  const show = (s: "clips" | "format" | "style") => !section || section === s;

  const runAction = (fn: () => Promise<unknown>, err: string) =>
    start(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || err);
      }
    });

  const applyCustomLength = () => {
    const m = Math.round(Number(customMin));
    if (!Number.isFinite(m) || m < 1) {
      toast.error("Enter a length of 1–60 minutes.");
      return;
    }
    const minutes = Math.min(60, Math.max(1, m));
    setCustomMin(String(minutes));
    runAction(() => setProjectLength(projectId, minutes * 60), "Could not set length.");
  };

  return (
    <div className={cn("space-y-6", pending && "opacity-60")}>
      {show("clips") ? (
      <section className="cw-glass space-y-3 rounded-xl p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Film className="size-4 text-[color:var(--cw-violet)]" /> Clips · in order
        </h2>
        {assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clips — import some first.</p>
        ) : (
          <ul className="space-y-2">
            {assets.map((a, i) => {
              const converting = a.uploadState === "uploaded" && !!a.sourceFormat && a.conversionState !== "ready" && a.conversionState !== "failed";
              const failed = a.conversionState === "failed";
              const ready = a.uploadState === "uploaded" && !converting && !failed;
              return (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
              >
                <span className="w-5 text-xs text-muted-foreground">{i + 1}</span>
                {converting ? (
                  <div className="relative flex size-12 shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border border-border bg-muted">
                    <Loader2 className="size-4 animate-spin text-[color:var(--cw-violet)]" />
                    <span className="text-[8px] font-semibold text-muted-foreground">360</span>
                  </div>
                ) : failed ? (
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-destructive/40 bg-destructive/10 text-[9px] font-semibold text-destructive">
                    360 ✕
                  </div>
                ) : ready ? (
                  <button
                    type="button"
                    onClick={() => setPreview({ id: a.id, kind: a.kind, name: a.name })}
                    aria-label={`Preview ${a.name}`}
                    className="group relative size-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted"
                  >
                    {a.kind === "video" ? (
                      <video
                        src={`/api/projects/${projectId}/assets/${a.id}#t=0.1`}
                        muted
                        playsInline
                        preload="metadata"
                        className="size-full object-cover"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/projects/${projectId}/assets/${a.id}`} alt="" className="size-full object-cover" />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/40 group-hover:opacity-100">
                      <Eye className="size-4 text-white" />
                    </span>
                    {a.kind === "video" ? (
                      <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 p-0.5">
                        <Film className="size-2.5 text-white" />
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                    {a.kind === "video" ? (
                      <Film className="size-4 text-muted-foreground" />
                    ) : (
                      <ImageIcon className="size-4 text-muted-foreground" />
                    )}
                  </div>
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
              );
            })}
          </ul>
        )}
      </section>
      ) : null}

      {show("format") ? (
      <div className="grid gap-6 sm:grid-cols-2">
      {/* aspect */}
      <section className="cw-glass space-y-2 rounded-xl p-4">
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
        {hasRender ? (
          <p className="text-xs text-muted-foreground">
            Changing the aspect re-frames the video — click <b>Render HD</b> again to produce the new
            version.
          </p>
        ) : null}
      </section>

      {/* length */}
      <section className="cw-glass space-y-2 rounded-xl p-4">
        <h2 className="text-sm font-medium">Length</h2>
        <div className="flex flex-wrap gap-2">
          {LENGTH_PRESETS.map(({ s, label }) => (
            <TrackChip
              key={s}
              selected={lengthSec === s}
              label={label}
              onClick={() => runAction(() => setProjectLength(projectId, s), "Could not set length.")}
              disabled={pending}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <label htmlFor="cw-len" className="text-xs text-muted-foreground">Custom</label>
          <Input
            id="cw-len"
            type="number"
            min={1}
            max={60}
            value={customMin}
            disabled={pending}
            onChange={(e) => setCustomMin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyCustomLength();
            }}
            placeholder="e.g. 10"
            className="h-8 w-20"
          />
          <span className="text-xs text-muted-foreground">min (max 60)</span>
          <button
            type="button"
            onClick={applyCustomLength}
            disabled={pending || !customMin.trim()}
            aria-pressed={isCustomLength}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
              isCustomLength
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {isCustomLength ? `Set · ${Math.round(lengthSec / 60)}m` : "Set"}
          </button>
        </div>
        <div className="border-t border-border/60 pt-2">
          <TrackChip
            selected={loopToFill}
            label="🔁 Loop to fill length"
            onClick={() => runAction(() => setProjectStyle(projectId, { loopToFill: !loopToFill }), "Could not toggle loop.")}
            disabled={pending}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {loopToFill
              ? "Repeats your footage to reach the full length above."
              : "Makes the video as long as your footage allows (up to the length above) — no repeats."}
          </p>
        </div>
      </section>
      </div>
      ) : null}

      {show("style") ? (
      <section className="cw-glass space-y-4 rounded-xl p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4 text-[color:var(--cw-violet)]" /> Style
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

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Lighting</p>
          <div className="flex flex-wrap gap-2">
            {LIGHT_FX.map((f) => (
              <TrackChip
                key={f.key}
                selected={lightFx === f.key}
                label={f.label}
                onClick={() => runAction(() => setProjectStyle(projectId, { lightFx: f.key }), "Could not set lighting.")}
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
                selected={waltzToMusic}
                label="💃 Waltz to the Music"
                onClick={() => runAction(() => setProjectStyle(projectId, { waltzToMusic: !waltzToMusic }), "Could not toggle Waltz to the Music.")}
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
                label="Fade in"
                onClick={() => runAction(() => setProjectStyle(projectId, { fades: !fades }), "Could not toggle fade in.")}
                disabled={pending}
              />
              <TrackChip
                selected={fadeOut}
                label="Fade out ending"
                onClick={() => runAction(() => setProjectStyle(projectId, { fadeOut: !fadeOut }), "Could not toggle fade out.")}
                disabled={pending}
              />
              <TrackChip
                selected={describe}
                label="📝 Describe (YouTube text)"
                onClick={() => runAction(() => setProjectStyle(projectId, { describe: !describe }), "Could not toggle describe.")}
                disabled={pending}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Smart cut keeps the liveliest moment of each video; Beat sync times cuts to the music;
              Waltz to the Music varies the pace with the song&apos;s energy and ends on a beat.
            </p>
          </div>
        </div>
      </section>
      ) : null}

      {preview ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${preview.name}`}
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <button
            type="button"
            aria-label="Close preview"
            onClick={() => setPreview(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="size-5" />
          </button>
          <div className="max-h-[85vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            {preview.kind === "video" ? (
              <video
                src={`/api/projects/${projectId}/assets/${preview.id}`}
                controls
                autoPlay
                playsInline
                className="max-h-[85vh] max-w-[90vw] rounded-lg"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/projects/${projectId}/assets/${preview.id}`}
                alt={preview.name}
                className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
              />
            )}
            <p className="mt-2 truncate text-center text-sm text-white/80">{preview.name}</p>
          </div>
        </div>
      ) : null}
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
