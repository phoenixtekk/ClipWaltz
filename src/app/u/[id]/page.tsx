import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Heart, Play, Globe, AtSign, Video, Music2 } from "lucide-react";
import { getPublicProfile, socialUrl } from "@/lib/profile";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPublicProfile(id);
  return {
    title: p ? `${p.name} — ClipWaltz` : "ClipWaltz",
    description: p ? p.bio ?? `Music videos by ${p.name} on ClipWaltz.` : undefined,
  };
}

export default async function CreatorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPublicProfile(id);
  if (!p) notFound();

  const links = [
    { url: socialUrl("website", p.links.website), icon: Globe, label: "Website" },
    { url: socialUrl("instagram", p.links.instagram), icon: AtSign, label: "Instagram" },
    { url: socialUrl("tiktok", p.links.tiktok), icon: Music2, label: "TikTok" },
    { url: socialUrl("youtube", p.links.youtube), icon: Video, label: "YouTube" },
  ].filter((l) => l.url);

  return (
    <div className="cw-landing min-h-screen">
      <header className="px-4 pt-4">
        <nav className="cw-glass-light mx-auto flex max-w-5xl items-center justify-between rounded-2xl px-4 py-2.5">
          <Link href="/" aria-label="ClipWaltz home">
            <Image src="/logo-name-1.png" alt="ClipWaltz" width={1204} height={306} className="h-7 w-auto" />
          </Link>
          <Link href="/community" className="text-sm font-medium text-slate-700 transition-colors hover:text-slate-950">
            Community
          </Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 py-10">
        <div className="cw-glass flex flex-col items-center gap-3 rounded-3xl p-8 text-center">
          <span className="grid size-20 place-items-center overflow-hidden rounded-full bg-secondary text-2xl font-semibold">
            {p.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.image} alt="" className="size-full object-cover" />
            ) : (
              p.name.charAt(0).toUpperCase()
            )}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          {p.bio ? <p className="cw-muted max-w-lg whitespace-pre-wrap text-sm">{p.bio}</p> : null}
          {links.length > 0 ? (
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              {links.map((l) => (
                <a
                  key={l.label}
                  href={l.url!}
                  target="_blank"
                  rel="noreferrer nofollow"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/40"
                >
                  <l.icon className="size-3.5" /> {l.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>

        <h2 className="mt-10 mb-4 text-sm font-semibold uppercase tracking-widest text-[color:var(--cw-violet)]">
          Creations ({p.renders.length})
        </h2>
        {p.renders.length === 0 ? (
          <p className="cw-muted">No public creations yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {p.renders.map((r) => (
              <Link key={r.renderId} href={`/w/${r.renderId}`} className="cw-glass cw-lift group overflow-hidden rounded-2xl">
                <div
                  className={`relative flex items-center justify-center bg-gradient-to-br from-[color:var(--cw-blue)]/25 via-[color:var(--cw-magenta)]/20 to-[color:var(--cw-coral)]/20 ${
                    r.aspect === "16:9" ? "aspect-[16/9]" : "aspect-[9/16]"
                  }`}
                >
                  <div className="flex size-11 items-center justify-center rounded-full bg-white/85 transition-transform group-hover:scale-110">
                    <Play className="size-4 translate-x-0.5 fill-slate-900 text-slate-900" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 p-3">
                  <p className="min-w-0 truncate text-sm font-medium">{r.title}</p>
                  <span className="cw-subtle inline-flex shrink-0 items-center gap-1 text-xs">
                    <Heart className="size-3.5" /> {r.likes}
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
