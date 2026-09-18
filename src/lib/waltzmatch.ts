import type { Track } from "./music";

// WaltzMatch — intelligent soundtrack matching.
// Analyze a project's media (mood/energy) and rank the catalog so users get "make something
// great from my stuff" instead of scrolling thousands of songs. Analysis is best-effort via
// the AI-box vision model (photos); matching is a deterministic, testable function.

export type MediaProfile = {
  mood: string; // happy | warm | energetic | calm | epic
  energy: number; // 0..1
  occasion: string | null; // vacation | party | wedding | everyday | …
  label: string; // human summary, e.g. "Vacation • warm • medium energy"
  source: "vision" | "heuristic";
};

// Desired track moods + target BPM per detected mood.
const MOOD_TARGETS: Record<string, { moods: string[]; bpm: number }> = {
  happy: { moods: ["upbeat", "happy", "energetic", "pop"], bpm: 118 },
  warm: { moods: ["emotional", "cinematic", "chill", "acoustic", "warm"], bpm: 92 },
  energetic: { moods: ["energetic", "upbeat", "electronic", "rock"], bpm: 132 },
  calm: { moods: ["chill", "ambient", "calm", "acoustic"], bpm: 78 },
  epic: { moods: ["cinematic", "epic", "dramatic"], bpm: 100 },
};

function energyToLabel(e: number): string {
  return e >= 0.66 ? "high energy" : e <= 0.33 ? "gentle" : "medium energy";
}

/** Deterministic 0..1 match score for a track against a profile. */
export function scoreTrack(profile: MediaProfile, track: Track): number {
  const target = MOOD_TARGETS[profile.mood] ?? MOOD_TARGETS.happy;
  const trackMood = (track.mood ?? "").toLowerCase();
  const moodMatch = trackMood
    ? target.moods.some((m) => trackMood.includes(m))
      ? 1
      : 0.35
    : 0.5;
  // energy nudges the target BPM up/down a little
  const targetBpm = target.bpm + Math.round((profile.energy - 0.5) * 24);
  const bpmProximity = track.bpm ? 1 - Math.min(1, Math.abs(track.bpm - targetBpm) / 60) : 0.5;
  return moodMatch * 0.6 + bpmProximity * 0.4;
}

export type Recommendation = { trackId: string; matchPct: number };

/** Rank tracks for a profile; returns the top `limit` with a friendly match %. */
export function recommend(profile: MediaProfile, tracks: Track[], limit = 6): Recommendation[] {
  const scored = tracks
    .map((t) => ({ trackId: t.id, raw: scoreTrack(profile, t) }))
    .sort((a, b) => b.raw - a.raw)
    .slice(0, limit);
  // Map raw scores to a pleasant 72..98 display band (top match highest).
  return scored.map((s, i) => ({
    trackId: s.trackId,
    matchPct: Math.max(60, Math.round(98 - i * 3 - (1 - s.raw) * 20)),
  }));
}

/** Media-mix heuristic when vision analysis isn't available. */
export function heuristicProfile(photoCount: number, videoCount: number): MediaProfile {
  const total = Math.max(1, photoCount + videoCount);
  const videoRatio = videoCount / total;
  const energy = Math.min(0.9, 0.4 + videoRatio * 0.5);
  const mood = energy >= 0.66 ? "energetic" : "happy";
  return {
    mood,
    energy,
    occasion: null,
    label: `${mood === "energetic" ? "Energetic" : "Upbeat"} • ${energyToLabel(energy)}`,
    source: "heuristic",
  };
}

/** Build the human label for a vision-derived profile. */
export function visionLabel(occasion: string | null, mood: string, energy: number): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return [occasion ? cap(occasion) : null, cap(mood), energyToLabel(energy)].filter(Boolean).join(" • ");
}
