// ─── Stage 1 of the explainer pipeline: seed + topic → a structured script ────
//
// Everything downstream of here is deterministic. The compositor draws diagrams
// from `visual.spec`, ElevenLabs speaks `narration` verbatim, and the chapter
// list is built from section order — so this stage's only job is to turn a
// topic into DATA of a known shape, and to refuse anything that isn't.
//
// The model never draws a diagram or writes an image; it describes one.
//
// Verified against the AI Box on 2026-09-13, `qwen3.8:27b`, one full run:
//   111s · done_reason "stop" · 9,766 chars · strict JSON parsed first try
//   6 sections · 1,053 narration words · visual types diagram/comparison/flow/
//   flow/bullets/title · CTA present · 10 YouTube tags
//
// Two request flags carry that result and must not be dropped:
//   `think: false`  — `qwen3.8:27b` is a hybrid thinking model. Left on, it
//                     spends the budget in `message.thinking` and returns a
//                     truncated or empty `content`. Same reason the rest of
//                     `src/lib/ai.ts` sets it.
//   `format: "json"` — constrains decoding to valid JSON, which is what let the
//                     probe parse on the first attempt rather than needing the
//                     fence-stripping most prose-mode prompts require.

// ClipWaltz: these jobs run on the render worker (AI box), whose OLLAMA_MODEL is a vision model — so the script
// model has its own variable. Same AI Box and model SP used.
const OLLAMA_BASE = (process.env.EXPLAINER_OLLAMA_URL || process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL || "http://192.168.166.182:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.EXPLAINER_OLLAMA_MODEL || "qwen3.8:27b";

/** A script long enough to be worth rendering. Below this the run is a dud. */
const MIN_NARRATION_WORDS = 450;

// ─── Why this retries ────────────────────────────────────────────────────────
//
// Measured across four runs on 2026-09-13 with the owner's real seed, the model
// gets the SHAPE right and the SIZE wrong:
//
//   sections returned : 6, 4, 3, 5, 5   (asked for six, every time)
//   narration words   : 1053, 868, 650, 485   (asked for 700–1100)
//   valid JSON        : 4 of 5 runs; one returned an object with no `sections`
//
// A 485-word script is a three-minute video from a six-part brief — publishable
// in shape, thin in substance. Rendering one costs minutes of GPU time and an
// upload slot, so it is much cheaper to ask again than to ship it.
//
// So a result that parses but misses target is retried like a failure, bounded,
// and the best attempt is kept rather than the last — a second roll can come
// back worse, and throwing away a good first answer would be its own bug.
/** Below this, the script is valid but too thin to be worth a render. */
const TARGET_NARRATION_WORDS = 700;
/** Six were asked for; five still carries the full arc. */
const TARGET_SECTIONS = 5;
/** Total attempts. Each is ~2 minutes, inside a background job. */
const MAX_ATTEMPTS = 3;

/**
 * The visual types the MODEL is allowed to emit, and the only ones validation
 * accepts from it.
 *
 * Deliberately still five. Getting reliable `visual.spec` output took several
 * rounds — the model invented numbered keys (`step1`, `loop1`) and wrote picture
 * prompts into the data — and the shape list it has to hold is exactly what that
 * reliability is sensitive to. Visual variety is added AFTER validation instead,
 * by `variety.ts`, working on data that has already been checked.
 */
export const VISUAL_TYPES = ["diagram", "flow", "bullets", "comparison", "title"] as const;

/**
 * Every type the compositor can draw, including the variants `variety.ts`
 * substitutes in. Each variant shares its spec shape with one of the five above,
 * so a substitution never produces a spec its template cannot read.
 */
export const RENDER_TYPES = [
  ...VISUAL_TYPES, "checklist", "layers", "timeline", "stat",
] as const;

export type VisualType = (typeof RENDER_TYPES)[number];
/** The subset a model response may use. */
export type ModelVisualType = (typeof VISUAL_TYPES)[number];

export interface ScriptSection {
  id: string;
  heading: string;
  /** Spoken verbatim. This is what ElevenLabs receives. */
  narration: string;
  /** Terms the compositor may emphasise as they are spoken. */
  onscreen_terms: string[];
  visual: { type: VisualType; spec: Record<string, unknown> };
}

export interface ExplainerScript {
  title: string;
  hook: string;
  sections: ScriptSection[];
  cta: string;
  youtube: { description: string; tags: string[] };
}

export interface ScriptResult {
  script: ExplainerScript;
  /** Spoken-word count across all sections — drives the runtime estimate. */
  words: number;
  /** Roughly how long the narration will run, at ~150 spoken words a minute. */
  estimatedMinutes: number;
  model: string;
  elapsedMs: number;
  /** How many generations it took. */
  attempts?: number;
  /** True when every attempt came back thinner than target and the best was kept. */
  underTarget?: boolean;
}

/**
 * The shape contract, stated to the model as JSON rather than prose.
 *
 * Kept separate from the owner's editorial seed on purpose: the seed in
 * `CHANNEL_SEED_AND_TOPICS.md` is voice and structure and belongs to the owner,
 * while this is the machine contract the compositor depends on. Mixing them
 * means an editorial tweak can silently break the renderer.
 */
function shapeContract(): string {
  return [
    "Return STRICT JSON only — no prose, no markdown fence — matching exactly:",
    '{"title":str,"hook":str,"sections":[{"id":str,"heading":str,"narration":str,',
    '"onscreen_terms":[str],"visual":{"type":"diagram|flow|bullets|comparison|title","spec":{}}}],',
    '"cta":str,"youtube":{"description":str,"tags":[str]}}',
    "",
    // ⚠️ Do NOT list the six parts as a bare comma-separated sentence here.
    // Measured 2026-09-13: "Six sections, in this order: the hook, why it
    // exists, the mental model, …" made the model emit those phrases as
    // TOP-LEVEL OBJECT KEYS — `{"the hook":…,"the mental model":…}` — with no
    // `sections` array at all. Under JSON-constrained decoding a comma list
    // reads as a key list. Anchoring them to `heading` keeps them as values.
    "`sections` must be a JSON ARRAY of six objects. The `heading` of each, in order,",
    'covers: the hook · why it exists · the mental model · how the pieces fit ·',
    "the misconception · the close. Use your own wording for each heading.",
    "`narration` is spoken verbatim, so it must read aloud cleanly and must never",
    "point at the screen.",
    "",
    // ⚠️ The spec shapes below are not decoration — the compositor dispatches on
    // them. Measured 2026-09-13, without them the model invents a different key
    // set every time: `step1/step2/step3` in one flow section and
    // `loop1/loop2/branch_fail/branch_pass` in the next, `left_column` as a
    // single string rather than a list, `item1…item4` instead of an array. It
    // also wrote picture prompts into the data ("Laptop Icon", "Abstract secure
    // hotel lobby") despite being told not to — which is the diagram-
    // hallucination failure this pipeline exists to avoid, arriving as JSON.
    "`visual.spec` must use EXACTLY these shapes, by `visual.type`:",
    '  title      → {"text": str, "subtext": str}',
    '  bullets    → {"items": [str, str, str]}            (3-5 items)',
    '  flow       → {"steps": [str, str, str]}            (3-5 steps, in order)',
    '  comparison → {"leftTitle": str, "rightTitle": str, "left": [str], "right": [str]}',
    '  diagram    → {"center": str, "around": [str, str, str]}   (3-5 around)',
    "Use those key names literally. Arrays must be JSON arrays, never `item1`,",
    "`step1`, `loop1` style numbered keys.",
    "",
    "Every string in `spec` is a SHORT LABEL that will be drawn as text — five words",
    "at most. It is never a description of a picture. Never write \"icon\", \"image\",",
    "\"illustration\", \"photo\", or a scene description: there is no illustrator, only",
    "a renderer that draws the words you provide.",
  ].join("\n");
}

export function explainerConfigured(): boolean {
  return Boolean(OLLAMA_BASE);
}

/**
 * Write one explainer script.
 *
 * Resolves with an error rather than throwing on a bad model response, matching
 * how the publishing providers behave — a dud generation is an outcome the
 * render job records and retries, not an exception that kills the sweep.
 */
export async function generateScript(opts: {
  /** The owner's editorial seed (voice, structure, accuracy, funnel rules). */
  seedPrompt: string;
  /** The topic for this slot, from the rule's rotation. */
  topic: string;
  /** Recent titles from the same rule, so the model does not re-tread them. */
  avoid?: string[];
  /** Overridable for a faster model on a spike. */
  model?: string;
  timeoutMs?: number;
  /** Attempts before accepting the best under-target result. */
  attempts?: number;
}): Promise<ScriptResult | { error: string }> {
  const max = Math.max(1, opts.attempts ?? MAX_ATTEMPTS);
  let best: ScriptResult | null = null;
  let lastError = "";

  for (let i = 0; i < max; i++) {
    const r = await generateOnce(opts);
    if ("error" in r) {
      lastError = r.error;
      continue;
    }
    // Keep the fullest script seen, not the most recent — a later roll can come
    // back thinner, and discarding a good one would make retrying harmful.
    if (!best || r.words > best.words) best = r;
    if (r.words >= TARGET_NARRATION_WORDS && r.script.sections.length >= TARGET_SECTIONS) {
      return { ...r, attempts: i + 1 };
    }
  }

  if (best) return { ...best, attempts: max, underTarget: true };
  return { error: lastError || "The AI Box did not return a usable script." };
}

async function generateOnce(opts: {
  /** The owner's editorial seed (voice, structure, accuracy, funnel rules). */
  seedPrompt: string;
  /** The topic for this slot, from the rule's rotation. */
  topic: string;
  /** Recent titles from the same rule, so the model does not re-tread them. */
  avoid?: string[];
  /** Overridable for a faster model on a spike. */
  model?: string;
  timeoutMs?: number;
}): Promise<ScriptResult | { error: string }> {
  if (!OLLAMA_BASE) return { error: "The AI Box is not configured (OLLAMA_BASE_URL)." };

  const model = opts.model || OLLAMA_MODEL;
  const system = `${opts.seedPrompt.trim()}\n\n${shapeContract()}`;
  const avoid = opts.avoid?.length
    ? `\n\nRecent episodes on this channel — do not repeat their angle or title:\n${opts.avoid
        .slice(0, 12)
        .map((a) => `- ${a}`)
        .join("\n")}`
    : "";

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Topic: ${opts.topic}${avoid}` },
        ],
        stream: false,
        // See the header note — neither of these is optional.
        think: false,
        format: "json",
        // A full six-section script measured 9,766 characters. Too small a
        // budget truncates mid-JSON and the parse fails with nothing to salvage.
        options: { num_predict: 4096, temperature: 0.7 },
      }),
      // Measured 111s for a complete script; a slow box or a longer topic needs
      // headroom, and this only ever runs inside a background render job.
      signal: AbortSignal.timeout(opts.timeoutMs ?? 300_000),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Network error calling the AI Box." };
  }

  if (!res.ok) return { error: `The AI Box returned HTTP ${res.status}.` };

  const data = (await res.json().catch(() => null)) as {
    message?: { content?: string; thinking?: string };
    done_reason?: string;
  } | null;

  const content = data?.message?.content?.trim() ?? "";
  if (!content) {
    // The signature of thinking being left on: the budget went to `thinking`
    // and `content` came back empty. Name it, because the fix is one flag.
    return {
      error: data?.message?.thinking
        ? "The model spent its whole budget on hidden reasoning and returned no script — `think: false` was not applied."
        : `The model returned nothing (done_reason: ${data?.done_reason ?? "unknown"}).`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { error: `The model did not return valid JSON (${content.length} chars).` };
  }

  const script = validate(parsed);
  if ("error" in script) return script;

  const words = script.sections.reduce((n, s) => n + countWords(s.narration), 0);
  if (words < MIN_NARRATION_WORDS) {
    return { error: `The script is too short to render — ${words} spoken words, minimum ${MIN_NARRATION_WORDS}.` };
  }

  return {
    script,
    words,
    // ~150 words a minute is the usual conversational narration rate; this is an
    // estimate for scheduling, not a promise. The real duration comes from the
    // ElevenLabs timing map once the audio exists.
    estimatedMinutes: Math.round((words / 150) * 10) / 10,
    model,
    elapsedMs: Date.now() - started,
  };
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Coerce the model's object into the contract, or say precisely what is wrong.
 *
 * Deliberately strict about `visual.type`: the compositor dispatches on it, and
 * an unknown value would reach the renderer as a missing template rather than as
 * a bad generation. An unrecognised type is rewritten to `bullets`, which every
 * template set can draw, instead of failing the whole script over one section.
 */
function validate(raw: unknown): ExplainerScript | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "The model returned a non-object." };
  const o = raw as Record<string, unknown>;

  const title = str(o.title);
  if (!title) return { error: "The script has no title." };

  const rawSections = Array.isArray(o.sections) ? o.sections : [];
  if (rawSections.length === 0) return { error: "The script has no sections." };

  const sections: ScriptSection[] = [];
  for (const [i, item] of rawSections.entries()) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const narration = str(s.narration);
    // A section with no narration has nothing to speak and nothing to time
    // visuals against, so it cannot contribute to the video.
    if (!narration) continue;

    const t = str(s.visual && typeof s.visual === "object" ? (s.visual as Record<string, unknown>).type : "");
    const type = (VISUAL_TYPES as readonly string[]).includes(t) ? (t as VisualType) : "bullets";
    const spec =
      s.visual && typeof s.visual === "object" && typeof (s.visual as Record<string, unknown>).spec === "object"
        ? ((s.visual as Record<string, unknown>).spec as Record<string, unknown>)
        : {};

    sections.push({
      id: str(s.id) || `s${i + 1}`,
      heading: str(s.heading) || `Part ${i + 1}`,
      narration,
      onscreen_terms: Array.isArray(s.onscreen_terms) ? s.onscreen_terms.map(String).filter(Boolean).slice(0, 12) : [],
      visual: { type, spec },
    });
  }
  if (sections.length === 0) return { error: "No section carried any narration." };

  const yt = (o.youtube && typeof o.youtube === "object" ? o.youtube : {}) as Record<string, unknown>;

  return {
    title,
    hook: str(o.hook),
    sections,
    cta: str(o.cta),
    youtube: {
      description: str(yt.description),
      // YouTube rejects an over-long tag list; keep it to what it will accept.
      tags: Array.isArray(yt.tags) ? yt.tags.map(String).filter(Boolean).slice(0, 15) : [],
    },
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
