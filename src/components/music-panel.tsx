"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Music, Play, Pause, Check, VolumeX, Heart, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import type { Track } from "@/lib/music";
import { setProjectMusic } from "@/lib/project-actions";
import { toggleFavorite } from "@/lib/music-actions";

type TabKey = "foryou" | "browse" | "premium" | "mymusic";
const TABS: { key: TabKey; label: string }[] = [
  { key: "foryou", label: "For You" },
  { key: "browse", label: "Browse" },
  { key: "premium", label: "Premium" },
  { key: "mymusic", label: "My Music" },
];

/**
 * Music side-panel. Sources tracks through the Music Provider Layer (provider-agnostic:
 * cards say "Included" / "Real Artist", never the API name), with per-track ▶ audition,
 * favourites ("My Music"), and a For You tab reserved for WaltzMatch recommendations.
 */
export function MusicPanel({
  projectId,
  tracks,
  musicTrackId,
  favorites: initialFavorites,
}: {
  projectId: string;
  tracks: Track[];
  musicTrackId: string | null;
  favorites: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<TabKey>("browse");
  const [q, setQ] = useState("");
  const [auditionId, setAuditionId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set(initialFavorites));
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const shown = useMemo(() => {
    let list = tracks;
    if (tab === "premium") list = tracks.filter((t) => t.premium);
    else if (tab === "mymusic") list = tracks.filter((t) => favorites.has(t.id));
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((t) => `${t.title} ${t.mood ?? ""} ${t.artist ?? ""}`.toLowerCase().includes(needle));
    }
    return list;
  }, [tracks, tab, favorites, q]);

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

  function favorite(id: string) {
    const next = new Set(favorites);
    const wasFav = next.has(id);
    if (wasFav) next.delete(id);
    else next.add(id);
    setFavorites(next);
    void toggleFavorite(id).catch(() => {
      // revert on failure
      setFavorites((cur) => {
        const s = new Set(cur);
        if (wasFav) s.add(id);
        else s.delete(id);
        return s;
      });
      toast.error("Could not update favourite.");
    });
  }

  return (
    <section className="cw-glass space-y-3 rounded-xl p-3 lg:sticky lg:top-6 lg:self-start">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        <Music className="size-4 text-primary" /> Music
      </h2>

      {/* tabs */}
      <div className="flex gap-1 rounded-lg bg-muted/50 p-0.5 text-xs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 rounded-md px-1.5 py-1 font-medium transition-colors",
              tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "browse" ? (
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${tracks.length} tracks…`} className="h-8" />
      ) : null}

      {tab === "foryou" ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-center">
          <Sparkles className="mx-auto size-5 text-[color:var(--cw-violet)]" />
          <p className="mt-1 text-sm font-medium">WaltzMatch</p>
          <p className="text-xs text-muted-foreground">
            Smart soundtrack picks from your photos &amp; videos — coming soon.
          </p>
        </div>
      ) : (
        <div className="flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto pr-1 lg:max-h-[calc(100vh-15rem)]">
          {tab === "browse" ? (
            <TrackRow
              noMusic
              selected={!musicTrackId}
              onSelect={() => select(null)}
              disabled={pending}
            />
          ) : null}

          {shown.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              selected={musicTrackId === t.id}
              playing={auditionId === t.id}
              favorited={favorites.has(t.id)}
              onAudition={() => audition(t.id)}
              onSelect={() => select(t.id)}
              onFavorite={() => favorite(t.id)}
              disabled={pending}
            />
          ))}

          {shown.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              {tab === "premium"
                ? "Premium catalogs (real-artist music) light up when a partner is connected."
                : tab === "mymusic"
                  ? "No favourites yet — tap the ♥ on a track to save it here."
                  : `No tracks match “${q}”.`}
            </p>
          ) : null}
        </div>
      )}

      <p className="text-xs text-muted-foreground">▶ preview · ♥ save to My Music · tap a track to use it.</p>
      <audio ref={audioRef} onEnded={() => setAuditionId(null)} className="hidden" />
    </section>
  );
}

function TrackRow({
  track,
  noMusic,
  selected,
  playing,
  favorited,
  onAudition,
  onSelect,
  onFavorite,
  disabled,
}: {
  track?: Track;
  noMusic?: boolean;
  selected: boolean;
  playing?: boolean;
  favorited?: boolean;
  onAudition?: () => void;
  onSelect: () => void;
  onFavorite?: () => void;
  disabled?: boolean;
}) {
  if (noMusic) {
    return (
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-pressed={selected}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-60",
          selected ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40",
        )}
      >
        <VolumeX className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm">No music</span>
        {selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
      </button>
    );
  }
  if (!track) return null;
  const source = track.premium ? "Real Artist" : "Included";
  const sub = [source, track.mood, track.bpm ? `${track.bpm} BPM` : null].filter(Boolean).join(" • ");
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-1.5 py-1.5 transition-colors",
        selected ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40",
      )}
    >
      <button
        type="button"
        onClick={onAudition}
        aria-label={playing ? `Pause ${track.title}` : `Preview ${track.title}`}
        aria-pressed={playing}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors",
          playing ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary hover:text-primary",
        )}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
      <button type="button" onClick={onSelect} disabled={disabled} aria-pressed={selected} className="min-w-0 flex-1 text-left disabled:opacity-60">
        <span className="flex items-center gap-1 truncate text-sm font-medium">
          {track.premium ? <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" /> : null}
          <span className="truncate">{track.title}</span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </button>
      <button
        type="button"
        onClick={onFavorite}
        aria-label={favorited ? "Remove from My Music" : "Save to My Music"}
        aria-pressed={favorited}
        className="shrink-0 p-1 text-muted-foreground transition-colors hover:text-rose-500"
      >
        <Heart className={cn("size-4", favorited && "fill-rose-500 text-rose-500")} />
      </button>
      {selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
    </div>
  );
}
