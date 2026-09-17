import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Play,
  Upload,
  Wand2,
  Share2,
  Music,
  Clapperboard,
  Palette,
  Gauge,
  ShieldCheck,
  Check,
  Plane,
  Briefcase,
  Sparkles,
  Star,
} from "lucide-react";

export const metadata = {
  title: "ClipWaltz — your memories, set to music",
  description:
    "Drop in the photos and clips from your trip, event, or launch and ClipWaltz auto-edits them into a beat-synced, share-ready music video in under a minute. No editing required.",
};

export default function Home() {
  return (
    <main className="cw-landing relative min-h-screen w-full overflow-hidden">
      {/* aurora field */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="cw-aurora cw-anim-float"
          style={{ width: 520, height: 520, left: "-8%", top: "-6%", background: "var(--cw-blue)" }}
        />
        <div
          className="cw-aurora cw-anim-float-2"
          style={{ width: 480, height: 480, right: "-6%", top: "4%", background: "var(--cw-magenta)" }}
        />
        <div
          className="cw-aurora cw-anim-float"
          style={{ width: 460, height: 460, left: "30%", bottom: "-14%", background: "var(--cw-coral)" }}
        />
      </div>

      <div className="relative z-10">
        <Nav />
        <Hero />
        <TwoVibes />
        <HowItWorks />
        <Features />
        <Templates />
        <Pricing />
        <FinalCta />
        <Footer />
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------- Nav */
function Nav() {
  return (
    <header className="sticky top-0 z-50 px-4 pt-4">
      <nav className="cw-glass-light mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-2xl px-4 py-2.5 sm:px-5">
        <Link href="/" className="flex items-center" aria-label="ClipWaltz home">
          <Image
            src="/logo-name-1.png"
            alt="ClipWaltz"
            width={1204}
            height={306}
            priority
            className="h-7 w-auto sm:h-8"
          />
        </Link>
        <div className="hidden items-center gap-7 text-sm font-medium text-slate-700 md:flex">
          <a href="#how" className="transition-colors hover:text-slate-950">How it works</a>
          <a href="#features" className="transition-colors hover:text-slate-950">Features</a>
          <a href="#templates" className="transition-colors hover:text-slate-950">Templates</a>
          <a href="#pricing" className="transition-colors hover:text-slate-950">Pricing</a>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden rounded-full px-3.5 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-black/5 sm:inline-flex"
          >
            Log in
          </Link>
          <Link
            href="/sign-up"
            className="cw-gradient cw-sheen inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25"
          >
            Start free <ArrowRight className="size-4" />
          </Link>
        </div>
      </nav>
    </header>
  );
}

/* --------------------------------------------------------------- Hero */
function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-16 pb-20 lg:grid-cols-[1.05fr_0.95fr] lg:pt-24">
      <div>
        <span className="cw-glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-white/80">
          <Sparkles className="size-3.5 text-[color:var(--cw-coral)]" />
          Auto music-video maker · no editing required
        </span>
        <h1 className="mt-6 text-balance text-5xl font-semibold leading-[1.03] tracking-tight sm:text-6xl">
          Your memories,
          <br />
          <span className="cw-gradient-text">set to music.</span>
        </h1>
        <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-white/70">
          Drop in the photos and clips from your trip, your event, your launch. ClipWaltz
          auto-edits them in the cloud into a beat-synced, share-ready music video — in under a
          minute. No timeline. No editing. Just the good part.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/sign-up"
            className="cw-gradient cw-sheen inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-base font-semibold text-white shadow-xl shadow-fuchsia-500/30"
          >
            Start free <ArrowRight className="size-5" />
          </Link>
          <a
            href="#how"
            className="cw-glass inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-white/10"
          >
            <Play className="size-4 fill-current" /> See how it works
          </a>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/55">
          <span className="inline-flex items-center gap-1.5"><Check className="size-4 text-[color:var(--cw-blue)]" /> 9:16 for TikTok, Reels &amp; Shorts</span>
          <span className="inline-flex items-center gap-1.5"><Check className="size-4 text-[color:var(--cw-violet)]" /> Licensed music</span>
          <span className="inline-flex items-center gap-1.5"><Check className="size-4 text-[color:var(--cw-coral)]" /> HD render</span>
        </div>
      </div>

      <div className="flex items-center justify-center lg:justify-end">
        <PhoneMockup />
      </div>
    </section>
  );
}

function PhoneMockup() {
  return (
    <div className="relative w-[248px] shrink-0 sm:w-[268px]">
      <div
        aria-hidden
        className="cw-aurora"
        style={{ width: 340, height: 340, inset: "10% 10% auto auto", background: "var(--cw-violet)", opacity: 0.5 }}
      />
      <div className="cw-glass cw-metal cw-anim-drift relative rounded-[2.6rem] p-3">
        <div className="relative aspect-[9/19] w-[248px] overflow-hidden rounded-[2.1rem] bg-black sm:w-[268px]">
          {/* animated "clip" background */}
          <div className="cw-gradient absolute inset-0 opacity-90" />
          <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,transparent,rgba(0,0,0,0.55))]" />
          {/* top chip */}
          <div className="absolute inset-x-3 top-3 flex items-center justify-between text-[11px] font-medium text-white/90">
            <span className="cw-glass rounded-full px-2.5 py-1">Trip · Italy</span>
            <span className="cw-glass inline-flex items-center gap-1 rounded-full px-2.5 py-1">
              <Music className="size-3" /> Golden Hour
            </span>
          </div>
          {/* floating frames */}
          <div className="absolute left-4 top-1/3 h-16 w-24 rotate-[-6deg] rounded-xl border border-white/25 bg-white/10 backdrop-blur-sm" />
          <div className="absolute right-4 top-[42%] h-20 w-28 rotate-[7deg] rounded-xl border border-white/25 bg-white/10 backdrop-blur-sm" />
          {/* play */}
          <div className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow-2xl">
            <Play className="size-6 translate-x-0.5 fill-slate-900 text-slate-900" />
          </div>
          {/* equalizer + progress */}
          <div className="absolute inset-x-3 bottom-3 space-y-2">
            <EqBars />
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/25">
              <div className="cw-gradient h-full w-2/3 rounded-full" />
            </div>
          </div>
        </div>
      </div>
      {/* floating stat cards */}
      <div className="cw-glass cw-metal absolute -left-10 top-14 z-20 hidden whitespace-nowrap rounded-2xl px-3.5 py-2.5 sm:block">
        <p className="text-[11px] text-white/60">Render time</p>
        <p className="text-lg font-semibold text-white">~48s</p>
      </div>
      <div className="cw-glass cw-metal absolute -right-10 bottom-16 z-20 hidden whitespace-nowrap rounded-2xl px-3.5 py-2.5 sm:block">
        <p className="text-[11px] text-white/60">Beat-synced</p>
        <p className="inline-flex items-center gap-1 text-lg font-semibold text-white">
          <Wand2 className="size-4 text-[color:var(--cw-coral)]" /> Auto
        </p>
      </div>
    </div>
  );
}

function EqBars() {
  const bars = [0.2, 0.5, 0.1, 0.35, 0.7, 0.25, 0.55, 0.15, 0.45, 0.3, 0.6, 0.2, 0.4, 0.1, 0.5];
  return (
    <div className="flex h-8 items-end justify-between gap-[3px]">
      {bars.map((d, i) => (
        <span
          key={i}
          className="w-full origin-bottom rounded-full bg-white/85"
          style={{
            height: "100%",
            animation: `cw-eq ${0.9 + (i % 4) * 0.18}s ease-in-out ${i * 0.06}s infinite`,
            transform: `scaleY(${d})`,
          }}
        />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- Two vibes */
function TwoVibes() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-12">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">One tool, two vibes</h2>
        <p className="mt-3 text-white/60">
          The same one-minute magic, whether you&apos;re chasing sunsets or shipping a brand.
        </p>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <VibeCard
          icon={<Plane className="size-5" />}
          tint="var(--cw-coral)"
          kicker="For the fun"
          title="Turn the trip into a vibe"
          body="Beaches, road trips, birthdays, weddings. Hand ClipWaltz the camera roll and get back a highlight reel worth posting — before the tan fades."
          tags={["Vacations", "Weddings", "Birthdays", "Everyday"]}
        />
        <VibeCard
          icon={<Briefcase className="size-5" />}
          tint="var(--cw-blue)"
          kicker="For the brand"
          title="Make the brand move"
          body="Product drops, event recaps, testimonials, weekly updates. On-brand music videos your team can ship daily, without a video editor on payroll."
          tags={["Launches", "Events", "Recaps", "Social"]}
        />
      </div>
    </section>
  );
}

function VibeCard({
  icon,
  tint,
  kicker,
  title,
  body,
  tags,
}: {
  icon: React.ReactNode;
  tint: string;
  kicker: string;
  title: string;
  body: string;
  tags: string[];
}) {
  return (
    <div className="cw-glass cw-metal cw-lift overflow-hidden rounded-3xl p-7">
      <div
        className="mb-5 inline-flex size-11 items-center justify-center rounded-xl text-white"
        style={{ background: `color-mix(in oklab, ${tint}, transparent 15%)` }}
      >
        {icon}
      </div>
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: tint }}>
        {kicker}
      </p>
      <h3 className="mt-1.5 text-2xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-3 text-white/65">{body}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {tags.map((t) => (
          <span key={t} className="rounded-full border border-white/12 bg-white/5 px-3 py-1 text-xs text-white/70">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- How it works */
function HowItWorks() {
  const steps = [
    {
      icon: <Upload className="size-5" />,
      title: "Drop it in",
      body: "Upload the photos and clips from any device. Phone, laptop, or a shared drive — no cables, no timeline.",
    },
    {
      icon: <Wand2 className="size-5" />,
      title: "We waltz it",
      body: "The cloud auto-cuts to the beat, drops in licensed music, and sizes everything 9:16 for social.",
    },
    {
      icon: <Share2 className="size-5" />,
      title: "Post it",
      body: "Preview instantly, render in crisp HD, and download or share it everywhere. Done before your coffee.",
    },
  ];
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-[color:var(--cw-violet)]">
          How it works
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Three steps to a video that moves
        </h2>
      </div>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className="cw-glass cw-lift relative rounded-3xl p-7">
            <div className="cw-gradient-text text-6xl font-bold leading-none">{i + 1}</div>
            <div className="mt-4 inline-flex size-11 items-center justify-center rounded-xl bg-white/8 text-white">
              {s.icon}
            </div>
            <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
            <p className="mt-2 text-white/60">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- Features */
function Features() {
  const items = [
    { icon: <Clapperboard className="size-5" />, title: "Beat-synced cuts", body: "Clips land on the beat automatically, so every edit feels intentional." },
    { icon: <Music className="size-5" />, title: "Licensed music", body: "A curated catalog of royalty-free tracks — safe to post, mood by mood." },
    { icon: <Play className="size-5" />, title: "Instant draft preview", body: "See the whole cut in the editor before you commit to a full render." },
    { icon: <Gauge className="size-5" />, title: "Cloud HD render", body: "1080p 9:16 rendered on our machines, not your laptop. Leave and come back." },
    { icon: <Palette className="size-5" />, title: "Occasion templates", body: "Trip, event, birthday, or ‘surprise me’ — start from a vibe that fits." },
    { icon: <ShieldCheck className="size-5" />, title: "Watermark-free", body: "Upgrade to export clean, full-length videos with no watermark." },
  ];
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-[color:var(--cw-blue)]">
          Features
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Everything the edit used to take
        </h2>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div key={it.title} className="cw-glass cw-metal cw-lift rounded-2xl p-6">
            <div className="cw-ring mb-4 inline-flex size-11 items-center justify-center rounded-xl text-white">
              {it.icon}
            </div>
            <h3 className="text-lg font-semibold">{it.title}</h3>
            <p className="mt-1.5 text-sm text-white/60">{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- Templates */
function Templates() {
  const cards = [
    { name: "Trip", vibe: "Golden, sun-soaked, wanderlust", grad: "linear-gradient(140deg,#ff9966,#ff5e7e,#8b5cf6)" },
    { name: "Wedding & Events", vibe: "Cinematic, warm, unforgettable", grad: "linear-gradient(140deg,#8b5cf6,#e05bd6,#ff7a59)" },
    { name: "Birthday", vibe: "Bright, playful, confetti energy", grad: "linear-gradient(140deg,#4f7cff,#8b5cf6,#e05bd6)" },
    { name: "Surprise me", vibe: "Let ClipWaltz pick the mood", grad: "linear-gradient(140deg,#4f7cff,#22d3ee,#8b5cf6)" },
  ];
  return (
    <section id="templates" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div className="max-w-xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-[color:var(--cw-coral)]">
            Templates
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Start from a vibe
          </h2>
          <p className="mt-3 text-white/60">
            Pick the occasion and ClipWaltz tunes the pacing, music, and mood to match.
          </p>
        </div>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.name} className="cw-glass cw-lift cw-sheen overflow-hidden rounded-2xl p-2">
            <div className="relative aspect-[3/4] overflow-hidden rounded-xl" style={{ background: c.grad }}>
              <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,transparent,rgba(0,0,0,0.5))]" />
              <div className="absolute left-1/2 top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/85">
                <Play className="size-4 translate-x-0.5 fill-slate-900 text-slate-900" />
              </div>
            </div>
            <div className="px-3 pb-2 pt-3">
              <h3 className="font-semibold">{c.name}</h3>
              <p className="text-xs text-white/55">{c.vibe}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Pricing */
function Pricing() {
  const tiers = [
    {
      name: "Free",
      tagline: "Make your first video",
      features: ["Cloud auto-assemble", "Licensed music catalog", "Draft preview", "Watermarked export"],
      cta: "Start free",
      featured: false,
    },
    {
      name: "Plus",
      tagline: "For creators who post",
      features: ["Everything in Free", "No watermark", "HD 1080p render", "Longer videos", "Priority in the queue"],
      cta: "Choose Plus",
      featured: true,
    },
    {
      name: "Pro",
      tagline: "For brands & teams",
      features: ["Everything in Plus", "Fastest render", "Project vault storage", "More monthly renders"],
      cta: "Go Pro",
      featured: false,
    },
  ];
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-[color:var(--cw-violet)]">
          Pricing
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Start free. Upgrade when it clicks.
        </h2>
        <p className="mt-3 text-white/60">Founding-member pricing at launch. Cancel anytime.</p>
      </div>
      <div className="mt-12 grid items-stretch gap-5 md:grid-cols-3">
        {tiers.map((t) => (
          <div
            key={t.name}
            className={`cw-lift relative flex flex-col rounded-3xl p-7 ${
              t.featured ? "cw-ring cw-metal bg-[color:var(--cw-ink-2)]" : "cw-glass"
            }`}
          >
            {t.featured && (
              <span className="cw-gradient absolute -top-3 left-7 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-white shadow-lg">
                <Star className="size-3 fill-current" /> Most popular
              </span>
            )}
            <h3 className="text-xl font-semibold">{t.name}</h3>
            <p className="mt-1 text-sm text-white/55">{t.tagline}</p>
            <ul className="mt-6 space-y-2.5 text-sm text-white/75">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-[color:var(--cw-coral)]" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/sign-up"
              className={`cw-sheen mt-7 inline-flex items-center justify-center gap-1.5 rounded-full px-5 py-3 text-sm font-semibold transition-colors ${
                t.featured
                  ? "cw-gradient text-white shadow-lg shadow-fuchsia-500/25"
                  : "border border-white/15 bg-white/5 text-white hover:bg-white/10"
              }`}
            >
              {t.cta} <ArrowRight className="size-4" />
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- Final CTA */
function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="cw-ring cw-metal relative overflow-hidden rounded-[2.5rem] px-8 py-16 text-center">
        <div className="cw-gradient absolute inset-0 opacity-20" aria-hidden />
        <div
          aria-hidden
          className="cw-aurora cw-anim-float"
          style={{ width: 360, height: 360, left: "8%", top: "-30%", background: "var(--cw-blue)" }}
        />
        <div className="relative">
          <h2 className="mx-auto max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Make your first <span className="cw-gradient-text">ClipWaltz</span> today
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/70">
            The trip already happened. The launch is live. Turn what you captured into something
            worth watching — in the next minute.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/sign-up"
              className="cw-gradient cw-sheen inline-flex items-center gap-2 rounded-full px-7 py-4 text-base font-semibold text-white shadow-xl shadow-fuchsia-500/30"
            >
              Start free <ArrowRight className="size-5" />
            </Link>
            <Link
              href="/sign-in"
              className="cw-glass inline-flex items-center gap-2 rounded-full px-7 py-4 text-base font-semibold text-white transition-colors hover:bg-white/10"
            >
              Log in
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- Footer */
function Footer() {
  return (
    <footer className="border-t border-white/10 px-5 py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="cw-glass-light inline-flex items-center rounded-xl px-3 py-2">
          <Image src="/logo-name-1.png" alt="ClipWaltz" width={1204} height={306} className="h-6 w-auto" />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/55">
          <a href="#how" className="hover:text-white">How it works</a>
          <a href="#features" className="hover:text-white">Features</a>
          <a href="#pricing" className="hover:text-white">Pricing</a>
          <Link href="/sign-in" className="hover:text-white">Log in</Link>
          <Link href="/sign-up" className="hover:text-white">Start free</Link>
        </div>
      </div>
      <p className="mx-auto mt-8 max-w-6xl text-center text-xs text-white/35 sm:text-left">
        © {new Date().getFullYear()} ClipWaltz · www.clipwaltz.com — your memories, set to music.
      </p>
    </footer>
  );
}
