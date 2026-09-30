import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ExternalLink, ShieldAlert } from "lucide-react";
import { getPublicVariant } from "@/lib/campaign-public";

// "You're leaving ClipWaltz" — the stop between a Free-plan pack's CTA button and its destination (see /c/[id]/go).
// Shows exactly where the link goes; the visitor decides. The click was already counted on /go.
export const metadata = { title: "You're leaving ClipWaltz", robots: { index: false, follow: false } };

export default async function LeavingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await getPublicVariant(id);
  if (!v?.ctaHref) notFound();
  const dest = new URL(v.ctaHref);
  const shown = `${dest.origin}${dest.pathname === "/" ? "" : dest.pathname}`;
  return (
    <div className="cw-landing flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <main className="cw-glass w-full max-w-md space-y-5 rounded-3xl p-7 text-center">
        <ShieldAlert className="mx-auto size-10 text-amber-500" aria-hidden />
        <h1 className="text-xl font-semibold tracking-tight">You&apos;re leaving ClipWaltz</h1>
        <p className="text-sm text-slate-600">
          This button goes to a website that ClipWaltz doesn&apos;t run or check. Only continue if you trust it.
        </p>
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-left text-sm break-all text-slate-800">
          <span className="block text-base font-semibold">{dest.hostname}</span>
          <span className="text-xs text-slate-500">{shown}</span>
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <a href={v.ctaHref} rel="nofollow noopener" className="cw-gradient inline-flex items-center justify-center gap-1.5 rounded-full px-6 py-2.5 text-sm font-semibold text-white">
            Continue to {dest.hostname} <ExternalLink className="size-4" aria-hidden />
          </a>
          <Link href={`/c/${id}`} className="inline-flex items-center justify-center rounded-full border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Go back
          </Link>
        </div>
        <p className="text-xs text-slate-500">
          Something wrong with this link? Tell us at{" "}
          <a className="underline" href={`mailto:support@clipwaltz.com?subject=${encodeURIComponent(`Report link /c/${id}`)}`}>support@clipwaltz.com</a>.
        </p>
      </main>
      <Link href="/" aria-label="ClipWaltz home" className="mt-8"><Image src="/logo-name-1.png" alt="ClipWaltz" width={1204} height={306} className="h-5 w-auto" /></Link>
    </div>
  );
}
