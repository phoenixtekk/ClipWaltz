import { narrateScript } from "@/lib/explainer/voice";
import { generateShort, narrationOf, type ShortScript } from "./script";
import { listSolutions, type WorkplaceSolution } from "./workplace";
import { assembleShort, narrationSections } from "./assemble";
import { renderShortFrame, scenesFor } from "./compositor";

// ─── One short, start to finish ──────────────────────────────────────────────
//
// Script → narration → mp4 + thumbnail, run in one pass rather than as a
// resumable state machine.
//
// That is a deliberate difference from the explainer pipeline, which stages
// itself across sweeps because a five-minute episode takes ~10 minutes to build
// and must survive a restart. A short is ~45 seconds: measured end to end it is
// well inside a single sweep, and a state machine around it would be more
// moving parts than the thing it protects.

export interface ShortBuild {
  script: ShortScript;
  video: Buffer;
  thumbnail: Buffer;
  durationSec: number;
  /** Non-fatal notes, surfaced on the post exactly like the explainer's. */
  warnings: string[];
  source?: { name: string; url: string };
}

/**
 * Choose the next solution for a rule.
 *
 * The cursor walks the filtered catalogue so a rule works through it rather
 * than returning to the same product every slot. `filter` matches name or SKU,
 * which is what lets one rule be "Intune only" without a second catalogue.
 */
export function pickSolution(
  all: WorkplaceSolution[],
  filter: string,
  cursor: number,
): { solution: WorkplaceSolution; nextCursor: number } | null {
  const f = filter.trim().toLowerCase();
  const pool = f
    ? all.filter((s) => s.name.toLowerCase().includes(f) || s.sku.toLowerCase().includes(f))
    : all;
  if (pool.length === 0) return null;
  const i = ((cursor % pool.length) + pool.length) % pool.length;
  return { solution: pool[i], nextCursor: i + 1 };
}

export async function buildShort(opts: {
  /** 'workplace' grounds every technical claim in a real solution page. */
  source: "workplace" | "seed";
  solutionFilter?: string;
  solutionCursor?: number;
  seedPrompt?: string;
  topic?: string;
  /** ElevenLabs voice for this workspace (see narrateScript). */
  voiceId?: string;
  /** Audience line for un-grounded scripts (SP's Intune audience for the admin workspace only). */
  audience?: string;
  onProgress?: (fraction: number) => void;
}): Promise<{ build?: ShortBuild; error?: string; nextCursor?: number }> {
  const warnings: string[] = [];
  let solution: WorkplaceSolution | undefined;
  let nextCursor: number | undefined;
  let topic = opts.topic?.trim() ?? "";

  // ── 1. What is this short about? ──────────────────────────────────────────
  if (opts.source === "workplace") {
    const all = await listSolutions();
    if (all.length === 0) {
      // Grounding is the point of this mode, so a catalogue that cannot be read
      // fails the run rather than quietly writing from the model's memory —
      // that substitution is exactly what would put a wrong blade path on the
      // channel, and nobody would know it had happened.
      return { error: "The Workplace catalogue could not be read, and this rule is set to write only from it." };
    }
    const picked = pickSolution(all, opts.solutionFilter ?? "", opts.solutionCursor ?? 0);
    if (!picked) {
      return { error: `No Workplace solution matches “${opts.solutionFilter}”.` };
    }
    solution = picked.solution;
    nextCursor = picked.nextCursor;
    topic = topic || solution.name;
  } else if (!topic) {
    return { error: "This rule has no topic to write about." };
  }

  // ── 2. Script ─────────────────────────────────────────────────────────────
  const scripted = await generateShort({ topic, source: solution, seed: opts.seedPrompt, audience: opts.audience });
  if (!scripted.script) return { error: scripted.error ?? "The script could not be written." };
  warnings.push(...scripted.warnings);
  const script = scripted.script;
  opts.onProgress?.(0.2);

  // ── 3. Narration ──────────────────────────────────────────────────────────
  const spoken = await narrateScript(narrationSections(script), { voiceId: opts.voiceId });
  if ("error" in spoken) return { error: `Narration failed: ${spoken.error}` };
  const { parts, narration } = spoken;
  const durationSec = narration.durationSec;
  opts.onProgress?.(0.45);

  // A short that overruns is not a short: YouTube reclassifies past 60 seconds
  // and the vertical feeds cut it. Worth saying on the post rather than
  // discovering it from the upload.
  if (durationSec > 60) {
    warnings.push(
      `The narration runs ${Math.round(durationSec)}s, past the 60s ceiling for Shorts — it will publish as a normal video on YouTube.`,
    );
  }

  // ── 4. Video ──────────────────────────────────────────────────────────────
  const assembled = await assembleShort({
    script,
    narrationParts: parts,
    timings: narration.sections,
    words: narration.words,
    durationSec,
    onProgress: (f) => opts.onProgress?.(0.45 + f * 0.5),
  });

  // ── 5. Thumbnail — the hook card, which is already the strongest frame ─────
  const scenes = scenesFor(script, narration.sections);
  const thumbnail = renderShortFrame({ scene: scenes[0], words: [], t: scenes[0].end - 0.05 });
  opts.onProgress?.(1);

  return {
    build: {
      script,
      video: assembled.video,
      thumbnail,
      durationSec,
      warnings,
      source: solution ? { name: solution.name, url: solution.url } : undefined,
    },
    nextCursor,
  };
}

/** The caption a short publishes with, per network. */
export function shortCaption(script: ShortScript): string {
  const body = script.caption || `${script.hook} ${script.problem}`.trim();
  const tags = script.tags.slice(0, 4).map((t) => `#${t.replace(/\s+/g, "")}`).join(" ");
  return [body, tags].filter(Boolean).join("\n\n");
}

export { narrationOf };
