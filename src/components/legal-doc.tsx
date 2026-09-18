import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";

/** Shared chrome for the public legal pages (Terms / Privacy / Refund). */
export function LegalDoc({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="cw-landing min-h-screen">
      <header className="px-4 pt-4">
        <nav className="cw-glass-light mx-auto flex max-w-3xl items-center justify-between rounded-2xl px-4 py-2.5">
          <Link href="/" className="flex items-center" aria-label="ClipWaltz home">
            <Image src="/logo-name-1.png" alt="ClipWaltz" width={1204} height={306} className="h-7 w-auto" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 transition-colors hover:text-slate-950"
          >
            <ArrowLeft className="size-4" /> Home
          </Link>
        </nav>
      </header>

      <article className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="cw-subtle mt-2 text-sm">Last updated {updated}</p>
        <div className="cw-glass mb-6 mt-6 rounded-xl p-4 text-sm">
          <span className="cw-muted">
            This is a plain-language starting template, not legal advice. Have counsel review and
            adapt it before relying on it in production.
          </span>
        </div>
        <div className="cw-legal space-y-2">{children}</div>
      </article>

      <footer className="cw-hair border-t px-5 py-8">
        <div className="cw-subtle mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          <Link href="/terms" className="hover:text-[color:var(--cw-fg)]">Terms</Link>
          <Link href="/privacy" className="hover:text-[color:var(--cw-fg)]">Privacy</Link>
          <Link href="/refund" className="hover:text-[color:var(--cw-fg)]">Refunds</Link>
          <span>© {new Date().getFullYear()} ClipWaltz · www.clipwaltz.com</span>
        </div>
      </footer>
    </div>
  );
}
