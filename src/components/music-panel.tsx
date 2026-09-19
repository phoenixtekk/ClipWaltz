"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Music, Play, Pause, Check, VolumeX, Heart, Sparkles, Star, Shuffle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import type { Track } from "@/lib/music";
import { setProjectMusic } from "@/lib/project-actions";
import { toggleFavorite } from "@/lib/music-actions";
import { getWaltzRecommendations } from "@/lib/waltzmatch-actions";

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
  embedded = false,
}: {
  projectId: string;
  tracks: Track[];
  musicTrackId: string | null;
  favorites: string[];
  embedded?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<TabKey>("browse");
  const [q, setQ] = useState("");
  const [auditionId, setAuditionId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set(initialFavorites));
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // WaltzMatch (For You) state — cached for the session once run.
  const [waltz, setWaltz] = useState<{ label: string; source: string; recs: { trackId: string; matchPct: number }[] } | null>(null);
  const [waltzLoading, setWaltzLoading] = useState(false);
  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);

  async function runWaltzMatch() {
    setWaltzLoading(true);
    try {
      setWaltz(await getWaltzRecommendations(projectId));
    } catch (e) {
      toast.error((e as Error).message || "Could not analyze your media.");
    } finally {
      setWaltzLoading(false);
    }
  }

  function surpriseMe() {
    const recs = waltz?.recs ?? [];
    if (recs.length === 0) return;
    // Weight toward the top matches.
    const pool = recs.slice(0, Math.min(4, recs.length));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    select(pick.trackId);
    const t = trackById.get(pick.trackId);
    if (t) toast.success(`WaltzMatch picked “${t.title}”`);
  }

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
    <section className={embedded ? "space-y-3" : "cw-glass space-y-3 rounded-xl p-3 lg:sticky lg:top-6 lg:self-start"}>
      {embedded ? null : (
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Music className="size-4 text-primary" /> Music
        </h2>
      )}

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
        <div className="space-y-2">
          {!waltz ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-center">
              <Sparkles className="mx-auto size-5 text-[color:var(--cw-violet)]" />
              <p className="mt-1 text-sm font-medium">WaltzMatch</p>
              <p className="mb-3 text-xs text-muted-foreground">
                We&apos;ll read your photos &amp; videos and recommend soundtracks that fit.
              </p>
              <button
                type="button"
                onClick={runWaltzMatch}
                disabled={waltzLoading}
                className="cw-gradient inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {waltzLoading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {waltzLoading ? "Analyzing your media…" : "Find my soundtrack"}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  For your video: <span className="font-medium text-foreground">{waltz.label}</span>
                </p>
                <button type="button" onClick={runWaltzMatch} disabled={waltzLoading} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-60">
                  {waltzLoading ? "…" : "Re-scan"}
                </button>
              </div>
              <button
                type="button"
                onClick={surpriseMe}
                disabled={pending}
                className="flex w-full items-center justify-center gap-1.5 rounded-full border border-[color:var(--cw-violet)]/40 bg-[color:var(--cw-violet)]/10 px-4 py-2 text-sm font-semibold text-[color:var(--cw-violet)] disabled:opacity-60"
              >
                <Shuffle className="size-4" /> Surprise Me
              </button>
              <div className="flex max-h-[22rem] flex-col gap-1.5 overflow-y-auto pr-1">
                {waltz.recs.map((rec) => {
                  const t = trackById.get(rec.trackId);
                  if (!t) return null;
                  return (
                    <TrackRow
                      key={rec.trackId}
                      track={t}
                      badge={`${rec.matchPct}%`}
                      selected={musicTrackId === rec.trackId}
                      playing={auditionId === rec.trackId}
                      favorited={favorites.has(rec.trackId)}
                      onAudition={() => audition(rec.trackId)}
                      onSelect={() => select(rec.trackId)}
                      onFavorite={() => favorite(rec.trackId)}
                      disabled={pending}
                    />
                  );
                })}
              </div>
            </>
          )}
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
  badge,
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
  badge?: string;
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
      {badge ? (
        <span className="shrink-0 rounded-full bg-[color:var(--cw-violet)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--cw-violet)]">
          {badge}
        </span>
      ) : null}
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
