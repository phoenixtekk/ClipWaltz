import Link from "next/link";
import Image from "next/image";
import { Heart, Play, Sparkles, Trophy, Crown, Award } from "lucide-react";
import { getPublicFeed } from "@/lib/feed";
import { getActiveContest, getContestBoard } from "@/lib/contest";
import { getTopLiked, getTopPosters, type LeaderRow } from "@/lib/community";
import { getChatMessages } from "@/lib/chat";
import { getAuthUserId } from "@/lib/auth";
import { CommunityChat } from "@/components/community-chat";
import { aspectClass, aspectDims } from "@/lib/aspect";
import { masonry } from "@/lib/masonry";
import { VideoPreview } from "@/components/video-preview";

export const metadata = {
  title: "Community feed",
  description: "Music videos made with ClipWaltz, shared by the community.",
};

// Column counts per breakpoint (only one set is displayed; hidden copies never load their previews).
const FEED_COLS = [[2, "flex sm:hidden"], [3, "hidden sm:flex"]] as const;
const BOARD_COLS = [[2, "flex sm:hidden"], [3, "hidden sm:flex lg:hidden"], [6, "hidden lg:flex"]] as const;
/** A card's height relative to its width: the preview's shape plus the caption under it. */
const cardHeight = (aspect: string, caption: number) => {
  const { w, h } = aspectDims(aspect);
  return h / w + caption;
};

export default async function FeedPage() {
  const userId = await getAuthUserId();
  const [items, active, topLiked, topPosters, chat] = await Promise.all([
    getPublicFeed(),
    getActiveContest(),
    getTopLiked(),
    getTopPosters(),
    userId ? getChatMessages() : Promise.resolve([]),
  ]);
  const board = active ? await getContestBoard(active.id, 6) : [];

  return (
    <div className="cw-landing min-h-screen">
      <header className="px-4 pt-4">
        <nav className="cw-glass-light mx-auto flex max-w-6xl items-center justify-between rounded-2xl px-4 py-2.5">
          <Link href="/" aria-label="ClipWaltz home">
            <Image src="/logo-name-1.png" alt="ClipWaltz" width={1204} height={306} className="h-7 w-auto" />
          </Link>
          <Link
            href={userId ? "/projects" : "/sign-up"}
            className="cw-gradient cw-sheen inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white"
          >
            {userId ? "My projects" : "Start free"}
          </Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 py-10">
        <div className="mx-auto mb-8 max-w-2xl text-center">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-[color:var(--cw-violet)]">
            <Sparkles className="size-4" /> Community
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Made with ClipWaltz</h1>
          <p className="cw-muted mt-2">Real music videos shared by creators. Make yours in a minute.</p>
        </div>

        {/* Monthly Theme Challenge banner */}
        {active ? (
          <section className="cw-glass mb-8 overflow-hidden rounded-3xl p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-[color:var(--cw-violet)]">
                  <Trophy className="size-3.5" /> Monthly Theme Challenge
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight">{active.theme}</h2>
                {active.description ? <p className="cw-muted mt-1 max-w-xl text-sm">{active.description}</p> : null}
                <p className="cw-subtle mt-2 text-xs">
                  Likes are votes — the winner gets <span className="font-semibold">ClipWaltz Pro</span>.{" "}
                  {userId ? (
                    <Link href="/projects" className="font-medium text-[color:var(--cw-violet)] hover:underline">
                      Enter yours from the editor →
                    </Link>
                  ) : (
                    <Link href="/sign-up" className="font-medium text-[color:var(--cw-violet)] hover:underline">
                      Start free to enter →
                    </Link>
                  )}
                </p>
              </div>
            </div>
            {board.length > 0 ? (
              <div className="mt-5 border-t border-border/60 pt-5">
                {/* Pinterest-style columns: each tile sits right under the one above — no stretched gaps. */}
                {BOARD_COLS.map(([n, cls]) => (
                  <div key={n} className={`${cls} gap-3`}>
                    {masonry(board.map((e, i) => ({ e, i })), n, ({ e }) => cardHeight(e.aspect, 0.15)).map((col, c) => (
                      <div key={c} className="flex min-w-0 flex-1 flex-col gap-3">
                        {col.map(({ e, i }) => (
                  <Link key={e.renderId} href={`/w/${e.renderId}`} className="cw-lift group block">
                    <div
                      className={`relative flex items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[color:var(--cw-blue)]/25 via-[color:var(--cw-magenta)]/20 to-[color:var(--cw-coral)]/20 ${
                        aspectClass(e.aspect)
                      }`}
                    >
                      <VideoPreview renderId={e.renderId} />
                      {i === 0 ? (
                        <span className="absolute left-1.5 top-1.5 z-10 inline-flex items-center gap-0.5 rounded-full bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">
                          <Crown className="size-3" /> 1st
                        </span>
                      ) : (
                        <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          #{i + 1}
                        </span>
                      )}
                      <Play className="relative size-4 translate-x-0.5 fill-white text-white opacity-80 drop-shadow transition-transform group-hover:scale-110" />
                    </div>
                    <p className="cw-subtle mt-1 flex items-center justify-between gap-1 text-[11px]">
                      <span className="truncate">{e.creator}</span>
                      <span className="inline-flex shrink-0 items-center gap-0.5">
                        <Heart className="size-3" /> {e.likes}
                      </span>
                    </p>
                  </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p className="cw-subtle mt-4 border-t border-border/60 pt-4 text-sm">
                No entries yet — be the first to enter this month&apos;s theme.
              </p>
            )}
          </section>
        ) : null}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          {/* Feed */}
          <div className="min-w-0">
            {items.length === 0 ? (
              <div className="cw-glass mx-auto max-w-md rounded-2xl p-10 text-center">
                <p className="cw-muted">No public creations yet — be the first to share one!</p>
                <Link
                  href="/sign-up"
                  className="cw-gradient cw-sheen mt-5 inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Start free
                </Link>
              </div>
            ) : (
              <>
                {/* Pinterest-style columns: landscape cards end under their title and the next card follows right below. */}
                {FEED_COLS.map(([n, cls]) => (
                  <div key={n} className={`${cls} items-start gap-4`}>
                    {masonry(items, n, (it) => cardHeight(it.aspect, 0.3)).map((col, c) => (
                      <div key={c} className="flex min-w-0 flex-1 flex-col gap-4">
                        {col.map((it) => (
                          <div key={it.renderId} className="cw-glass cw-lift overflow-hidden rounded-2xl">
                            <Link href={`/w/${it.renderId}`} className="group block" aria-label={`Watch ${it.title}`}>
                              <div
                                className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-[color:var(--cw-blue)]/25 via-[color:var(--cw-magenta)]/20 to-[color:var(--cw-coral)]/20 ${
                                  aspectClass(it.aspect)
                                }`}
                              >
                                <VideoPreview renderId={it.renderId} />
                                {/* Play badge fades out while the preview plays on hover */}
                                <div className="pointer-events-none relative flex size-11 items-center justify-center rounded-full bg-white/85 transition-all group-hover:scale-110 group-hover:opacity-0">
                                  <Play className="size-4 translate-x-0.5 fill-slate-900 text-slate-900" />
                                </div>
                              </div>
                            </Link>
                            <div className="flex items-center justify-between gap-2 p-3">
                              <div className="min-w-0">
                                <Link href={`/w/${it.renderId}`} className="block truncate text-sm font-medium hover:underline">
                                  {it.title}
                                </Link>
                                <Link href={`/u/${it.creatorId}`} className="cw-subtle block truncate text-xs hover:underline">
                                  by {it.creator}
                                </Link>
                              </div>
                              <span className="cw-subtle inline-flex shrink-0 items-center gap-1 text-xs">
                                <Heart className="size-3.5" /> {it.likes}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Sidebar: leaderboards + chat */}
          <aside className="space-y-6">
            <Leaderboard title="Top Contributors" subtitle="most-liked creators" icon={<Award className="size-4 text-[color:var(--cw-violet)]" />} rows={topLiked} unit="♥" />
            <Leaderboard title="Most Posted" subtitle="most creations shared" icon={<Sparkles className="size-4 text-[color:var(--cw-violet)]" />} rows={topPosters} unit="" />

            {userId ? (
              <CommunityChat initialMessages={chat} currentUserId={userId} />
            ) : (
              <div className="cw-glass rounded-2xl p-5 text-center">
                <p className="cw-muted text-sm">Sign in to join the community chat.</p>
                <Link
                  href="/sign-in"
                  className="cw-gradient cw-sheen mt-3 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white"
                >
                  Sign in
                </Link>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

function Leaderboard({
  title,
  subtitle,
  icon,
  rows,
  unit,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  rows: LeaderRow[];
  unit: string;
}) {
  return (
    <div className="cw-glass rounded-2xl p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">{icon} {title}</h3>
      <p className="cw-subtle mb-3 text-xs">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="cw-subtle text-xs">Nothing here yet.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.userId} className="flex items-center gap-2">
              <span className="w-4 text-xs font-semibold text-muted-foreground">{i + 1}</span>
              <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-xs font-medium">
                {r.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image} alt="" className="size-full object-cover" />
                ) : (
                  r.name.charAt(0).toUpperCase()
                )}
              </span>
              <Link href={`/u/${r.userId}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                {r.name}
              </Link>
              <span className="cw-subtle shrink-0 text-xs tabular-nums">
                {unit} {r.value}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
