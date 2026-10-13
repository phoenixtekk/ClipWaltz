// Types for worker/video/catalog.mjs (cloud video models for Waltz AI).
export type VideoProviderId = "kling" | "runway" | "minimax";
export type VideoTask = "text_to_video" | "image_to_video";
export type VideoModel = {
  id: string;
  provider: VideoProviderId;
  label: string;
  tasks: VideoTask[];
  durations: number[];
  t2vAspects: string[];
  i2vAspects: string[] | null;
  usdPerSec: number;
  defaultCredits: number;
};
export const VIDEO_PROVIDERS: Record<VideoProviderId, { label: string; vendor: string; keyHint: string; credit?: string }>;
export const VIDEO_PROVIDER_IDS: VideoProviderId[];
export const VIDEO_SETTINGS_KEY: string;
export const DEFAULT_VIDEO_DAILY_LIMIT: number;
export const VIDEO_MODELS: VideoModel[];
export function videoModel(id: string): VideoModel | null;
export function aspectsFor(model: VideoModel, task: VideoTask): string[] | null;
