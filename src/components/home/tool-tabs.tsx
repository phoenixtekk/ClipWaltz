"use client";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, Clapperboard, Wand2, UserRound, Presentation, Music, Play, Captions } from "lucide-react";

type Tool = {
  id: string;
  name: string;
  icon: ReactNode;
  tint: string;
  headline: string;
  body: string;
  facts: string[];
  visual: ReactNode;
};

/**
 * The four products as tabs (one panel visible at a time). Facts come from FEATURES.md; the only live part is
 * `videoVendors` — the cloud video models the admin has switched on — so the copy never names a model that is off.
 */
export function ToolTabs({ videoVendors }: { videoVendors: string[] }) {
  const tools: Tool[] = [
    {
      id: "autowaltz",
      name: "AutoWaltz",
      icon: <Clapperboard className="size-4" />,
      tint: "var(--cw-coral)",
      headline: "Your photos and clips, cut to the beat",
      body: "Drop in the camera roll from a trip, an event or a launch. AutoWaltz sets it to a licensed track, cuts every shot on the beat and renders the music video in the cloud.",
      facts: [
        "Faster cuts in loud sections, longer holds when the music is calm",
        "9:16, 16:9, 1:1 or 4:5 — sized for every feed",
        "Draft preview in the editor before the full render",
        "360 footage (Insta360 .insv) reframed into a normal video",
      ],
      visual: <BeatVisual />,
    },
    {
      id: "waltz-ai",
      name: "Waltz AI",
      icon: <Wand2 className="size-4" />,
      tint: "var(--cw-violet)",
      headline: "Brand-new clips from a sentence or a photo",
      body: "Describe a scene or bring a photo to life. Waltz AI makes the clip, then lets you enhance it, assemble a storyboard or remix it into a video you already made.",
      facts: [
        "Text-to-video and image-to-video",
        videoVendors.length
          ? `The built-in ClipWaltz AI model, or ${listOf(videoVendors)} in the cloud`
          : "Runs on ClipWaltz's own AI model",
        "Remix: weave AI lead-ins and shots into a finished video",
        "Every AI button shows its credit cost before you click",
      ],
      visual: <PromptVisual />,
    },
    {
      id: "waltz-avatar",
      name: "Waltz Avatar",
      icon: <UserRound className="size-4" />,
      tint: "var(--cw-blue)",
      headline: "A presenter who reads your script",
      body: "Record a short consent video to make a presenter of yourself, or describe a made-up person for an AI presenter. Paste a script and pick a layout — the presenter speaks it.",
      facts: [
        "Your own presenter from a video of you, or an AI face",
        "Use your own voice, after a recorded voice consent",
        "Talking head, presenter beside the slides, or a corner bubble",
        "Translate a video of yourself, spoken in your voice with lips re-synced",
      ],
      visual: <PresenterVisual />,
    },
    {
      id: "waltzdeck",
      name: "WaltzDeck",
      icon: <Presentation className="size-4" />,
      tint: "var(--cw-magenta)",
      headline: "Ads, slideshows, presentations and explainers",
      body: "Write a brief and add your media. WaltzDeck plans the video scene by scene with on-screen text and voiceover — or paste a full script and it follows your scenes, timing and words exactly.",
      facts: [
        "Full-script briefs up to 8,000 characters, followed word for word",
        "Voiceover and captions; edit any scene with the AI chat",
        "Export PDF or PowerPoint, or start from a PPTX, PDF or web page",
        "Campaign packs test hooks, calls to action, lengths and shapes",
      ],
      visual: <ScriptVisual />,
    },
  ];

  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (active + step + tools.length) % tools.length;
    setActive(next);
    refs.current[next]?.focus();
  };
  const t = tools[active];

  return (
    <div>
      <div
        role="tablist"
        aria-label="ClipWaltz tools"
        onKeyDown={onKey}
        className="cw-glass mx-auto grid w-full max-w-2xl grid-cols-2 gap-1 rounded-3xl p-1.5 sm:flex sm:rounded-full"
      >
        {tools.map((tool, i) => (
          <button
            key={tool.id}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            id={`tab-${tool.id}`}
            aria-selected={i === active}
            aria-controls={`panel-${tool.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className={`inline-flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
              i === active ? "cw-gradient text-white shadow-lg shadow-fuchsia-500/20" : "cw-muted hover:text-[color:var(--cw-fg)]"
            }`}
          >
            {tool.icon} {tool.name}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`panel-${t.id}`}
        aria-labelledby={`tab-${t.id}`}
        className="cw-glass cw-metal mt-8 grid items-center gap-8 rounded-[2rem] p-6 sm:p-10 lg:grid-cols-2"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: t.tint }}>{t.name}</p>
          <h3 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{t.headline}</h3>
          <p className="cw-muted mt-4 text-pretty leading-relaxed">{t.body}</p>
          <ul className="cw-muted mt-6 space-y-2.5 text-sm">
            {t.facts.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0" style={{ color: t.tint }} /> {f}
              </li>
            ))}
          </ul>
          <Link
            href="/projects"
            className="cw-gradient cw-sheen mt-8 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25"
          >
            Try {t.name} <ArrowRight className="size-4" />
          </Link>
        </div>
        <div aria-hidden className="flex justify-center">{t.visual}</div>
      </div>
    </div>
  );
}

const listOf = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/* ---- illustrative mock-ups (decorative; aria-hidden by the parent) ---- */
function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="relative aspect-[4/3] w-full max-w-md overflow-hidden rounded-3xl bg-slate-950 p-5 text-white shadow-2xl ring-1 ring-white/10">
      <div className="cw-gradient absolute inset-0 opacity-25" />
      <div className="relative flex h-full flex-col">{children}</div>
    </div>
  );
}

function BeatVisual() {
  const bars = [0.3, 0.7, 0.45, 0.9, 0.35, 0.8, 0.5, 1, 0.4, 0.75, 0.3, 0.6, 0.85, 0.45, 0.7, 0.35];
  const clips = ["linear-gradient(140deg,#ff9966,#ff5e7e)", "linear-gradient(140deg,#8b5cf6,#e05bd6)", "linear-gradient(140deg,#4f7cff,#22d3ee)", "linear-gradient(140deg,#ff7a59,#8b5cf6)"];
  return (
    <Screen>
      <div className="flex items-center gap-2 text-xs text-white/80"><Music className="size-3.5" /> Licensed track · on the beat</div>
      <div className="mt-auto flex h-24 items-end gap-1">
        {bars.map((b, i) => (
          <span key={i} className="cw-eq-bar w-full origin-bottom rounded-full bg-white/80" style={{ height: `${b * 100}%`, animation: `cw-eq ${0.9 + (i % 4) * 0.2}s ease-in-out ${i * 0.05}s infinite` }} />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-4 gap-1.5">
        {clips.map((c, i) => <div key={i} className="aspect-video rounded-md ring-1 ring-white/20" style={{ background: c }} />)}
      </div>
    </Screen>
  );
}

function PromptVisual() {
  return (
    <Screen>
      <div className="rounded-xl bg-white/10 p-3 text-sm text-white/90 ring-1 ring-white/15">
        <span className="text-white/50">Describe the shot · </span>a paper boat drifting down a rainy street at dusk
      </div>
      <div className="mt-4 grid flex-1 grid-cols-2 gap-2">
        {["linear-gradient(160deg,#1e3a8a,#8b5cf6)", "linear-gradient(160deg,#0f766e,#4f7cff)"].map((g, i) => (
          <div key={i} className="relative rounded-xl ring-1 ring-white/15" style={{ background: g }}>
            <Play className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 fill-white/90 text-white/90" />
          </div>
        ))}
      </div>
    </Screen>
  );
}

function PresenterVisual() {
  return (
    <Screen>
      <div className="relative flex-1 overflow-hidden rounded-xl" style={{ background: "linear-gradient(160deg,#334155,#1e293b)" }}>
        <div className="absolute bottom-0 left-1/2 h-[70%] w-1/2 -translate-x-1/2 rounded-t-full bg-white/15" />
        <div className="absolute left-1/2 top-[18%] size-16 -translate-x-1/2 rounded-full bg-white/25" />
        <div className="absolute inset-x-4 bottom-3 flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-2 text-xs">
          <Captions className="size-3.5 shrink-0" /> Welcome! Here&apos;s what&apos;s new this month…
        </div>
      </div>
    </Screen>
  );
}

function ScriptVisual() {
  const scenes = [
    ["Scene 1 · 0:00–0:05", "On-screen text: Meet the new menu"],
    ["Scene 2 · 0:05–0:12", "Voiceover: Fresh every morning, from 7 a.m."],
    ["Scene 3 · 0:12–0:18", "On-screen text: Order ahead today"],
  ];
  return (
    <Screen>
      <div className="space-y-2">
        {scenes.map(([h, l]) => (
          <div key={h} className="rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/15">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">{h}</p>
            <p className="mt-0.5 text-sm text-white/90">{l}</p>
          </div>
        ))}
      </div>
    </Screen>
  );
}
