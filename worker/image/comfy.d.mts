// Types for worker/image/comfy.mjs.
export const COMFY_URL: string;
export const COMFY_CKPT: string;
export function comfyImageStatus(): Promise<{ ok: boolean; reason?: string }>;
export function writeImagePrompt(brief: string, styleKey?: string | null): Promise<string>;
export function renderComfyImage(opts: {
  prompt: string;
  style?: string | null;
  format: string;
  seed?: number | null;
  jobId?: string;
  isCancelled?: () => Promise<boolean>;
  onProgress?: (pct: number) => void;
  timeoutMs?: number;
}): Promise<{ png: Buffer; seed: number; ckpt: string; prompt: string; model: { width: number; height: number } } | null>;
