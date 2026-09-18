"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Music, Play, Pause, Check, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import type { Track } from "@/lib/music";
import { setProjectMusic } from "@/lib/project-actions";

/**
 * Music side-panel (owner queue #1): the soundtrack picker moved out of the main
 * editor column into a scrollable right-hand panel with per-track ▶ audition.
 * Audition streams the bed through the app proxy (@/app/api/music/[trackId]) with a
 * single shared <audio> element and never changes the selection — clicking a row's
 * body is what selects the project soundtrack.
 */
export function MusicPanel({
  projectId,
  tracks,
  musicTrackId,
}: {
  projectId: string;
  tracks: Track[];
  musicTrackId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [auditionId, setAuditionId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const filtered = q.trim()
    ? tracks.filter((t) =>
        `${t.title} ${t.mood ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()),
      )
    : tracks;

  function select(id: string | null) {
    start(async () => {
      try {
        await setProjectMusic(projectId, id);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not update music.");
      }
    });
  }

  function audition(id: string) {
    const el = audioRef.current;
    if (!el) return;
    if (auditionId === id) {
      el.pause();
      setAuditionId(null);
      return;
    }
    el.src = `/api/music/${id}`;
    el.currentTime = 0;
    setAuditionId(id);
    el.play().catch(() => setAuditionId(null));
  }

  return (
    <section className="cw-glass space-y-3 rounded-xl p-3 lg:sticky lg:top-6 lg:self-start">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        <Music className="size-4 text-primary" /> Music
      </h2>

      {tracks.length > 10 ? (
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${tracks.length} tracks…`}
          className="h-8"
        />
      ) : null}

      <div className="flex max-h-[28rem] flex-col gap-1.5 overflow-y-auto pr-1 lg:max-h-[calc(100vh-12rem)]">
        {/* No music */}
        <button
          type="button"
          onClick={() => select(null)}
          disabled={pending}
          aria-pressed={!musicTrackId}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-60",
            !musicTrackId
              ? "border-primary bg-primary/10"
              : "border-border bg-card hover:border-primary/40",
          )}
        >
          <VolumeX className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">No music</span>
          {!musicTrackId ? <Check className="size-4 shrink-0 text-primary" /> : null}
        </button>

        {filtered.map((t) => {
          const selected = musicTrackId === t.id;
          const playing = auditionId === t.id;
          const sub = [t.mood, t.bpm ? `${t.bpm} BPM` : null].filter(Boolean).join(" · ");
          return (
            <div
              key={t.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-1.5 py-1.5 transition-colors",
                selected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/40",
              )}
            >
              <button
                type="button"
                onClick={() => audition(t.id)}
                aria-label={playing ? `Pause preview of ${t.title}` : `Preview ${t.title}`}
                aria-pressed={playing}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors",
                  playing
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:border-primary hover:text-primary",
                )}
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <button
                type="button"
                onClick={() => select(t.id)}
                disabled={pending}
                aria-pressed={selected}
                className="min-w-0 flex-1 text-left disabled:opacity-60"
              >
                <span className="block truncate text-sm font-medium">{t.title}</span>
                {sub ? (
                  <span className="block truncate text-xs text-muted-foreground">{sub}</span>
                ) : null}
              </button>
              {selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
            </div>
          );
        })}

        {filtered.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">No tracks match &ldquo;{q}&rdquo;.</p>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        ▶ auditions a track; tap the name to set it as your soundtrack.
      </p>

      <audio ref={audioRef} onEnded={() => setAuditionId(null)} className="hidden" />
    </section>
  );
}
