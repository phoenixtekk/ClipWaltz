import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getSharedRender } from "@/lib/feed";
import { LikeButton } from "@/components/like-button";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getSharedRender(id);
  return {
    title: r ? `${r.title} — ClipWaltz` : "ClipWaltz",
    description: r ? `A ClipWaltz music video by ${r.creator}.` : undefined,
  };
}

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getSharedRender(id);
  if (!r) notFound();
  const wide = r.aspect === "16:9";

  return (
    <div className="cw-landing flex min-h-screen flex-col">
      <header className="px-4 pt-4">
        <nav className="cw-glass-light mx-auto flex max-w-4xl items-center justify-between rounded-2xl px-4 py-2.5">
          <Link href="/" aria-label="ClipWaltz home">
            <Image src="/logo-name-1.png" alt="ClipWaltz" width={1204} height={306} className="h-7 w-auto" />
          </Link>
          <Link
            href="/community"
            className="text-sm font-medium text-slate-700 transition-colors hover:text-slate-950"
          >
            Community
          </Link>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center px-5 py-10">
        <div
          className={`cw-glass cw-metal relative w-full overflow-hidden rounded-3xl bg-black ${
            wide ? "max-w-3xl" : "max-w-sm"
          }`}
        >
          <video
            src={`/api/renders/${r.renderId}/watch`}
            controls
            autoPlay
            muted
            loop
            playsInline
            className={`w-full ${wide ? "aspect-[16/9]" : "aspect-[9/16]"} object-contain`}
          />
        </div>

        <div className="mt-6 flex w-full max-w-3xl flex-col items-center gap-3 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
          <p className="cw-subtle text-sm">by {r.creator}</p>
          <LikeButton renderId={r.renderId} initialLiked={r.likedByMe} initialCount={r.likes} />
        </div>

        <div className="cw-glass mt-10 flex w-full max-w-2xl flex-col items-center gap-3 rounded-2xl p-6 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="cw-muted text-sm">
            Made with <span className="cw-gradient-text font-semibold">ClipWaltz</span> — turn your
            photos & clips into a music video in a minute.
          </p>
          <Link
            href="/sign-up"
            className="cw-gradient cw-sheen inline-flex shrink-0 items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold text-white"
          >
            Try it free <ArrowRight className="size-4" />
          </Link>
        </div>
      </main>
    </div>
  );
}
