"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Music, Film } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { AssetSummary } from "@/lib/assets";
import { buildDraftTimeline } from "@/lib/draft";

function fmt(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Fast, low-res draft preview (screen 06). Plays the ordered clips as a timed,
 * story-style slideshow with the chosen soundtrack — using the source media proxied
 * through the app — so users see "the magic" instantly, before committing to the async
 * HD render. Timing mirrors the worker (see @/lib/draft).
 */
export function DraftPreview({
  projectId,
  assets,
  musicTrackId,
  musicTrackTitle,
  lengthSec,
  aspect = "9:16",
}: {
  projectId: string;
  assets: AssetSummary[];
  musicTrackId: string | null;
  musicTrackTitle: string | null;
  lengthSec: number;
  aspect?: string;
}) {
  const wide = aspect === "16:9";
  const uploaded = useMemo(
    () =>
      assets.filter(
        (a) => a.uploadState === "uploaded" && (!a.sourceFormat || a.conversionState === "ready"),
      ),
    [assets],
  );
  const { clips, totalSec } = useMemo(
    () => buildDraftTimeline(uploaded, lengthSec),
    [uploaded, lengthSec],
  );
  // Stable signature of the timeline — changing it (reorder/length/music) resets playback.
  const sig = useMemo(
    () => clips.map((c) => `${c.id}:${c.durationSec}`).join("|") + `#${musicTrackId ?? ""}`,
    [clips, musicTrackId],
  );

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset to the start whenever the timeline changes (React's adjust-state-during-render
  // pattern — https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [prevSig, setPrevSig] = useState(sig);
  if (sig !== prevSig) {
    setPrevSig(sig);
    setIndex(0);
    setPlaying(false);
  }

  // Drive playback: advance one clip at a time, honoring the per-clip duration.
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const audio = audioRef.current;

    if (!playing || index >= clips.length) {
      audio?.pause();
      return;
    }
    if (audio && musicTrackId) audio.play().catch(() => {});
    const atEnd = index + 1 >= clips.length;
    const dur = clips[index].durationSec;
    timerRef.current = setTimeout(() => {
      if (atEnd) {
        setPlaying(false);
        setIndex(clips.length);
      } else {
        setIndex(index + 1);
      }
    }, Math.max(300, dur * 1000));
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [playing, index, clips, musicTrackId]);

  // Keep the current clip's <video> in sync with play/pause.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, index]);

  const finished = clips.length > 0 && index >= clips.length;
  const current = index < clips.length ? clips[index] : null;
  const elapsed = clips.slice(0, index).reduce((s, c) => s + c.durationSec, 0);

  function toggle() {
    if (clips.length === 0) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (finished) {
      setIndex(0);
      if (audioRef.current) audioRef.current.currentTime = 0;
    }
    setPlaying(true);
  }

  function restart() {
    setIndex(0);
    if (audioRef.current) audioRef.current.currentTime = 0;
    setPlaying(true);
  }

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        <Film className="size-4" /> Draft preview
        <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
          low-res · {aspect}
        </span>
      </h2>

      <div className={cn("mx-auto flex w-full flex-col gap-3", wide ? "max-w-[420px]" : "max-w-[240px]")}>
        {/* preview stage */}
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-xl border border-border bg-black",
            wide ? "aspect-[16/9]" : "aspect-[9/16]",
          )}
        >
          {clips.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-white/70">
              Import clips to preview your draft.
            </div>
          ) : current?.kind === "video" ? (
            <video
              key={index}
              ref={videoRef}
              src={`/api/projects/${projectId}/assets/${current.id}`}
              muted
              playsInline
              preload="auto"
              className="h-full w-full object-cover"
            />
          ) : current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={`/api/projects/${projectId}/assets/${current.id}`}
              alt={current.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
              <span className="text-sm font-medium">Draft complete</span>
              <Button size="sm" variant="secondary" onClick={restart}>
                <RotateCcw className="size-4" /> Replay
              </Button>
            </div>
          )}

          {/* story-style progress segments */}
          {clips.length > 0 && (
            <div className="absolute inset-x-2 top-2 flex gap-1">
              {clips.map((c, i) => (
                <div
                  key={i}
                  className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30"
                >
                  <div
                    className={cn(
                      "h-full rounded-full bg-white",
                      i < index ? "w-full" : "w-0",
                      i === index && playing && "animate-pulse",
                    )}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* controls */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Button
              size="icon-sm"
              onClick={toggle}
              disabled={clips.length === 0}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={restart}
              disabled={clips.length === 0}
              aria-label="Restart"
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {fmt(finished ? totalSec : elapsed)} / {fmt(totalSec)}
          </span>
        </div>

        <p className="flex items-center gap-1.5 text-center text-xs text-muted-foreground">
          <Music className="size-3.5 shrink-0" />
          <span className="truncate">{musicTrackTitle ?? "No music"}</span>
        </p>
      </div>

      {musicTrackId && (
        <audio
          ref={audioRef}
          src={`/api/music/${musicTrackId}`}
          loop
          preload="auto"
          className="hidden"
        />
      )}
    </section>
  );
}
