// User-friendly failure text for generation/enhancement jobs (CW-MVP-180). The worker stores the
// raw error in generation_jobs.error_message; the UI shows this mapping and keeps the raw text as
// a detail for support.

const RULES: [RegExp, string][] = [
  [/cancell?ed/i, "This job was cancelled."],
  [/temporarily unavailable|supports clips up to/i, ""], // already user-facing — show as-is
  [/out of memory|OutOfMemory|\bOOM\b/i, "This clip was too big for the AI studio's memory. Try a shorter clip or a lower quality."],
  [/timed out|timeout/i, "The AI studio took too long on this one. Please retry — if it keeps happening, try Preview quality or a shorter clip."],
  [/unreachable|ECONNREFUSED|ECONNRESET|fetch failed|no ComfyUI backend|\b50[234]\b/i, "The AI studio is offline right now. Please retry in a few minutes."],
  [/source (asset|image) not found|no sourceKey|no output/i, "The source media for this job is missing. Pick it again and retry."],
  [/dimensions|frame count/i, "We couldn't read that video. Try re-exporting it and retry."],
];

export function friendlyJobError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  for (const [re, msg] of RULES) if (re.test(raw)) return msg || raw;
  return "Something went wrong while making this video. Please retry.";
}
