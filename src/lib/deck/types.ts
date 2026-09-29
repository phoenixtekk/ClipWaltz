// WaltzDeck shared types (06_ClipWaltz_WaltzDeck_Feature_Spec.md). Keep MODES / LAYOUTS / ROLES in sync
// with worker/deck/planner.mjs and the scene templates in worker/deck/templates.

export type DeckMode = "ad" | "slideshow";
export type TextMode = "auto" | "manual" | "off";
export type SceneTextMode = "auto" | "manual" | "none";

export const DECK_MODES: { key: DeckMode; label: string; desc: string; defaultLength: number }[] = [
  { key: "ad", label: "Ad", desc: "Hook → benefits → call to action", defaultLength: 15 },
  { key: "slideshow", label: "Slideshow", desc: "Your story with captions, on the beat", defaultLength: 45 },
];

export const LAYOUTS = [
  { key: "headline-bottom", label: "Headline, bottom" },
  { key: "headline-center", label: "Big statement" },
  { key: "lower-third", label: "Caption bar" },
  { key: "bullets", label: "Bullet points" },
  { key: "title-card", label: "Title card" },
  { key: "cta-card", label: "Call-to-action card" },
] as const;
export type LayoutKey = (typeof LAYOUTS)[number]["key"];

export const ROLES = ["hook", "problem", "benefit", "proof", "content", "title", "cta"] as const;
export type SceneRole = (typeof ROLES)[number];

export const MOTIONS = ["auto", "none", "push-in", "pull-out", "pan-left", "pan-right"] as const;

/** Kokoro voices served by worker/tts/server.py (keep in sync); previews in public/voices/<id>.mp3. */
export const VOICES = [
  { id: "af_heart", label: "Heart — warm, female (US)" },
  { id: "af_bella", label: "Bella — bright, female (US)" },
  { id: "af_nicole", label: "Nicole — soft, female (US)" },
  { id: "am_michael", label: "Michael — friendly, male (US)" },
  { id: "am_fenrir", label: "Fenrir — deep, male (US)" },
  { id: "am_puck", label: "Puck — upbeat, male (US)" },
  { id: "bf_emma", label: "Emma — clear, female (UK)" },
  { id: "bm_george", label: "George — calm, male (UK)" },
] as const;
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
};

export type DeckPlanStatus =
  | { status: "idle" }
  | { status: "queued" | "describing" | "planning"; done?: number; total?: number; startedAt?: string }
  | { status: "ready"; title?: string; finishedAt?: string; unusedAssetIds?: string[] }
  | { status: "failed"; error: string };

export type DeckState = { brief: DeckBrief; plan?: DeckPlanStatus };

export type SceneText = { headline?: string; sub?: string; bullets?: string[] };

export type DeckScene = {
  id: string;
  orderIndex: number;
  role: SceneRole | string;
  assetId: string | null;
  inSec: number | null;
  outSec: number | null;
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
  voice: { mode: "off", voiceId: "af_heart", speed: 1 },
  captions: { enabled: true },
});
