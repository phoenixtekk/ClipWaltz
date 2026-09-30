// WaltzDeck dynamic camera (owner request 2026-09-29): per-scene pans, push/pull zooms, drifts, beat-synced punch-ins and
// handheld shake, sized by the deck's camera mode (subtle / cinematic / energetic). Only the MEDIA moves — the text
// layer is composited on top afterwards, so headlines and captions stay steady.
// One ffmpeg `zoompan` per scene, driven by the output frame number (d=1 → works on video frames and on a looped photo).
// Keep MOVES in sync with src/lib/deck/types.ts MOTIONS and the preview in src/components/deck/scene-frame.tsx.

export const MOVES = ["push-in", "pull-out", "pan-left", "pan-right", "drift", "punch", "shake"];

const ACTION = /energetic|action|exciting|excite|fast|thrill|sport|adventur|intense|dynamic|jump|race|racing|speed|splash|dance|party|surf|ski|ride|riding|run|running|crowd|concert|fireworks/i;
const CALM = /calm|peace|seren|relax|quiet|romantic|gentle|soft|sunset|sunrise|tranquil|cozy|cosy|misty|still|dreamy/i;

/**
 * The move for a scene: the scene's own choice when it isn't "auto", else from its role, what the vision model saw and
 * the camera mode. Returns null for no camera (mode off, or "none").
 */
export function pickMove(scene, asset, mode, index) {
  if (!mode || mode === "off") return null;
  const own = scene.motion;
  if (own && own !== "auto") return own === "none" ? null : MOVES.includes(own) ? own : null;
  const d = asset?.ai_description ?? {};
  const seen = [d.mood, d.summary, ...(d.goodFor ?? []), d.subject].filter(Boolean).join(" ");
  if (scene.role === "hook") return mode === "energetic" ? "punch" : "push-in";
  if (scene.role === "cta") return "push-in";
  if (ACTION.test(seen)) return mode === "energetic" ? "shake" : mode === "cinematic" ? "punch" : "push-in";
  if (CALM.test(seen)) return "drift";
  const cycle = mode === "subtle" ? ["push-in", "drift", "pull-out", "drift"] : ["push-in", "pan-left", "pull-out", "pan-right"];
  return cycle[index % cycle.length];
}

// How big each move is per mode: zoom amount, pan zoom headroom, punch size, shake size (share of the frame).
const SIZE = {
  subtle: { zoom: 0.06, pan: 0.08, punch: 0.04, shake: 0.004 },
  cinematic: { zoom: 0.12, pan: 0.14, punch: 0.08, shake: 0.007 },
  energetic: { zoom: 0.16, pan: 0.16, punch: 0.12, shake: 0.012 },
};

/**
 * ffmpeg filter chain (after any rotation) that fills W×H with the moving picture for `dur` seconds.
 * `beats` = beat times inside the scene (seconds from its start), for punch / shake impacts. `video` halves the moves on
 * footage in subtle mode (it already moves).
 */
export function cameraChain(move, mode, { W, H, dur, beats = [], video = false }) {
  const S = SIZE[mode] ?? SIZE.cinematic;
  const k = video && mode === "subtle" ? 0.5 : 1;
  const N = Math.max(1, Math.round(dur * 30));
  // Headroom: the source is scaled to 1.5× the frame so zooming in never goes soft.
  const KW = Math.round((W * 1.5) / 2) * 2, KH = Math.round((H * 1.5) / 2) * 2;
  // fps=30 first: zoompan with d=1 emits one frame per INPUT frame, so a 24/25/60 fps source (or a looped photo at 25)
  // would otherwise come out too long or too short.
  const pre = `fps=30,scale=${KW}:${KH}:force_original_aspect_ratio=increase,crop=${KW}:${KH},setsar=1`;
  const T = "(on/30)";
  const P = `min(1,on/${N})`;
  const EASE = `(${P}*${P}*(3-2*${P}))`; // smoothstep: moves start and end softly
  const cx = "(iw-iw/zoom)/2", cy = "(ih-ih/zoom)/2";
  const clampX = (e) => `max(0,min(iw-iw/zoom,${e}))`, clampY = (e) => `max(0,min(ih-ih/zoom,${e}))`;
  const f = (n) => Number(n.toFixed(4));
  // Decaying impact after each beat (≤ 10 per scene): 1 at the beat, ~0 after 0.3 s.
  const hits = beats.filter((b) => b >= 0 && b < dur).slice(0, 10).map((b) => `if(gte(${T},${f(b)}),exp(-(${T}-${f(b)})*10),0)`);
  const impact = hits.length ? `(${hits.join("+")})` : "0";
  let z, x = cx, y = cy;
  switch (move) {
    case "push-in": z = `1+${f(S.zoom * k)}*${EASE}`; break;
    case "pull-out": z = `1+${f(S.zoom * k)}*(1-${EASE})`; break;
    case "pan-left": z = `${f(1 + S.pan * k)}`; x = `(iw-iw/zoom)*(1-${EASE})`; break;
    case "pan-right": z = `${f(1 + S.pan * k)}`; x = `(iw-iw/zoom)*${EASE}`; break;
    case "drift":
      z = `${f(1 + S.pan * 0.7 * k)}+${f(S.zoom * 0.3 * k)}*${EASE}`;
      x = `(iw-iw/zoom)*(0.3+0.4*${EASE})`; y = `(ih-ih/zoom)*(0.6-0.2*${EASE})`;
      break;
    case "punch": {
      // A small base push plus a quick zoom punch on every beat (or once at the start with no beats).
      const hit = hits.length ? impact : `exp(-${T}*6)`;
      z = `1+${f(S.zoom * 0.3 * k)}*${EASE}+${f(S.punch * k)}*${hit}`;
      break;
    }
    case "shake": {
      // Handheld: two sines per axis at unrelated frequencies (never looks like a loop), stronger right after beats.
      const a = S.shake * k;
      const amp = `(${f(a)}*(1+1.5*${impact}))`;
      z = `${f(1 + Math.max(0.05, a * 6))}`;
      x = clampX(`${cx}+iw*${amp}*(0.6*sin(${T}*29)+0.4*sin(${T}*47+1.7))`);
      y = clampY(`${cy}+ih*${amp}*(0.6*sin(${T}*31+0.4)+0.4*sin(${T}*53+2.1))`);
      break;
    }
    default: return null;
  }
  return `${pre},zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=30,setsar=1`;
}

// Diagnostic: node worker/deck/camera.mjs → prints each move's chain for a 1080×1920, 3 s scene with two beats.
if (process.argv[1]?.endsWith("camera.mjs")) {
  for (const m of MOVES) console.log(m, "\n ", cameraChain(m, "energetic", { W: 1080, H: 1920, dur: 3, beats: [0.5, 1.4] }));
}
