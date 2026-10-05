// WaltzDeck shared types (06_ClipWaltz_WaltzDeck_Feature_Spec.md). Keep MODES / LAYOUTS / ROLES in sync
// with worker/deck/planner.mjs and the scene templates in worker/deck/templates.
import type { SceneFrameBox } from "./frame";
import type { ResolvedBackdrop, SceneBackdrop } from "../../../worker/deck/backdrop.mjs";
export type { ResolvedBackdrop, SceneBackdrop };

export type DeckMode = "ad" | "slideshow" | "presentation" | "explainer";
export type TextMode = "auto" | "manual" | "off";
export type SceneTextMode = "auto" | "manual" | "none";

export const DECK_MODES: { key: DeckMode; label: string; desc: string; defaultLength: number }[] = [
  { key: "ad", label: "Ad", desc: "Hook → benefits → call to action", defaultLength: 15 },
  { key: "slideshow", label: "Slideshow", desc: "Your story with captions, on the beat", defaultLength: 45 },
  { key: "presentation", label: "Presentation", desc: "Slides with points — present it, or export PDF / PowerPoint", defaultLength: 90 },
  { key: "explainer", label: "Explainer", desc: "Animated scenes, a voiceover and one glowing look — no footage needed", defaultLength: 40 },
];

export const LAYOUTS = [
  { key: "headline-bottom", label: "Headline, bottom" },
  { key: "headline-center", label: "Big statement" },
  { key: "lower-third", label: "Caption bar" },
  { key: "bullets", label: "Bullet points" },
  { key: "title-card", label: "Title card" },
  { key: "cta-card", label: "Call-to-action card" },
  { key: "slide", label: "Slide — title + points" },
  // Animated scenes (worker/deck/motion.mjs — keep MOTION_LAYOUTS in sync).
  { key: "mg-orbit", label: "Animated: apps orbiting a phone" },
  { key: "mg-swarm", label: "Animated: notification overload" },
  { key: "mg-words", label: "Animated: big words" },
  { key: "mg-logo", label: "Animated: logo reveal" },
  { key: "mg-chat", label: "Animated: chat on a phone" },
  { key: "mg-fanout", label: "Animated: one message, every channel" },
  { key: "mg-end", label: "Animated: end card" },
] as const;
export type LayoutKey = (typeof LAYOUTS)[number]["key"];
export const isMotionLayout = (l: string) => l.startsWith("mg-");

/** What each animated layout does with the scene's text fields (editor hints). */
export const MOTION_FIELDS: Record<string, { headline: string; sub?: string; bullets?: string; media: "behind" | "ignored" }> = {
  "mg-orbit": { headline: "Headline (top)", media: "ignored" },
  "mg-swarm": { headline: "Headline (top)", media: "ignored" },
  "mg-words": { headline: "The words (up to 8, one at a time)", sub: "Small line under them", media: "behind" },
  "mg-logo": { headline: "Name", sub: "Tagline", media: "ignored" },
  "mg-chat": { headline: "Chat name", bullets: "Messages — Name: message (Channel). Start with \"Me:\" for your own.", media: "behind" },
  "mg-fanout": { headline: "Headline (top)", bullets: "Channels (2–6) — e.g. SMS, Email, WhatsApp", media: "ignored" },
  "mg-end": { headline: "Name", sub: "Tagline", bullets: "Web address or call to action (first line)", media: "behind" },
};

export const ROLES = ["hook", "problem", "benefit", "proof", "content", "title", "cta"] as const;
export type SceneRole = (typeof ROLES)[number];

/** Per-scene camera move (the render's dynamic camera + the preview). "auto" = chosen from the scene's role, mood and the
 *  deck's camera mode. Keep in sync with worker/deck/camera.mjs. */
export const MOTIONS = ["auto", "none", "push-in", "pull-out", "pan-left", "pan-right", "drift", "punch", "shake"] as const;
export const MOTION_LABELS: Record<(typeof MOTIONS)[number], string> = {
  auto: "Camera: Auto", none: "Camera: Still", "push-in": "Push in", "pull-out": "Pull out", "pan-left": "Pan left",
  "pan-right": "Pan right", drift: "Drift", punch: "Punch on the beat", shake: "Handheld shake",
};

/** Languages a deck can be written, voiced and captioned in (phase 5). `en` = the default. */
export const LANGUAGES = [
  { code: "en", label: "English", name: "English" },
  { code: "es", label: "Español", name: "Spanish" },
  { code: "fr", label: "Français", name: "French" },
  { code: "it", label: "Italiano", name: "Italian" },
  { code: "pt", label: "Português (BR)", name: "Brazilian Portuguese" },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]["code"];

/** Kokoro voices served by worker/tts/server.py (keep in sync); previews in public/voices/<id>.mp3. */
export const VOICES = [
  { id: "af_heart", label: "Heart — warm, female (US)", lang: "en" },
  { id: "af_bella", label: "Bella — bright, female (US)", lang: "en" },
  { id: "af_nicole", label: "Nicole — soft, female (US)", lang: "en" },
  { id: "am_michael", label: "Michael — friendly, male (US)", lang: "en" },
  { id: "am_fenrir", label: "Fenrir — deep, male (US)", lang: "en" },
  { id: "am_puck", label: "Puck — upbeat, male (US)", lang: "en" },
  { id: "bf_emma", label: "Emma — clear, female (UK)", lang: "en" },
  { id: "bm_george", label: "George — calm, male (UK)", lang: "en" },
  { id: "ef_dora", label: "Dora — warm, female", lang: "es" },
  { id: "em_alex", label: "Alex — friendly, male", lang: "es" },
  { id: "ff_siwis", label: "Siwis — clear, female", lang: "fr" },
  { id: "if_sara", label: "Sara — bright, female", lang: "it" },
  { id: "im_nicola", label: "Nicola — calm, male", lang: "it" },
  { id: "pf_dora", label: "Dora — warm, female", lang: "pt" },
  { id: "pm_alex", label: "Alex — friendly, male", lang: "pt" },
] as const;
/** The first voice of a language (the default when a deck is translated). */
export const defaultVoiceFor = (lang: string) => VOICES.find((v) => v.lang === lang)?.id ?? "af_heart";
export type VoiceMode = "off" | "auto" | "manual";

export type DeckBrief = {
  mode: DeckMode;
  prompt: string; // the overall brief
  goal?: string;
  audience?: string;
  tone?: string;
  offer?: string;
  cta?: { text: string; url?: string } | null;
  lengthSec: number;
  textMode: TextMode; // project default for on-screen text
  /** Voiceover (phase 2): off, AI-written narration per scene, or the user's own lines. */
  voice?: { mode: VoiceMode; voiceId: string; speed: number };
  /** Burned-in captions of the narration, each word highlighted as it's spoken. */
  captions?: { enabled: boolean };
  /** Music + voice mix (levels in dB, tone presets, how the music behaves under the voice). Absent = defaults. */
  audio?: DeckAudio;
  /** Dynamic camera: pans, zooms, beat punches and shake chosen per scene. Absent = off. */
  camera?: { mode: CameraMode };
  /** Language of the on-screen text, narration and captions (phase 5); absent = English. */
  language?: LanguageCode;
  /** What's behind text-only scenes unless a scene picks its own (worker/deck/backdrop.mjs). Absent = brand gradient. */
  backdrop?: SceneBackdrop;
  /** Set on a translated copy: the deck it was translated from. */
  translatedFrom?: { projectId: string; title: string } | null;
};

export type DeckPlanStatus =
  | { status: "idle" }
  | { status: "queued" | "describing" | "planning"; done?: number; total?: number; startedAt?: string }
  | { status: "ready"; title?: string; finishedAt?: string; unusedAssetIds?: string[] }
  | { status: "failed"; error: string };

/** PPTX / PDF / web page → brief + scenes (phase 3). Runs on the deck queue; the editor polls. */
export type DeckImportStatus =
  | { status: "idle" }
  | { status: "queued" | "reading" | "summarizing"; source: "pptx" | "pdf" | "url"; name: string; startedAt?: string }
  | { status: "ready"; source: "pptx" | "pdf" | "url"; name: string; scenes: number; images: number; finishedAt?: string; note?: string }
  | { status: "failed"; source?: "pptx" | "pdf" | "url"; name?: string; error: string };

/** "Build my brand kit from my website" (phase 5): suggested by the deck worker, applied only when the owner says so. */
export type BrandSuggestion =
  | { status: "idle" }
  | { status: "queued" | "reading"; url: string }
  | { status: "ready"; url: string; primary: string; secondary: string; headingFont: string; bodyFont: string; logoKey: string | null; found?: { color: string | null; fonts: boolean; logo: boolean } }
  | { status: "failed"; url?: string; error: string };

/** A translated copy being written (phase 5). */
export type DeckTranslation =
  | { status: "idle" }
  | { status: "queued" | "translating"; lang: string; startedAt?: string }
  | { status: "ready"; lang: string; kept: number; finishedAt?: string }
  | { status: "failed"; lang: string; error: string };

/**
 * AI backdrop presets: a text-free still made by Waltz AI (one frame of the text-to-video model). `{color}` = the
 * brand's main colour as a word. Every prompt keeps the centre open so words read over it (all seven checked on Wan 2.2
 * 2026-10-03: vivid, text-free; the light ones measure light and get dark words).
 */
export const BACKDROP_PRESETS = [
  { key: "keynote", label: "Keynote glow", prompt: "Abstract keynote stage background, two bright glowing {color} and amber neon light arcs framing the left and right sides, reflective floor with light reflections, soft volumetric glow, open space in the middle, cinematic, premium" },
  { key: "aurora", label: "Soft aurora", prompt: "Abstract background, flowing aurora of bright {color} and soft pink light waves, luminous glow, smooth gradients, open space in the middle, premium wallpaper" },
  { key: "rays", label: "Light rays", prompt: "Abstract background, bright {color} god rays and glowing haze streaming down from the top, luminous, airy, calm, open space in the middle" },
  { key: "workspace", label: "Calm workspace", prompt: "Bright modern office desk out of focus, warm bokeh lights, shallow depth of field, soft {color} accents, open space in the middle, high quality photo" },
  { key: "nature", label: "Nature calm", prompt: "Soft misty mountain landscape at sunrise, glowing {color} sky, calm lake, minimal, lots of open sky, high quality photo" },
  { key: "city", label: "City at dusk", prompt: "Blurred city lights at dusk, bright bokeh circles, {color} and amber glow, shallow depth of field, open space in the middle, high quality photo" },
  { key: "paper", label: "Light paper", prompt: "Minimal bright background of soft white paper layers with subtle {color} shadows and gentle curves, airy and clean, empty center" },
] as const;
export type BackdropPresetKey = (typeof BACKDROP_PRESETS)[number]["key"] | "custom";

/** An AI backdrop image made for this deck (projects.deck.backdrops; the MinIO key never leaves the server). */
export type BackdropImage = {
  id: string; key: string; prompt: string; preset: string; tone: "light" | "dark";
  /** Brightness 0–255 of a 3×3 grid (row-major) — the text colour follows the cells under the words. */
  grid?: number[];
  aspect: string; createdAt: string;
};

export type DeckState = { brief: DeckBrief; backdrops?: BackdropImage[]; plan?: DeckPlanStatus; import?: DeckImportStatus; brandSuggestion?: BrandSuggestion; translation?: DeckTranslation };

export type DeckExportFormat = "pdf" | "pptx";
export type DeckExport = {
  id: string; format: DeckExportFormat; status: "queued" | "running" | "done" | "failed";
  error: string | null; createdAt: string; finishedAt: string | null;
};

/** Bullet limits shared by the editor, server actions and the importer (presentations need more than ads). */
export const MAX_BULLETS = 6;
export const MAX_BULLET_CHARS = 90;

export type SceneText = { headline?: string; sub?: string; bullets?: string[] };

export type DeckScene = {
  id: string;
  orderIndex: number;
  role: SceneRole | string;
  assetId: string | null;
  inSec: number | null;
  outSec: number | null;
  /** Crop / reposition of the media (null = centred cover) — src/lib/deck/frame.ts. */
  frame: SceneFrameBox | null;
  /** This scene's own backdrop (null = the deck default). */
  background: SceneBackdrop | null;
  /** The backdrop it actually gets (own, else the deck default, else the brand gradient), ready to draw. */
  backdrop: ResolvedBackdrop;
  durationSec: number;
  textMode: SceneTextMode;
  text: SceneText;
  layout: LayoutKey | string;
  motion: string;
  transition: string;
  locked: boolean;
  voice: string | null; // narration line (empty = silent)
  prompt: string | null;
  why: string | null;
};

export const defaultBrief = (mode: DeckMode = "ad"): DeckBrief => ({
  mode,
  prompt: "",
  lengthSec: DECK_MODES.find((m) => m.key === mode)?.defaultLength ?? 15,
  textMode: "auto",
  cta: null,
  // Explainers are narrated: the AI writes a voiceover line per scene (captions follow it).
  voice: { mode: mode === "explainer" ? "auto" : "off", voiceId: "af_heart", speed: 1 },
  captions: { enabled: true },
});

// ── Campaign packs (phase 4) ───────────────────────────────────────────────────────────────────────
export const CAMPAIGN_LENGTHS = [6, 15, 30] as const;
export const CAMPAIGN_ASPECTS = ["9:16", "1:1", "4:5", "16:9"] as const;
export const MAX_VARIANTS = 12; // keep in sync with worker/deck/variants.mjs
/** A variant needs this many views before it can be called the winner. */
export const MIN_VIEWS_FOR_WINNER = 10;

export type CampaignHook = {
  id: string; original?: boolean; source?: "original" | "ai" | "winner" | "you";
  assetId: string | null; inSec?: number | null; headline: string; sub?: string; voice?: string; angle?: string; why?: string;
};
export type CampaignCta = { id: string; original?: boolean; source?: "original" | "ai" | "you"; text: string };
export type CampaignConfig = {
  hooks: CampaignHook[]; ctas: CampaignCta[]; lengths: number[]; aspects: string[];
  ctaUrl: string | null; aiHooks: number; aiCtas: number; watermark?: boolean;
  winner?: { renderId: string; headline: string; voice?: string; angle?: string; losers: string[] } | null;
};
export type VariantStats = { views: number; plays: number; completes: number; clicks: number };
export type CampaignVariant = {
  renderId: string; code: string; label: string; status: string; aspect: string; lengthSec: number;
  hookHeadline: string; ctaText: string; angle: string; stats: VariantStats;
};
export type Campaign = {
  id: string; name: string; status: "drafting" | "draft" | "building" | "rendering" | "failed"; shared: boolean;
  error: string | null; parentId: string | null; createdAt: string; config: CampaignConfig; variants: CampaignVariant[];
  winnerRenderId: string | null;
};

/** Tone presets for the brief (sent to the model as written; "Custom…" keeps free text). No claim words — the claim
 *  guard would strip lines like "limited time". */
export const TONES = [
  "Energetic & upbeat", "Friendly & warm", "Professional & trustworthy", "Luxurious & elegant", "Playful & fun",
  "Inspirational & uplifting", "Calm & soothing", "Bold & confident", "Heartfelt & emotional", "Witty & light-hearted",
  "Urgent & direct", "Informative & clear", "Adventurous & exciting", "Minimal & modern",
] as const;
export const MAX_BRIEF_HISTORY = 15;

// ── Music & voice mix ──────────────────────────────────────────────────────────────────────────────
export type DuckMode = "steady" | "gentle" | "strong";
export type DeckAudio = {
  music: boolean; // false = no music at all (voice / silence only)
  musicGainDb: number; // −24 … +6
  voiceGainDb: number; // −12 … +6
  musicTone: "neutral" | "warm" | "bright" | "bass" | "lofi";
  voiceTone: "neutral" | "warm" | "clear" | "radio";
  duck: DuckMode;
};
export const DEFAULT_AUDIO: DeckAudio = { music: true, musicGainDb: 0, voiceGainDb: 0, musicTone: "neutral", voiceTone: "neutral", duck: "steady" };
export const MUSIC_TONES = [
  { key: "neutral", label: "Neutral" }, { key: "warm", label: "Warm" }, { key: "bright", label: "Bright" },
  { key: "bass", label: "Bass boost" }, { key: "lofi", label: "Lo-fi" },
] as const;
export const VOICE_TONES = [
  { key: "neutral", label: "Neutral" }, { key: "warm", label: "Warm" }, { key: "clear", label: "Clear (crisper)" }, { key: "radio", label: "Radio" },
] as const;
export const DUCK_MODES = [
  { key: "steady", label: "Steady", desc: "Music sits lower, evenly, while there's a voiceover — no rising and falling." },
  { key: "gentle", label: "Gentle duck", desc: "Music dips slowly while the voice talks and comes back slowly in longer pauses." },
  { key: "strong", label: "Strong duck", desc: "Music drops quickly under every line and swells back between them (ad-style)." },
] as const;

// ── Dynamic camera ─────────────────────────────────────────────────────────────────────────────────
export type CameraMode = "off" | "subtle" | "cinematic" | "energetic";
export const CAMERA_MODES = [
  { key: "off", label: "Off", desc: "Clips play as filmed; photos keep the gentle Ken Burns from the project's style." },
  { key: "subtle", label: "Subtle", desc: "Slow push-ins, drifts and pans — a polished, calm feel." },
  { key: "cinematic", label: "Cinematic", desc: "Bigger moves matched to each scene, a punch-in on the hook, a slow push on the call to action." },
  { key: "energetic", label: "Energetic", desc: "Zoom punches on the beat and handheld shake on action scenes — for promos and sport." },
] as const;
