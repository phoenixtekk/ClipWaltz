// Cloud video models for Waltz AI (Phase C1, 08_ClipWaltz_PhaseC_Video_Plan.md). Shared by the app (Generate tab, admin,
// pricing) and the generation worker (worker/video/cloud.mjs), so it is plain JS.
//
// Facts checked against each vendor's own API docs / SDK types on 2026-10-13:
// - Kling 3.0: 3–15 s; text→video aspect 16:9 / 9:16 / 1:1 (image→video: the image sets it); 720p $0.084/s (no audio).
// - Runway gen4.5: 2–10 s, text→video 1280:720 / 720:1280, image→video also 960:960; $0.12/s.
//   gen4_turbo: image→video only, $0.05/s; its duration values are NOT documented in the SDK types (5 and 10 assumed —
//   unverified until the first real-key test).
// - MiniMax H3-Max: 5–15 s, 480P $0.05/s, 768P $0.08/s; text→video ratio required, image→video follows the image.
// Default credits = vendor cost ÷ credit value (≈ $0.039 on Pro), rounded up — owner decision 2026-10-13; admin-editable.

export const VIDEO_PROVIDERS = {
  kling: { label: "Kling", vendor: "Kuaishou (Kling AI)", keyHint: "API key from the Kling AI console" },
  runway: { label: "Runway", vendor: "Runway", keyHint: "API key from the Runway developer portal", credit: "Powered by Runway" },
  minimax: { label: "MiniMax", vendor: "MiniMax", keyHint: "API key from the MiniMax platform" },
};
export const VIDEO_PROVIDER_IDS = Object.keys(VIDEO_PROVIDERS);
export const VIDEO_SETTINGS_KEY = "video_providers";
export const DEFAULT_VIDEO_DAILY_LIMIT = 10;

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const VIDEO_MODELS = [
  {
    id: "kling-3.0", provider: "kling", label: "Kling 3.0 (720p)", tasks: ["text_to_video", "image_to_video"],
    durations: range(3, 15), t2vAspects: ["16:9", "9:16", "1:1"], i2vAspects: null, usdPerSec: 0.084, defaultCredits: 3,
  },
  {
    id: "runway-gen4.5", provider: "runway", label: "Runway Gen-4.5", tasks: ["text_to_video", "image_to_video"],
    durations: range(2, 10), t2vAspects: ["16:9", "9:16"], i2vAspects: ["16:9", "9:16", "1:1"], usdPerSec: 0.12, defaultCredits: 4,
  },
  {
    id: "runway-gen4_turbo", provider: "runway", label: "Runway Gen-4 Turbo", tasks: ["image_to_video"],
    durations: [5, 10], t2vAspects: [], i2vAspects: ["16:9", "9:16", "1:1"], usdPerSec: 0.05, defaultCredits: 2,
  },
  {
    id: "minimax-h3-max-480p", provider: "minimax", label: "MiniMax H3-Max (480p)", tasks: ["text_to_video", "image_to_video"],
    durations: range(5, 15), t2vAspects: ["16:9", "9:16", "1:1"], i2vAspects: null, usdPerSec: 0.05, defaultCredits: 2,
  },
  {
    id: "minimax-h3-max-768p", provider: "minimax", label: "MiniMax H3-Max (768p)", tasks: ["text_to_video", "image_to_video"],
    durations: range(5, 15), t2vAspects: ["16:9", "9:16", "1:1"], i2vAspects: null, usdPerSec: 0.08, defaultCredits: 3,
  },
];
export const videoModel = (id) => VIDEO_MODELS.find((m) => m.id === id) ?? null;

/** Aspects a model accepts for a task; null = the source image decides (any of the app's three is fine). */
export function aspectsFor(model, task) {
  return task === "text_to_video" ? model.t2vAspects : model.i2vAspects;
}
