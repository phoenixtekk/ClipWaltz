// Waltz AI → Talking photo (Phase C2, 08_ClipWaltz_PhaseC_Video_Plan.md §8): a photo + a script (spoken by a Kokoro
// voice) or the user's own recording → a speaking video, rendered by EchoMimic v3-Flash on AISERVER
// (aiserver/talking/service.py). Shared by the panel, the server action and the worker. Client-safe.

export const TALKING_WORKFLOW = "echomimic-talking-v1"; // AISERVER wrapper workflow id (+ registry row)

/** Owner decision 2026-10-13: the same price as built-in clips, 1 credit per second, and at most 30 s for everyone. */
export const TALKING_MAX_SECONDS = 30;
export const TALKING_CREDITS_PER_SECOND = 1;
/** Render time per second of speech on one RTX 3080 (5.2 s clip: 246 s, measured 2026-10-13). Shown as an estimate. */
export const TALKING_RENDER_SEC_PER_SEC = 47;
export const TALKING_SCRIPT_MAX = 600; // characters; ~30 s of speech at a normal pace
export const TALKING_AUDIO_MAX_BYTES = 20 * 1024 * 1024;
export const TALKING_CONSENT_TEXT = "This is me, or I have this person's permission to make them speak.";

/** Up-front length estimate for a script. Kokoro af_heart measured 2.0 and 2.4 words/s at speed 1 (2026-10-13), so
 *  2.2 words/s plus pauses errs long; the worker refunds down to the length actually rendered. */
export function estimateScriptSeconds(script: string, speed = 1): number {
  const text = script.trim();
  const words = text.split(/[\s,.;:!?\-–—/]+/).filter(Boolean).length;
  if (!words) return 0;
  const pauses = (text.match(/[.!?;:]/g) ?? []).length * 0.25;
  // Floor by length too: measured 13.9–17.5 characters/s (2026-10-13), so 14 errs long — and text without spaces
  // can't be priced as one word.
  const secs = Math.max(words / 2.2 + pauses + 0.5, text.length / 14);
  return Math.min(TALKING_MAX_SECONDS, secs / Math.max(0.7, speed));
}

/** Credits charged up front for `seconds` of speech (capped at the 30 s limit). When the clip is done the worker lowers
 *  it to the length actually rendered — never raises it (the balance was only checked for the up-front amount). */
export const talkingCost = (seconds: number) =>
  Math.max(1, Math.ceil(Math.min(TALKING_MAX_SECONDS, seconds) * TALKING_CREDITS_PER_SECOND));

export type TalkingAspect = "photo" | "9:16" | "16:9" | "1:1";
export const TALKING_ASPECTS: { key: TalkingAspect; label: string }[] = [
  { key: "photo", label: "As the photo" },
  { key: "9:16", label: "9:16" },
  { key: "1:1", label: "1:1" },
  { key: "16:9", label: "16:9" },
];
