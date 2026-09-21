"use client";
import { useState } from "react";
import { X, AlertTriangle, AlertCircle, Info, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { RenderCheckpoint, CheckLevel } from "@/lib/render";

export const SKIP_KEY = "cw-skip-render-checkpoint";

const LEVEL_STYLE: Record<CheckLevel, string> = {
  red: "border-destructive/40 bg-destructive/10 text-destructive",
  yellow: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  info: "border-border bg-muted/40 text-muted-foreground",
};
function LevelIcon({ level }: { level: CheckLevel }) {
  if (level === "red") return <AlertCircle className="size-4 shrink-0" />;
  if (level === "yellow") return <AlertTriangle className="size-4 shrink-0" />;
  return <Info className="size-4 shrink-0" />;
}

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
};

export function RenderCheckpointModal({
  checkpoint,
  isRerender,
  pending,
  onConfirm,
  onCancel,
}: {
  checkpoint: RenderCheckpoint;
  isRerender: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [skip, setSkip] = useState(false);

  const confirm = () => {
    try {
      if (skip) localStorage.setItem(SKIP_KEY, "1");
      else localStorage.removeItem(SKIP_KEY);
    } catch {
      /* ignore blocked storage */
    }
    onConfirm();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm render"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cw-glass max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="cw-gradient-text text-lg font-semibold tracking-tight">
              {isRerender ? "Re-render this video?" : "Ready to render?"}
            </h2>
            <p className="text-sm text-muted-foreground">Check the settings before we build it.</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* projected output */}
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-[color:var(--cw-violet)]/30 bg-[color:var(--cw-violet)]/10 px-3 py-2 text-sm">
          <Sparkles className="size-4 text-[color:var(--cw-violet)]" />
          <span className="font-medium">
            ~{fmt(checkpoint.projectedSec)} · {checkpoint.aspect} · {checkpoint.clips} clip
            {checkpoint.clips === 1 ? "" : "s"} · {checkpoint.musicTitle ?? "default track"}
          </span>
        </div>

        {/* what changed since last render */}
        {checkpoint.changes.length ? (
          <div className="mb-3 rounded-xl border border-border bg-card/60 px-3 py-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Changed since last render</p>
            <ul className="flex flex-wrap gap-1.5">
              {checkpoint.changes.map((c, i) => (
                <li
                  key={i}
                  className="rounded-full bg-[color:var(--cw-blue)]/10 px-2 py-0.5 text-xs font-medium text-[color:var(--cw-blue)]"
                >
                  {c}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* warnings */}
        {checkpoint.warnings.length ? (
          <div className="mb-3 space-y-1.5">
            {checkpoint.warnings.map((w, i) => (
              <div
                key={i}
                className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-xs", LEVEL_STYLE[w.level])}
              >
                <LevelIcon level={w.level} />
                <span>{w.text}</span>
              </div>
            ))}
          </div>
        ) : null}

        {/* settings summary */}
        <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card/60 p-3 text-sm">
          {checkpoint.summary.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{s.label}</dt>
              <dd className="truncate font-medium capitalize">{s.value}</dd>
            </div>
          ))}
        </dl>

        <label className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={skip}
            onChange={(e) => setSkip(e.target.checked)}
            className="size-3.5 rounded border-border"
          />
          Don&apos;t show this again for quick renders (we&apos;ll still warn when something looks off).
        </label>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Back to edit
          </Button>
          <Button onClick={confirm} disabled={pending || checkpoint.hasBlocking}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {isRerender ? "Confirm re-render" : "Confirm render"}
            {!pending ? <ArrowRight className="size-4" /> : null}
          </Button>
        </div>
      </div>
    </div>
  );
}
