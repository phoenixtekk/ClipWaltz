import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getPublicVariant } from "@/lib/campaign-public";
import { aspectClass, isWide } from "@/lib/aspect";
import { VariantPlayer } from "@/components/deck/variant-player";

// WaltzDeck campaign variant landing page (phase 4): the ad + its call to action. Reachable only while the pack's
// share links are on; views, plays, completions and CTA clicks are counted per variant (variant_events).
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await getPublicVariant(id);
  return { title: v ? v.title : "ClipWaltz", robots: { index: false, follow: false } };
}

export default async function VariantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await getPublicVariant(id);
  if (!v) notFound();
  const wide = isWide(v.aspect);
  return (
    <div className="cw-landing flex min-h-screen flex-col items-center px-5 py-8">
      <main className="flex w-full max-w-3xl flex-1 flex-col items-center gap-6">
        <div className={`cw-glass relative w-full overflow-hidden rounded-3xl bg-black ${wide ? "max-w-3xl" : "max-w-sm"}`}>
          <VariantPlayer renderId={v.renderId} className={`w-full ${aspectClass(v.aspect)} object-contain`} />
        </div>
        <h1 className="text-center text-2xl font-semibold tracking-tight">{v.title}</h1>
        {v.ctaText && v.ctaHref ? (
          <a
            href={`/c/${v.renderId}/go`}
            data-cta
            rel="nofollow"
            className="cw-gradient cw-sheen inline-flex items-center rounded-full px-7 py-3 text-base font-semibold text-white"
          >
            {v.ctaText}
          </a>
        ) : v.ctaText ? (
          <p className="text-lg font-semibold">{v.ctaText}</p>
        ) : null}
      </main>
      {v.watermark ? (
        <footer className="mt-10 flex items-center gap-2 text-xs text-slate-500">
          Made with
          <Link href="/" aria-label="ClipWaltz home"><Image src="/logo-name-1.png" alt="ClipWaltz" width={1204} height={306} className="h-5 w-auto" /></Link>
        </footer>
      ) : null}
    </div>
  );
}
