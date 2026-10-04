// Client copy of worker/deck/camera.mjs pickMove (same rules) — so the instant preview shows the moves the render makes.
import type { CameraMode } from "./types";

const ACTION = /energetic|action|exciting|excite|fast|thrill|sport|adventur|intense|dynamic|jump|race|racing|speed|splash|dance|party|surf|ski|ride|riding|run|running|crowd|concert|fireworks/i;
const CALM = /calm|peace|seren|relax|quiet|romantic|gentle|soft|sunset|sunrise|tranquil|cozy|cosy|misty|still|dreamy/i;
export const CAMERA_MOVES = ["push-in", "pull-out", "pan-left", "pan-right", "drift", "punch", "shake"] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];

export function pickMove(scene: { role: string; motion: string }, seen: string, mode: CameraMode | undefined, index: number, hasMedia: boolean): CameraMove | null {
  if (!mode || mode === "off" || !hasMedia) return null;
  if (scene.motion && scene.motion !== "auto") return scene.motion === "none" ? null : (CAMERA_MOVES as readonly string[]).includes(scene.motion) ? (scene.motion as CameraMove) : null;
  if (scene.role === "hook") return mode === "energetic" ? "punch" : "push-in";
  if (scene.role === "cta") return "push-in";
  if (ACTION.test(seen)) return mode === "energetic" ? "shake" : mode === "cinematic" ? "punch" : "push-in";
  // Calm footage alternates a drift with a slow pull back (owner 2026-10-03: more zoom-outs).
  if (CALM.test(seen)) return index % 2 ? "pull-out" : "drift";
  const cycle: CameraMove[] = mode === "subtle" ? ["push-in", "pull-out", "drift", "pull-out"] : ["push-in", "pull-out", "pan-left", "pull-out", "pan-right"];
  return cycle[index % cycle.length];
}

/** Move size per mode (same numbers as the render). */
export const CAMERA_SIZE: Record<Exclude<CameraMode, "off">, { zoom: number; pan: number; punch: number; shake: number }> = {
  subtle: { zoom: 0.06, pan: 0.08, punch: 0.04, shake: 0.004 },
  cinematic: { zoom: 0.12, pan: 0.14, punch: 0.08, shake: 0.007 },
  energetic: { zoom: 0.16, pan: 0.16, punch: 0.12, shake: 0.012 },
};
