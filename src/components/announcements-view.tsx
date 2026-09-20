"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Megaphone, ArrowRight } from "lucide-react";
import type { Announcement } from "@/lib/announcements";

// Brand accent → gradient. Tokens defined in globals (--cw-violet/blue/magenta/coral).
const ACCENT: Record<string, string> = {
  violet: "from-[color:var(--cw-violet)]/25 to-[color:var(--cw-blue)]/10 border-[color:var(--cw-violet)]/30",
  blue: "from-[color:var(--cw-blue)]/25 to-[color:var(--cw-violet)]/10 border-[color:var(--cw-blue)]/30",
  magenta: "from-[color:var(--cw-magenta)]/25 to-[color:var(--cw-coral)]/10 border-[color:var(--cw-magenta)]/30",
  coral: "from-[color:var(--cw-coral)]/25 to-[color:var(--cw-magenta)]/10 border-[color:var(--cw-coral)]/30",
};

const KEY = "cw-dismissed-announcements";

function useDismissed() {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setIds(JSON.parse(raw));
    } catch {
      /* private mode / blocked storage — show everything */
    }
  }, []);
  const dismiss = (id: string) => {
    setIds((prev) => {
      const next = [...new Set([...prev, id])];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  return { ids, dismiss };
}

function Cta({ a }: { a: Announcement }) {
  if (!a.ctaUrl) return null;
  const label = a.ctaLabel || "Learn more";
  const external = /^https?:\/\//.test(a.ctaUrl);
  const cls =
    "inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-opacity hover:opacity-90";
  return external ? (
    <a href={a.ctaUrl} target="_blank" rel="noopener noreferrer" className={cls}>
      {label} <ArrowRight className="size-3.5" />
    </a>
  ) : (
    <Link href={a.ctaUrl} className={cls}>
      {label} <ArrowRight className="size-3.5" />
    </Link>
  );
}

export function AnnouncementsView({
  banner,
  cards,
}: {
  banner: Announcement | null;
  cards: Announcement[];
}) {
  const { ids, dismiss } = useDismissed();
  const liveBanner = banner && !ids.includes(banner.id) ? banner : null;
  const liveCards = cards.filter((c) => !ids.includes(c.id));
  if (!liveBanner && liveCards.length === 0) return null;

  return (
    <div className="space-y-3">
      {liveBanner ? (
        <div
          className={`relative overflow-hidden rounded-2xl border bg-gradient-to-r p-5 ${ACCENT[liveBanner.accent] ?? ACCENT.violet}`}
        >
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(liveBanner.id)}
            className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground hover:bg-black/10 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Megaphone className="size-3.5" /> Announcement
          </div>
          <h3 className="mt-1 text-lg font-semibold tracking-tight">{liveBanner.title}</h3>
          {liveBanner.body ? (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{liveBanner.body}</p>
          ) : null}
          <div className="mt-3">
            <Cta a={liveBanner} />
          </div>
        </div>
      ) : null}

      {liveCards.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {liveCards.map((c) => (
            <div
              key={c.id}
              className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 ${ACCENT[c.accent] ?? ACCENT.violet}`}
            >
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(c.id)}
                className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground hover:bg-black/10 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.imageUrl} alt="" className="mb-3 h-24 w-full rounded-lg object-cover" />
              ) : null}
              <h3 className="pr-5 text-sm font-semibold tracking-tight">{c.title}</h3>
              {c.body ? <p className="mt-1 text-xs text-muted-foreground">{c.body}</p> : null}
              {c.ctaUrl ? (
                <div className="mt-3">
                  <Cta a={c} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
