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
): { clips: DraftClip[]; totalSec: number } {
  const clips: DraftClip[] = [];
  let total = 0;
  for (const a of assets) {
    const remaining = lengthSec > 0 ? lengthSec - total : Infinity;
    if (remaining <= 0) break;
    const full = a.kind === "video" ? DRAFT_PER_VIDEO_SEC : DRAFT_PER_IMAGE_SEC;
    const durationSec = Math.min(full, remaining);
    clips.push({ id: a.id, kind: a.kind, name: a.name, durationSec });
    total += durationSec;
  }
  return { clips, totalSec: total };
}
