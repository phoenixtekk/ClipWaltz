// Waltz Avatar — Your Presenter (Phase 1). Shared limits and wording (client + server). Server-side code is in
// presenter-actions.ts (server actions), src/app/api/presenters/* (uploads) and worker/generation-worker.mjs
// (processPresenter → AISERVER presenter-prepare-v1 / presenter-lipsync-v1).

/** Presenters one user can keep. */
export const MAX_PRESENTERS = 5;
/** New presenter attempts (submissions) per user per day — each one runs a GPU job. */
export const MAX_PRESENTER_SUBMITS_PER_DAY = 6;
/** Footage: what the browser may upload, and what is kept (normalised to H.264 25 fps, longest side ≤ 1920). */
export const FOOTAGE_MAX_BYTES = 400 * 1024 * 1024;
export const FOOTAGE_MIN_SECONDS = 10;
export const FOOTAGE_KEEP_SECONDS = 120;
/** The live consent clip (recorded in the browser). */
export const CONSENT_MAX_BYTES = 40 * 1024 * 1024;
export const CONSENT_MAX_SECONDS = 30;

/** Presenter seconds are charged in AI credits: one credit per this many seconds (rounded up per render). */
export const PRESENTER_SECONDS_PER_CREDIT = 10;

/** A presenter made from a photo or an AI face: ~30 s of EchoMimic base footage + Real-ESRGAN, the same GPU work as a
 *  30 s Standard talking photo (1 credit/s) — owner decision 2026-10-15. Refunded when the build fails. */
export const PRESENTER_BUILD_CREDITS = 30;
/** AI faces: rounds of new face candidates (3 each) per presenter before one must be picked or the presenter deleted. */
export const MAX_FACE_ROUNDS = 3;

export type PresenterStatus = "draft" | "queued" | "preparing" | "ready" | "failed";
/** How a user's own presenter is made: their video, a frame of their live consent clip, or a fictional AI face. */
export type PresenterSource = "video" | "photo" | "ai";

export type PresenterView = {
  id: string;
  name: string;
  status: PresenterStatus;
  voice: string;
  hasFootage: boolean;
  hasConsent: boolean;
  error: string | null;
  thumbUrl: string | null;
  createdAt: string;
  readyAt: string | null;
  meta: { frames?: number; width?: number; height?: number } | null;
  /** Phase 2: the presenter's own cloned voice. */
  voiceStatus: "none" | "draft" | "queued" | "ready" | "failed";
  voiceHasConsent: boolean;
  voiceError: string | null;
  source: PresenterSource;
  /** photo: the picked frame (seconds into the consent clip); ai: the look it was generated from + face candidates. */
  photoAt: number | null;
  /** Changes when the consent clip is recorded again (cache key for the frame picker). */
  consentRef: string | null;
  description: string | null;
  portraits: string[];
};

/** Deck voice id for a presenter's cloned voice (brief.voice.voiceId). */
export const CLONE_PREFIX = "clone:";
export const isCloneVoice = (id: string | null | undefined) => !!id && id.startsWith(CLONE_PREFIX);

/** The sentence read aloud on camera for the consent clip. The code's digits are spaced so they're read one by one. */
export function consentStatement(name: string, code: string): string {
  return `I, ${name.trim() || "the person on this video"}, agree that ClipWaltz may create an AI presenter of me. My code is ${code.split("").join(" ")}.`;
}

/** The sentence for the voice consent clip (Phase 2 cloned voice). */
export function voiceConsentStatement(name: string, code: string): string {
  return `I, ${name.trim() || "the person on this video"}, agree that ClipWaltz may clone my voice. My code is ${code.split("").join(" ")}.`;
}

/** Credits for `seconds` of presenter video (all presenter scenes of one render together). */
export function presenterCredits(seconds: number): number {
  return seconds > 0 ? Math.ceil(seconds / PRESENTER_SECONDS_PER_CREDIT) : 0;
}

export const PRESENTER_LAYOUTS = [
  { key: "presenter-full", label: "Presenter: full screen" },
  { key: "presenter-split", label: "Presenter: beside the slide" },
  { key: "presenter-bubble", label: "Presenter: corner bubble" },
] as const;
export const isPresenterLayout = (l: string | null | undefined) => !!l && l.startsWith("presenter-");

/** Presenter video templates ("Make a video", src/lib/presenter-video-actions.ts). */
export const PRESENTER_VIDEO_STYLES = [
  { key: "talking-head", label: "Talking head", layout: "presenter-full", text: false },
  { key: "beside-slides", label: "Presenter beside the slides", layout: "presenter-split", text: true },
  { key: "bubble", label: "Slides with a corner bubble", layout: "presenter-bubble", text: true },
] as const;
export type PresenterVideoStyle = (typeof PRESENTER_VIDEO_STYLES)[number]["key"];

/** Phase 3: the longest video that can be translated (seconds). */
export const TRANSLATE_MAX_SECONDS = 180;
