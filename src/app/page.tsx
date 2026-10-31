import Link from "next/link";
import { connection } from "next/server";
import { watermarkPaidPlans } from "@/lib/watermark";
import { getHomeData, type HomeData } from "@/lib/home-data";
import type { FeedItem } from "@/lib/feed";
import Image from "next/image";
import {
  ArrowRight,
  Play,
  Upload,
  Wand2,
  Share2,
  Check,
  Star,
  Sparkles,
  Heart,
  Trophy,
  ScrollText,
  MessageSquareText,
  FileDown,
  FlaskConical,
  Mic,
  Languages,
  Palette,
  Aperture,
  CloudUpload,
  Cpu,
  PenLine,
  Film,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { VideoPreview } from "@/components/video-preview";
import { ToolTabs } from "@/components/home/tool-tabs";

export const metadata = {
  title: "ClipWaltz — music videos, AI clips, presenters and ads in one studio",
  description:
    "Turn your photos and clips into beat-synced music videos, make AI clips from a sentence, have a presenter read your script, and plan ads, slideshows and presentations scene by scene — all in ClipWaltz.",
};

// "No watermark" is only promised while the admin has paid plans exempt (/admin → Watermark).
async function paidPlansWatermarked(): Promise<boolean> {
  await connection();
  try { return await watermarkPaidPlans(); } catch { return true; }
}

export default async function Home() {
  const [paidWatermarked, data] = await Promise.all([paidPlansWatermarked(), getHomeData()]);
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
          style={{ width: 460, height: 460, left: "30%", top: "38%", background: "var(--cw-coral)" }}
        />
      </div>

      <div className="relative z-10">
        <Nav showcase={data.feed.length > 0} />
        <Hero feed={data.feed} />
        <UseCases />
        <Tools videoVendors={data.videoVendors} />
        <Showcase feed={data.feed} />
        <ToolTiles />
        <YourAi data={data} />
        <Community contest={data.contest} />
        <HowItWorks />
        <Pricing paidWatermarked={paidWatermarked} />
        <FinalCta />
        <Footer showcase={data.feed.length > 0} />
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------- Nav */
function Nav({ showcase }: { showcase: boolean }) {
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
          <a href="#tools" className="transition-colors hover:text-slate-950">Tools</a>
          {showcase ? <a href="#showcase" className="transition-colors hover:text-slate-950">Showcase</a> : null}
          <a href="#pricing" className="transition-colors hover:text-slate-950">Pricing</a>
          <Link href="/community" className="transition-colors hover:text-slate-950">Community</Link>
          <Link href="/help" className="transition-colors hover:text-slate-950">Help</Link>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle className="inline-flex size-9 items-center justify-center rounded-full text-slate-700 transition-colors hover:bg-black/5" />
          <Link
            href="/sign-in"
            className="hidden rounded-full px-3.5 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-black/5 sm:inline-flex"
          >
            Log in
          </Link>
          <Link
            href="/projects"
            className="cw-gradient cw-sheen inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25"
          >
            Let&apos;s Waltz <ArrowRight className="size-4" />
          </Link>
        </div>
      </nav>
    </header>
  );
}

/* --------------------------------------------------------------- Hero */
// Where the floating tiles sit around the headline on wide screens (left/right edges, staggered heights).
const HERO_TILES = [
  "left-[1%] top-[4%] w-28 rotate-[-6deg]",
  "left-[8%] top-[44%] w-24 rotate-[4deg]",
  "left-[0%] bottom-[-2%] w-20 rotate-[-3deg]",
  "right-[2%] top-[2%] w-24 rotate-[6deg]",
  "right-[7%] top-[40%] w-28 rotate-[-5deg]",
  "right-[0%] bottom-[-4%] w-20 rotate-[3deg]",
];
const HERO_GRADS = [
  "linear-gradient(140deg,#ff9966,#ff5e7e,#8b5cf6)",
  "linear-gradient(140deg,#8b5cf6,#e05bd6,#ff7a59)",
  "linear-gradient(140deg,#4f7cff,#8b5cf6,#e05bd6)",
  "linear-gradient(140deg,#4f7cff,#22d3ee,#8b5cf6)",
  "linear-gradient(140deg,#ff7a59,#e05bd6,#4f7cff)",
  "linear-gradient(140deg,#22d3ee,#4f7cff,#8b5cf6)",
];

function Hero({ feed }: { feed: FeedItem[] }) {
  return (
    <section className="relative mx-auto max-w-6xl px-5 pt-14 pb-16 lg:pt-20 lg:pb-24">
      {/* real community videos floating around the headline (gradients until there are some) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden xl:block">
        {HERO_TILES.map((pos, i) => (
          <div key={pos} className={`cw-glass cw-anim-drift absolute rounded-2xl p-1.5 ${pos}`} style={{ animationDelay: `${i * 0.7}s` }}>
            <div className="relative aspect-[9/16] overflow-hidden rounded-xl" style={{ background: HERO_GRADS[i] }}>
              {feed[i] ? <VideoPreview renderId={feed[i].renderId} /> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="relative mx-auto max-w-3xl text-center">
        <span className="cw-glass cw-muted inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium">
          <Sparkles className="size-3.5 text-[color:var(--cw-coral)]" />
          AutoWaltz · Waltz AI · Waltz Avatar · WaltzDeck
        </span>
        <h1 className="mt-6 text-balance text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
          Every video you need,
          <br />
          <span className="cw-gradient-text">shown to the beat</span>
        </h1>
        <p className="cw-muted mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed">
          Turn your camera roll into a music video, make new clips with AI, have a presenter read your script, and
          plan ads, slideshows and presentations scene by scene. One studio, in the cloud — no timeline required.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/projects"
            className="cw-gradient cw-sheen inline-flex items-center gap-2 rounded-full px-7 py-4 text-base font-semibold text-white shadow-xl shadow-fuchsia-500/30"
          >
            Start creating — it&apos;s free <ArrowRight className="size-5" />
          </Link>
          <a
            href={feed.length ? "#showcase" : "#tools"}
            className="cw-glass cw-fg inline-flex items-center gap-2 rounded-full px-6 py-4 text-base font-semibold transition-colors"
          >
            <Play className="size-4 fill-current" /> {feed.length ? "See what people made" : "Explore the tools"}
          </a>
        </div>
        <div className="cw-subtle mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-1.5"><Check className="size-4 text-[color:var(--cw-blue)]" /> 9:16, 16:9, 1:1 &amp; 4:5</span>
          <span className="inline-flex items-center gap-1.5"><Check className="size-4 text-[color:var(--cw-violet)]" /> Licensed music</span>
          <span className="inline-flex items-center gap-1.5"><Check className="size-4 text-[color:var(--cw-coral)]" /> Rendered in the cloud</span>
        </div>
      </div>

      {/* phones/tablets: the same videos as a row under the headline */}
      {feed.length > 0 ? (
        <div aria-hidden className="mt-10 flex justify-center gap-3 xl:hidden">
          {feed.slice(0, 3).map((f, i) => (
            <div key={f.renderId} className={`cw-glass rounded-2xl p-1.5 ${i === 2 ? "hidden sm:block" : ""}`}>
              <div className="relative aspect-[9/16] w-28 overflow-hidden rounded-xl" style={{ background: HERO_GRADS[i] }}>
                <VideoPreview renderId={f.renderId} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------- Use cases */
function UseCases() {
  const items = [
    { label: "Music video", tool: "AutoWaltz" },
    { label: "Trip highlight reel", tool: "AutoWaltz" },
    { label: "AI clip from a sentence", tool: "Waltz AI" },
    { label: "Photo brought to life", tool: "Waltz AI" },
    { label: "Talking presenter", tool: "Waltz Avatar" },
    { label: "Translated video", tool: "Waltz Avatar" },
    { label: "Product ad", tool: "WaltzDeck" },
    { label: "Slideshow", tool: "WaltzDeck" },
    { label: "Presentation", tool: "WaltzDeck" },
    { label: "Explainer", tool: "WaltzDeck" },
  ];
  return (
    <section aria-labelledby="usecases-h" className="mx-auto max-w-6xl px-5 pb-8">
      <h2 id="usecases-h" className="cw-subtle text-center text-xs font-semibold uppercase tracking-widest">
        Make a…
      </h2>
      <ul className="mt-4 flex flex-wrap justify-center gap-2">
        {items.map((it) => (
          <li key={it.label}>
            <Link
              href="/projects"
              className="cw-glass cw-fg inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-transform hover:-translate-y-0.5"
            >
              {it.label}
              <span className="cw-subtle text-xs">· {it.tool}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------- Tools */
function Tools({ videoVendors }: { videoVendors: string[] }) {
  return (
    <section id="tools" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-[color:var(--cw-violet)]">Four tools, one studio</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Pick how you want to make it</h2>
        <p className="cw-muted mt-3">
          Start from your own media, from a sentence, from a presenter or from a brief. Everything lands in the same
          projects, editor and cloud render.
        </p>
      </div>
      <ToolTabs videoVendors={videoVendors} />
    </section>
  );
}

/* ----------------------------------------------------------- Showcase */
function Showcase({ feed }: { feed: FeedItem[] }) {
  if (feed.length === 0) return null;
  return (
    <section id="showcase" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div className="max-w-xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-[color:var(--cw-coral)]">Showcase</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Made with ClipWaltz</h2>
          <p className="cw-muted mt-3">The latest videos creators chose to share. Hover to play.</p>
        </div>
        <Link
          href="/community"
          className="cw-glass cw-fg inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold"
        >
          See the community <ArrowRight className="size-4" />
        </Link>
      </div>
      <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {feed.slice(0, 8).map((f, i) => (
          <Link
            key={f.renderId}
            href={`/w/${f.renderId}`}
            className={`cw-glass cw-lift group overflow-hidden rounded-2xl p-1.5 ${i >= 6 ? "hidden lg:block" : ""}`}
          >
            <div className="relative aspect-[3/4] overflow-hidden rounded-xl" style={{ background: HERO_GRADS[i % HERO_GRADS.length] }}>
              <VideoPreview renderId={f.renderId} />
              <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white">
                <Heart className="size-3" /> {f.likes}
              </span>
            </div>
            <div className="px-2 pb-1.5 pt-2.5">
              <p className="truncate text-sm font-semibold">{f.title}</p>
              <p className="cw-subtle truncate text-xs">by {f.creator}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------------- Tool tiles */
function ToolTiles() {
  const tiles = [
    { icon: <ScrollText className="size-5" />, title: "Script briefs, followed exactly", body: "Paste a scene-by-scene script — timing, on-screen text, voiceover — and WaltzDeck uses your words as written." },
    { icon: <MessageSquareText className="size-5" />, title: "Edit with AI chat", body: "Ask for changes to a scene in plain words and see what changed." },
    { icon: <FileDown className="size-5" />, title: "PDF & PowerPoint", body: "Export a deck as PDF or PowerPoint, or start one from a PPTX, a PDF or a web page." },
    { icon: <FlaskConical className="size-5" />, title: "Campaign packs", body: "Test hooks × calls to action × lengths × shapes, with stats per variant." },
    { icon: <Mic className="size-5" />, title: "Your own voice", body: "After a recorded voice consent, your presenter narrates in your voice." },
    { icon: <Languages className="size-5" />, title: "Translate a video", body: "A video of yourself, translated and spoken in your voice with the lips re-synced." },
    { icon: <Palette className="size-5" />, title: "Brand kit from your website", body: "Pull your colours, fonts and logo from your site so every deck looks like you." },
    { icon: <Aperture className="size-5" />, title: "360 camera ready", body: "Insta360 .insv and 360 footage reframed into a normal, shareable video." },
    { icon: <CloudUpload className="size-5" />, title: "Saves to your cloud", body: "Finished videos can save automatically to Google Drive or Dropbox." },
  ];
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-[color:var(--cw-blue)]">Built in</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">The details that save you an afternoon</h2>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((it) => (
          <div key={it.title} className="cw-glass cw-metal cw-lift rounded-2xl p-6">
            <div className="cw-ring cw-fg mb-4 inline-flex size-11 items-center justify-center rounded-xl">{it.icon}</div>
            <h3 className="text-lg font-semibold">{it.title}</h3>
            <p className="cw-muted mt-1.5 text-sm">{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Your AI */
// Shown only once the admin offers something beyond the built-in model (/admin/ai), so it never promises a choice
// that isn't there.
function YourAi({ data }: { data: HomeData }) {
  if (!data.writers.length && !data.videoVendors.length && !data.connector) return null;
  const writers = ["ClipWaltz AI (built in)", ...data.writers];
  const video = ["ClipWaltz AI (built in)", ...data.videoVendors];
  const rows: { icon: React.ReactNode; title: string; body: string; chips: string[] }[] = [
    {
      icon: <PenLine className="size-5" />,
      title: "Who writes your WaltzDeck",
      body: data.writers.length
        ? "Plans, narration and rewrites come from the model you choose under AI models."
        : "Plans, narration and rewrites come from ClipWaltz's own model.",
      chips: writers,
    },
    {
      icon: <Film className="size-5" />,
      title: "Who makes your Waltz AI clips",
      body: data.videoVendors.length
        ? "Pick a video model per clip; each one shows its credit cost first."
        : "Clips are made by ClipWaltz's own model.",
      chips: video,
    },
  ];
  if (data.connector) {
    rows.push({
      icon: <Cpu className="size-5" />,
      title: "Or your own computer",
      body: "The ClipWaltz Connector lets the AI run on your own machine — it connects out to ClipWaltz, nothing to open on your router.",
      chips: ["ClipWaltz Connector"],
    });
  }
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-[color:var(--cw-violet)]">Your AI, your choice</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Use ours, or bring your own</h2>
      </div>
      <div className={`mt-12 grid gap-4 ${rows.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
        {rows.map((r) => (
          <div key={r.title} className="cw-glass rounded-3xl p-6">
            <div className="cw-fill cw-fg inline-flex size-11 items-center justify-center rounded-xl">{r.icon}</div>
            <h3 className="mt-4 text-lg font-semibold">{r.title}</h3>
            <p className="cw-muted mt-1.5 text-sm">{r.body}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {r.chips.map((c) => (
                <span key={c} className="cw-fill cw-hair cw-fg rounded-full border px-3 py-1 text-xs font-medium">{c}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- Community */
function Community({ contest }: { contest: HomeData["contest"] }) {
  return (
    <section className="mx-auto max-w-6xl px-5 py-12">
      <div className="cw-glass cw-metal grid items-center gap-6 rounded-[2rem] p-7 sm:p-10 md:grid-cols-[1fr_auto]">
        <div>
          {contest ? (
            <>
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-[color:var(--cw-violet)]">
                <Trophy className="size-3.5" /> Monthly Theme Challenge
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">This month: {contest.theme}</h2>
              <p className="cw-muted mt-2 max-w-xl">
                {contest.description ? `${contest.description} ` : ""}Share a video to the community — likes are votes,
                and the winner gets ClipWaltz Pro.
              </p>
            </>
          ) : (
            <>
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-[color:var(--cw-violet)]">
                <Heart className="size-3.5" /> Community
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Share it, like it, chat about it</h2>
              <p className="cw-muted mt-2 max-w-xl">
                Post your videos to the community feed, like other creators&apos; work and see the most-liked videos
                and top posters.
              </p>
            </>
          )}
        </div>
        <Link
          href="/community"
          className="cw-gradient cw-sheen inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25"
        >
          Visit the community <ArrowRight className="size-4" />
        </Link>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- How it works */
function HowItWorks() {
  const steps = [
    {
      icon: <Upload className="size-5" />,
      title: "Bring something",
      body: "Your photos and clips, a sentence for Waltz AI, a script for your presenter, or a brief for WaltzDeck.",
    },
    {
      icon: <Wand2 className="size-5" />,
      title: "ClipWaltz builds it",
      body: "Beat-synced cuts, AI clips, a talking presenter or a scene-by-scene plan — ready to tweak in the editor.",
    },
    {
      icon: <Share2 className="size-5" />,
      title: "Render & share",
      body: "Render in the cloud, then download, save to your cloud or share it to the community.",
    },
  ];
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-[color:var(--cw-violet)]">How it works</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Three steps, whichever tool you pick</h2>
      </div>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className="cw-glass cw-lift relative rounded-3xl p-7">
            <div className="cw-gradient-text text-6xl font-bold leading-none">{i + 1}</div>
            <div className="cw-fill cw-fg mt-4 inline-flex size-11 items-center justify-center rounded-xl">{s.icon}</div>
            <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
            <p className="cw-muted mt-2">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Pricing */
function Pricing({ paidWatermarked }: { paidWatermarked: boolean }) {
  const tiers = [
    {
      name: "Free",
      price: "$0",
      period: "forever",
      tagline: "Make your first video",
      features: ["Cloud auto-assemble", "Licensed music catalog", "Draft preview", "3 videos / mo", "Watermarked export"],
      cta: "Let's Waltz",
      href: "/projects",
      featured: false,
    },
    {
      name: "Plus",
      price: "$15",
      period: "/mo",
      tagline: "For creators who post",
      features: ["Everything in Free", ...(paidWatermarked ? [] : ["No watermark"]), "HD 1080p render", "30 videos / mo", "Up to 60s", "Priority in the queue"],
      cta: "Choose Plus",
      href: "/sign-up",
      featured: true,
    },
    {
      name: "Pro",
      price: "$39",
      period: "/mo",
      tagline: "For brands & teams",
      features: ["Everything in Plus", "Fastest render", "100 videos / mo", "Up to 3 min", "Project Vault storage"],
      cta: "Go Pro",
      href: "/sign-up",
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
        <p className="cw-muted mt-3">Founding-member pricing at launch. Cancel anytime.</p>
      </div>
      <div className="mt-12 grid items-stretch gap-5 md:grid-cols-3">
        {tiers.map((t) => (
          <div
            key={t.name}
            className={`cw-lift relative flex flex-col rounded-3xl p-7 ${
              t.featured ? "cw-ring cw-metal bg-[color:var(--cw-ring-fill)]" : "cw-glass"
            }`}
          >
            {t.featured && (
              <span className="cw-gradient absolute -top-3 left-7 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-white shadow-lg">
                <Star className="size-3 fill-current" /> Most popular
              </span>
            )}
            <h3 className="text-xl font-semibold">{t.name}</h3>
            <p className="cw-subtle mt-1 text-sm">{t.tagline}</p>
            <p className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight">{t.price}</span>
              <span className="cw-subtle text-sm">{t.period}</span>
            </p>
            <ul className="cw-muted mt-6 space-y-2.5 text-sm">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-[color:var(--cw-coral)]" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href={t.href}
              className={`cw-sheen mt-7 inline-flex items-center justify-center gap-1.5 rounded-full px-5 py-3 text-sm font-semibold transition-colors ${
                t.featured
                  ? "cw-gradient text-white shadow-lg shadow-fuchsia-500/25"
                  : "cw-fill cw-hair cw-fg border"
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
          <p className="cw-muted mx-auto mt-4 max-w-xl">
            A music video from the trip, an ad for the launch, a presenter for the update. Start free and see it
            take shape.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/projects"
              className="cw-gradient cw-sheen inline-flex items-center gap-2 rounded-full px-7 py-4 text-base font-semibold text-white shadow-xl shadow-fuchsia-500/30"
            >
              Let&apos;s Waltz <ArrowRight className="size-5" />
            </Link>
            <Link
              href="/sign-in"
              className="cw-glass cw-fg inline-flex items-center gap-2 rounded-full px-7 py-4 text-base font-semibold transition-colors"
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
function Footer({ showcase }: { showcase: boolean }) {
  const cols: { title: string; links: [string, string][] }[] = [
    { title: "Tools", links: [["AutoWaltz", "#tools"], ["Waltz AI", "#tools"], ["Waltz Avatar", "#tools"], ["WaltzDeck", "#tools"]] },
    { title: "Explore", links: [...(showcase ? [["Showcase", "#showcase"] as [string, string]] : []), ["Community", "/community"], ["How it works", "#how"], ["Pricing", "#pricing"]] },
    { title: "Support", links: [["Help Center", "/help"], ["Log in", "/sign-in"], ["Sign up", "/sign-up"]] },
    { title: "Legal", links: [["Terms", "/terms"], ["Privacy", "/privacy"], ["Refunds", "/refund"]] },
  ];
  return (
    <footer className="cw-hair border-t px-5 py-12">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.2fr_repeat(4,1fr)]">
        <div>
          <div className="cw-glass-light inline-flex items-center rounded-xl px-3 py-2">
            <Image src="/logo-name-1.png" alt="ClipWaltz" width={1204} height={306} className="h-6 w-auto" />
          </div>
          <p className="cw-subtle mt-4 max-w-xs text-sm">
            Music videos, AI clips, presenters and decks — one studio, in the cloud.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <p className="cw-fg text-sm font-semibold">{c.title}</p>
            <ul className="cw-subtle mt-3 space-y-2 text-sm">
              {c.links.map(([label, href]) => (
                <li key={label}>
                  {href.startsWith("#") ? (
                    <a href={href} className="transition-colors hover:text-[color:var(--cw-fg)]">{label}</a>
                  ) : (
                    <Link href={href} className="transition-colors hover:text-[color:var(--cw-fg)]">{label}</Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="cw-subtle mx-auto mt-10 max-w-6xl text-center text-xs sm:text-left">
        © {new Date().getFullYear()} ClipWaltz · www.clipwaltz.com — your memories, shown to the beat.
      </p>
    </footer>
  );
}
