import type { WorkplaceSolution } from "./workplace";

// ─── Writing a 30-50 second short ────────────────────────────────────────────
//
// A short is NOT a shortened explainer. The explainer stage asks for ~700 words
// across five sections; a short is 60–150 words with one idea in it, and asking
// the same prompt for "a shorter version" produces a five-section script with
// every section starved rather than one tip told properly.
//
// So it gets its own grammar, which is the grammar shorts actually use:
//
//   HOOK     0–3s   the reason to not scroll. A cost, a number, a mistake.
//   PROBLEM  3–8s   one sentence naming the pain.
//   STEPS    8–35s  2–4 concrete, do-it-now actions. THE ENTIRE POINT.
//   PAYOFF   35–45s what you get, then where to go.
//
// Two things are enforced rather than requested, because the model will not
// hold them on its own:
//
//  - **A word BAND, not a minimum.** Too long is the failure mode here, not too
//    short: 150 words is already ~55 seconds and YouTube treats over 60s as a
//    normal video. The explainer stage only ever guards the floor.
//  - **Steps must be concrete.** A step that says "configure the policy" is
//    worthless; it has to name the blade, the setting or the command. Checked
//    by length and rejected, because the model happily emits filler otherwise.

// ClipWaltz: these jobs run on the render worker (AI box), whose OLLAMA_MODEL is a vision model — so the script
// model has its own variable. Same AI Box and model SP used.
const OLLAMA_BASE = (process.env.EXPLAINER_OLLAMA_URL || process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL || "http://192.168.166.182:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.EXPLAINER_OLLAMA_MODEL || "qwen3.8:27b";

/**
 * The spoken-word band, ~2.6 words/second → roughly 23-58 seconds.
 *
 * The floor was 90 and that was WRONG — not a model failure. The structure this
 * prompt asks for (a one-sentence hook, problem and payoff around 2-4
 * one-sentence steps) tops out near 65 words, so a 90-word floor contradicted
 * the shape being requested and every attempt "missed" a target it could not
 * reach. Measured against real output rather than assumed: a grounded WHfB
 * script came back at 57, 57 and 67 words, and 67 words is a perfectly good
 * 26-second short. The ceiling stays: past 150 words a short is a video.
 */
export const MIN_WORDS = 60;
export const MAX_WORDS = 150;
export const MAX_ATTEMPTS = 3;

export interface ShortStep {
  /** 2–5 words, drawn on screen as a numbered card. */
  label: string;
  /** The spoken sentence. Must name something concrete. */
  detail: string;
}

export interface ShortScript {
  /** YouTube Shorts title — short, no clickbait punctuation. */
  title: string;
  hook: string;
  problem: string;
  steps: ShortStep[];
  payoff: string;
  /** Caption for the non-YouTube networks. */
  caption: string;
  tags: string[];
  /** Where the viewer is sent. Present only for catalogue-sourced shorts. */
  sourceUrl?: string;
  sourceName?: string;
}

export interface ShortResult {
  script?: ShortScript;
  error?: string;
  warnings: string[];
  words: number;
}

export function narrationOf(s: ShortScript): string {
  return [s.hook, s.problem, ...s.steps.map((x) => x.detail), s.payoff].join(" ");
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const SHAPE = `{
  "title": "string, max 80 chars, plain — no ALL CAPS and no exclamation marks",
  "hook": "one sentence, max 14 words, the reason not to scroll",
  "problem": "one sentence naming the pain",
  "steps": [{ "label": "2-5 words", "detail": "one sentence naming a specific blade, setting, policy or command" }],
  "payoff": "the result in concrete terms, then where to go",
  "caption": "2-3 sentences for a social post",
  "tags": ["lowercase", "no-hash", "max-6"]
}`;

function prompt(opts: { topic: string; source?: WorkplaceSolution; seed?: string; audience?: string }): string {
  const rules = [
    `Write a ${MIN_WORDS}-${MAX_WORDS} word script for a 30-50 second vertical video.`,
    "Between 2 and 4 steps, each one or two sentences. Every step must name something a viewer can act on immediately — a specific blade path, setting name, policy, report or command. A step that only says to 'configure' or 'review' something is a failure.",
    "Plain spoken English. No markdown, no emoji, no stage directions, no 'in this video'.",
    "Do not put a number of steps in the title — it contradicts the script whenever the count changes.",
    "Do not invent product behaviour, setting names or error codes.",
  ];

  if (opts.source) {
    // Grounded: the passage is the only permitted source of technical fact.
    return [
      `You are writing a short technical tip video about: ${opts.topic}`,
      "",
      "Use ONLY the reference below for technical facts. Do not add capabilities, setting names, blade paths or numbers that are not in it. If the reference does not support a step, use a different step that it does support.",
      "",
      `--- REFERENCE: ${opts.source.name} ---`,
      opts.source.body.slice(0, 5000),
      "--- END REFERENCE ---",
      "",
      ...rules,
      "",
      `Reply with JSON only, in exactly this shape:\n${SHAPE}`,
    ].join("\n");
  }

  return [
    `You are writing a short technical tip video about: ${opts.topic}`,
    opts.seed ? `\nStanding brief:\n${opts.seed}` : "",
    "",
    // ClipWaltz: SP's channel audience (Intune admins) only for the Phoenixtekk admin workspace; any other workspace's
    // audience comes from its own brief.
    opts.audience ? `${opts.audience} Be specific and practical.` : "Be specific and practical.",
    "",
    ...rules,
    "",
    `Reply with JSON only, in exactly this shape:\n${SHAPE}`,
  ].join("\n");
}

/** Reject the filler the model produces when it has nothing concrete to say. */
const VAGUE = /^(configure|review|check|set up|enable|make sure|ensure|verify|consider|look at)\b/i;

function validate(raw: unknown): { script?: ShortScript; problems: string[] } {
  const problems: string[] = [];
  const d = raw as Partial<ShortScript> | null;
  if (!d || typeof d !== "object") return { problems: ["the model did not return an object"] };

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const title = str(d.title);
  const hook = str(d.hook);
  const problem = str(d.problem);
  const payoff = str(d.payoff);
  const steps = Array.isArray(d.steps)
    ? d.steps
        .map((s) => ({ label: str((s as ShortStep)?.label), detail: str((s as ShortStep)?.detail) }))
        .filter((s) => s.label && s.detail)
    : [];

  if (!title) problems.push("no title");
  if (!hook) problems.push("no hook");
  if (steps.length < 2) problems.push(`only ${steps.length} usable step(s); needs at least 2`);
  if (steps.length > 4) steps.length = 4;

  // The quality gate that matters: a step with nothing in it.
  const thin = steps.filter((s) => wordCount(s.detail) < 6 || (VAGUE.test(s.detail) && wordCount(s.detail) < 12));
  if (thin.length) problems.push(`${thin.length} step(s) too vague to act on`);

  if (problems.length) return { problems };

  const script: ShortScript = {
    title: title.slice(0, 80),
    hook,
    problem: problem || hook,
    steps,
    payoff: payoff || "Full walkthrough at the link.",
    caption: str(d.caption) || hook,
    tags: (Array.isArray(d.tags) ? d.tags : [])
      .map((t) => String(t).toLowerCase().replace(/^#/, "").trim())
      .filter(Boolean)
      .slice(0, 6),
  };
  return { script, problems: [] };
}

export function shortsConfigured(): boolean {
  return Boolean(OLLAMA_BASE);
}

/**
 * Generate one short script.
 *
 * Retries on a script that fails validation or misses the word band, and keeps
 * the attempt CLOSEST TO THE BAND rather than the last one — the last attempt
 * is not the best attempt, and the explainer stage learned that the hard way.
 */
export async function generateShort(opts: {
  topic: string;
  source?: WorkplaceSolution;
  seed?: string;
  model?: string;
  audience?: string;
}): Promise<ShortResult> {
  if (!OLLAMA_BASE) return { error: "The AI Box is not configured (OLLAMA_BASE_URL).", warnings: [], words: 0 };

  const warnings: string[] = [];
  let best: { script: ShortScript; words: number; miss: number } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model || OLLAMA_MODEL,
        messages: [{ role: "user", content: prompt(opts) }],
        stream: false,
        // qwen3.8 is a hybrid thinking model: left on it spends the budget on
        // hidden reasoning and returns nothing.
        think: false,
        format: "json",
        options: { temperature: 0.7, num_predict: 2000 },
      }),
      signal: AbortSignal.timeout(180_000),
    }).catch(() => null);

    if (!res?.ok) {
      warnings.push(`attempt ${attempt}: the AI Box did not answer`);
      continue;
    }
    const d = (await res.json().catch(() => null)) as { message?: { content?: string } } | null;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(d?.message?.content ?? "");
    } catch {
      warnings.push(`attempt ${attempt}: the reply was not valid JSON`);
      continue;
    }

    const { script, problems } = validate(parsed);
    if (!script) {
      warnings.push(`attempt ${attempt}: ${problems.join("; ")}`);
      continue;
    }

    const words = wordCount(narrationOf(script));
    const miss = words < MIN_WORDS ? MIN_WORDS - words : words > MAX_WORDS ? words - MAX_WORDS : 0;
    if (!best || miss < best.miss) best = { script, words, miss };
    if (miss === 0) {
      return { script: withSource(script, opts.source), warnings, words };
    }
    warnings.push(`attempt ${attempt}: ${words} words, outside the ${MIN_WORDS}-${MAX_WORDS} band`);
  }

  if (!best) return { error: `No usable script after ${MAX_ATTEMPTS} attempts.`, warnings, words: 0 };
  return {
    script: withSource(best.script, opts.source),
    words: best.words,
    warnings: [
      ...warnings,
      `Used the closest attempt (${best.words} words) after ${MAX_ATTEMPTS} tries; the target is ${MIN_WORDS}-${MAX_WORDS}.`,
    ],
  };
}

function withSource(s: ShortScript, source?: WorkplaceSolution): ShortScript {
  return source ? { ...s, sourceUrl: source.url, sourceName: source.name } : s;
}
