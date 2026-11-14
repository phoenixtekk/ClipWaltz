// AI provider — self-hosted Ollama "AI Box" (per standing rule). Isolated here so
// the rest of the app never talks to a model directly.
import { trimToLimit } from "@/lib/social/post-limits";

// ClipWaltz: OLLAMA_URL is the repo's existing name for the AI Box; OLLAMA_MODEL is already taken by a VISION model
// (WaltzMatch), so social copy has its own SOCIAL_AI_MODEL. Default per the AI Box standing rule (general model).
const OLLAMA_BASE = (process.env.OLLAMA_URL || "http://192.168.166.182:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.SOCIAL_AI_MODEL || "qwen3.8:27b";

export function aiConfigured(): boolean {
  return Boolean(OLLAMA_BASE);
}

// Instruction appended to every copy-generating prompt. Most social networks
// (Facebook, LinkedIn, X, Instagram, …) do NOT render Markdown, so `**bold**`
// shows up as literal asterisks. Ask for plain text; sanitizeForSocial() is the
// safety net for when the model uses Markdown anyway.
const PLAIN_TEXT_RULE =
  "Write in PLAIN TEXT for social media. Do NOT use any Markdown formatting: no ** or * for bold/italic, no _underscores_, no # headings, no backticks, no [text](link) syntax. These networks show those symbols literally. For a list, start each line with a • bullet. Convey emphasis through word choice, not symbols.";

/**
 * Strip Markdown that would show up as literal symbols on networks that don't
 * render it. Keeps the words, removes the markup (bold/italic/headings/code/
 * links/blockquotes), and turns list markers into • bullets. Guarantees no
 * stray `*` emphasis characters survive.
 */
export function sanitizeForSocial(text: string): string {
  let t = (text || "").replace(/\r\n/g, "\n");

  // Fenced + inline code → keep the content, drop the fences/backticks.
  t = t.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, "$1");
  t = t.replace(/`([^`]+)`/g, "$1");

  // Images ![alt](url) → url ; links [label](url) → "label (url)" (or just url).
  t = t.replace(/!\[[^\]]*\]\(([^)]+)\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) =>
    label.trim() && label.trim() !== url.trim() ? `${label.trim()} (${url.trim()})` : url.trim()
  );

  // Line-level markers: headings, blockquotes, and list bullets.
  t = t
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "") // ## Heading → Heading
        .replace(/^\s{0,3}>\s?/, "") // > quote → quote
        .replace(/^(\s*)[-*+]\s+/, "$1• ") // "- item" / "* item" → "• item"
    )
    .join("\n");

  // Emphasis: strip the markers, keep the words. Bold before italic.
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1"); // **bold**
  t = t.replace(/__([^_]+)__/g, "$1"); // __bold__
  t = t.replace(/\*(\S[^*\n]*?\S|\S)\*/g, "$1"); // *italic*
  t = t.replace(/(^|[\s(])_(\S[^_\n]*?\S|\S)_(?=[\s).,!?;:]|$)/g, "$1$2"); // _italic_ (spares URLs/handles)

  // Any emphasis asterisk still touching a word (orphans) → remove; spaced `*`
  // (e.g. "5 * 3") is left alone.
  t = t.replace(/\*(?=\S)|(?<=\S)\*/g, "");

  return t.replace(/\n{3,}/g, "\n\n").trim();
}

export type AiMode = "write" | "improve" | "shorten" | "hashtags" | "ideas";
export type AiLength = "standard" | "detailed" | "longform";

const SYSTEM: Record<AiMode, string> = {
  write:
    "You are an expert social media copywriter for a brand publishing to Facebook, LinkedIn, Instagram, and similar networks. Write an engaging, substantive post with: a strong opening hook, a well-developed body that explains the value with concrete details and examples, and a clear call to action. Use short, scannable paragraphs, and include a tight bulleted list when it strengthens the post. Match a confident, helpful brand voice. Return ONLY the finished post text — no preamble, no surrounding quotes, no notes.",
  improve:
    "You are an expert social media editor. Improve the given copy: sharpen the hook, strengthen the structure and flow, add concrete detail, examples, and a clear call to action where they help, and preserve the author's intent and voice. Return ONLY the improved post text — no preamble or explanation.",
  shorten:
    "You tighten social media copy to be punchy and scannable without losing the core message. Return ONLY the shortened text.",
  hashtags:
    "You suggest relevant, non-spammy hashtags for a social post. Return ONLY a space-separated list of hashtags, nothing else.",
  ideas:
    "You are a social media strategist. Brainstorm distinct, non-overlapping post ideas for the brand. For EACH idea give a short punchy headline, then 2-3 sentences describing the angle, the hook, and why it would land. Separate ideas with a blank line. Return ONLY the ideas.",
};

// Length guidance appended to the prompt + the matching generation budget.
const LENGTH_GUIDE: Record<AiLength, string> = {
  standard:
    "Length: a focused post of about one short paragraph (roughly 40-80 words).",
  detailed:
    "Length: a well-developed post of 3-4 short paragraphs — hook, body with specifics, and a call to action (roughly 130-240 words). Add a short bulleted list if it strengthens the post.",
  longform:
    "Length: a comprehensive, in-depth post suited to LinkedIn — several paragraphs, specific examples, a bulleted list of concrete points, and a strong closing call to action (roughly 350-550 words).",
};

const IDEAS_COUNT: Record<AiLength, number> = { standard: 5, detailed: 8, longform: 12 };

// Token budget for generation. Without this, Ollama stops early and output is short.
const NUM_PREDICT: Record<AiLength, number> = { standard: 700, detailed: 1600, longform: 3200 };

/** A store solution to ground the post in (real product, real link). */
export interface SolutionContext {
  name: string;
  description: string;
  url: string;
}


/**
 * Pull the answer out of an Ollama chat reply. Reasoning models put their
 * deliberation in `message.thinking`; if the token budget went there and left
 * `content` empty, say so rather than returning silence.
 */
export function chatContent(
  data: { message?: { content?: string; thinking?: string }; done_reason?: string },
  where: string,
): string {
  const content = (data.message?.content ?? "").trim();
  if (content) return content;
  if (data.message?.thinking) {
    throw new Error(`${where}: the model spent its whole budget reasoning and returned no answer (done: ${data.done_reason ?? "?"}).`);
  }
  throw new Error(`${where}: the model returned an empty answer.`);
}

export async function aiAssist(
  mode: AiMode,
  input: string,
  length: AiLength = "detailed",
  solution?: SolutionContext | null
): Promise<string> {
  const usesLength = mode === "write" || mode === "improve" || mode === "ideas";

  let system = SYSTEM[mode];
  if (mode === "write" || mode === "improve") system += "\n\n" + LENGTH_GUIDE[length];
  if (mode === "ideas") system += `\n\nProduce ${IDEAS_COUNT[length]} ideas.`;
  // Hashtags are a #-list, not prose — the plain-text rule doesn't apply there.
  if (mode !== "hashtags") system += "\n\n" + PLAIN_TEXT_RULE;

  // Workplace-solution grounding: sell a REAL product with its REAL link.
  if (solution) {
    system +=
      "\n\nThis brand sells ready-made Microsoft / Modern Workplace solutions in the Phoenixtekk Workplace store. " +
      "Frame this post as a modern-workplace solution: (1) name the real-world problem or pain the reader feels, " +
      "(2) present the solution as the fix and explain the outcome it delivers, and (3) drive readers to the specific product below, " +
      "including its exact URL as the call to action near the end. " +
      "Reference ONLY the product provided here — do NOT invent product names, features, pricing, or links, and do not add any other URL.\n\n" +
      `SOLUTION TO REFERENCE:\nName: ${solution.name}\nWhat it does: ${solution.description}\nStore link: ${solution.url}`;
  }

  const numPredict =
    mode === "shorten" ? 500 : mode === "hashtags" ? 150 : NUM_PREDICT[length];

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      // Reasoning models (qwen3.x and friends) put chain-of-thought in
      // `message.thinking` and burn the token budget on it, leaving `content`
      // empty. We want the answer, not the deliberation.
      think: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
      options: {
        num_predict: numPredict, // hard cap on generated tokens (raises the ceiling)
        num_ctx: 8192, // allow a large context so long output isn't truncated
        temperature: 0.8, // a bit more expressive for richer copy
      },
    }),
    // Long-form on a 24B model can take a while; give it room.
    signal: AbortSignal.timeout(usesLength && length === "longform" ? 180_000 : 120_000),
  });

  if (!res.ok) {
    throw new Error(`AI box returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as { message?: { content?: string; thinking?: string }; done_reason?: string };
  const out = chatContent(data, "AI assist");
  // Hashtags stay verbatim (they legitimately contain #); everything else is
  // scrubbed of Markdown so no literal asterisks reach a post.
  return mode === "hashtags" ? out : sanitizeForSocial(out);
}

export interface ComposeOpts {
  seed: string;
  networkLabel: string;
  context?: string; // persistent per-network persona/brief
  limit?: number; // network char limit
  avoid?: string[]; // recent posts to NOT repeat
  nudge?: number; // 0 = first try; higher = stronger "make it different" + temperature
  solution?: SolutionContext | null; // optional grounded store product
}

/** Expand a short seed into a network-tailored post, avoiding recent repetition. */
export async function composeForNetwork(o: ComposeOpts): Promise<string> {
  const system = [
    `You are an expert social media copywriter writing specifically for: ${o.networkLabel}.`,
    o.context ? `Follow this channel's brand/context brief:\n${o.context}` : "",
    "Expand the user's short seed idea into a complete, engaging post tailored to this channel's audience and tone — a strong hook, a developed body with a concrete point, and a clear call to action.",
    o.limit && o.limit < 1200
      ? `HARD LIMIT: the finished post must be ${o.limit} characters or fewer, including spaces, links and emoji. Aim for about ${Math.floor(o.limit * 0.85)} so you do not run over. Say less rather than exceeding it.`
      : "Use short, scannable paragraphs.",
    o.avoid && o.avoid.length
      ? `IMPORTANT — make this DISTINCTLY DIFFERENT from these recent posts (fresh angle, hook, wording, and examples; do not restate them):\n${o.avoid.map((a, i) => `(${i + 1}) ${a.slice(0, 280)}`).join("\n")}`
      : "",
    o.nudge && o.nudge > 0
      ? "Your previous attempt was too similar to a recent post — take a noticeably different angle and restructure it."
      : "",
    o.solution
      ? `Frame this as a solution and reference ONLY this real product with its exact URL as the call to action:\nName: ${o.solution.name}\nWhat it does: ${o.solution.description}\nStore link: ${o.solution.url}`
      : "",
    PLAIN_TEXT_RULE,
    "Return ONLY the finished post text — no preamble, no surrounding quotes.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const temperature = Math.min(1.15, 0.85 + (o.nudge || 0) * 0.13);
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      // Reasoning models (qwen3.x and friends) put chain-of-thought in
      // `message.thinking` and burn the token budget on it, leaving `content`
      // empty. We want the answer, not the deliberation.
      think: false,
      options: { num_predict: 1400, num_ctx: 8192, temperature },
      messages: [
        { role: "system", content: system },
        { role: "user", content: o.seed },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`AI box returned HTTP ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  // Models overshoot a stated character count often enough that the prompt alone
  // cannot be trusted, so the limit is applied to the result as well.
  return trimToLimit(sanitizeForSocial((data.message?.content ?? "").trim()), o.limit);
}
