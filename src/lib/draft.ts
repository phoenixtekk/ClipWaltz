// Draft-preview timeline. Mirrors the render worker's clip timing
// (worker/render-worker.mjs: PER_IMAGE = 2s, PER_VIDEO = 4s, whole video capped to the
// project length via -t) so the in-editor preview matches the order and pacing of the
// final HD render — but with zero server render time.
export const DRAFT_PER_IMAGE_SEC = 2;
export const DRAFT_PER_VIDEO_SEC = 4;

export type DraftClip = {
  id: string;
  kind: string; // photo | video
  name: string;
  durationSec: number;
};

/** Ordered preview timeline, capping the total at lengthSec like the worker's `-t`. */
export function buildDraftTimeline(
  assets: { id: string; kind: string; name: string }[],
  lengthSec: number,
  loopToFill = false,
): { clips: DraftClip[]; totalSec: number } {
  const clips: DraftClip[] = [];
  let total = 0;
  const cap = lengthSec > 0 ? lengthSec : Infinity;
  for (const a of assets) {
    if (cap - total <= 0) break;
    const full = a.kind === "video" ? DRAFT_PER_VIDEO_SEC : DRAFT_PER_IMAGE_SEC;
    const durationSec = Math.min(full, cap - total);
    clips.push({ id: a.id, kind: a.kind, name: a.name, durationSec });
    total += durationSec;
  }
  // Loop-to-fill only: repeat the clips to reach the target length. (Without it the video is
  // just as long as the footage allows — the worker still tiles videos into more windows, which
  // the low-res draft can't show without per-clip durations.)
  const MAX_CLIPS = 400;
  let i = 0;
  while (loopToFill && cap !== Infinity && total < cap - 0.4 && assets.length > 0 && clips.length < MAX_CLIPS) {
    const a = assets[i % assets.length];
    i++;
    const full = a.kind === "video" ? DRAFT_PER_VIDEO_SEC : DRAFT_PER_IMAGE_SEC;
    const durationSec = Math.min(full, cap - total);
    if (durationSec < 0.4) break;
    clips.push({ id: a.id, kind: a.kind, name: a.name, durationSec });
    total += durationSec;
  }
  return { clips, totalSec: total };
}
