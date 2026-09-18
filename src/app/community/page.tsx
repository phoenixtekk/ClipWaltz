import Link from "next/link";
import Image from "next/image";
import { Heart, Play, Sparkles } from "lucide-react";
import { getPublicFeed } from "@/lib/feed";

export const metadata = {
  title: "Community feed",
  description: "Music videos made with ClipWaltz, shared by the community.",
};

export default async function FeedPage() {
  const items = await getPublicFeed();

  return (
    <div className="cw-landing min-h-screen">
      <header className="px-4 pt-4">
        <nav className="cw-glass-light mx-auto flex max-w-6xl items-center justify-between rounded-2xl px-4 py-2.5">
          <Link href="/" aria-label="ClipWaltz home">
            <Image src="/logo-name-1.png" alt="ClipWaltz" width={1204} height={306} className="h-7 w-auto" />
          </Link>
          <Link
            href="/sign-up"
            className="cw-gradient cw-sheen inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white"
          >
            Start free
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((it) => (
              <Link
                key={it.renderId}
                href={`/w/${it.renderId}`}
                className="cw-glass cw-lift group overflow-hidden rounded-2xl"
              >
                <div
                  className={`relative flex items-center justify-center bg-gradient-to-br from-[color:var(--cw-blue)]/25 via-[color:var(--cw-magenta)]/20 to-[color:var(--cw-coral)]/20 ${
                    it.aspect === "16:9" ? "aspect-[16/9]" : "aspect-[9/16]"
                  }`}
                >
                  <div className="flex size-11 items-center justify-center rounded-full bg-white/85 transition-transform group-hover:scale-110">
                    <Play className="size-4 translate-x-0.5 fill-slate-900 text-slate-900" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{it.title}</p>
                    <p className="cw-subtle truncate text-xs">by {it.creator}</p>
                  </div>
                  <span className="cw-subtle inline-flex shrink-0 items-center gap-1 text-xs">
                    <Heart className="size-3.5" /> {it.likes}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
