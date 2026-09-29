// WaltzDeck planner — turns a brief + the user's media into a storyboard (06_ClipWaltz_WaltzDeck_Feature_Spec.md).
// Two model calls against the self-hosted Ollama box:
//   1. describeMedia(): a vision model looks at 1–3 frames of each photo/video and says what's in it.
//   2. planStoryboard(): a text model writes the scene list as JSON (constrained by a JSON schema), which
//      is then validated and repaired here — the model never gets the last word on ids, timing or text rules.
// Pure functions: no DB, no storage. The caller (generation worker) loads inputs and saves the result.

const OLLAMA_URL = process.env.OLLAMA_URL || "http://192.168.166.182:11434";
// One model for both steps by default: the Ollama box is shared and evicts idle models, so a second
// model means a 15–60 s reload between describe and plan (measured 2026-09-29). qwen3-vl:30b (MoE) answers
// in ~4–9 s warm. It reasons before answering even with think:false (~500 chars), so budgets are generous.
export const VISION_MODEL = process.env.DECK_VISION_MODEL || "qwen3-vl:30b";
export const TEXT_MODEL = process.env.DECK_TEXT_MODEL || "qwen3-vl:30b";

export const MODES = ["ad", "slideshow"]; // phase 1 (presentation, explainer, recap: later phases)
export const LAYOUTS = ["headline-bottom", "headline-center", "lower-third", "bullets", "title-card", "cta-card"];
export const ROLES = ["hook", "problem", "benefit", "proof", "content", "title", "cta"];
const WORDS_PER_SEC = 3; // comfortable on-screen reading speed
const MIN_SCENE = 1.2;
const MAX_SCENE = 8;

// Streams the reply (NDJSON) and returns the same shape as a non-streamed call. Streaming matters: Node's
// fetch (undici) drops a request whose response headers take > 300 s, and a non-streamed Ollama call sends
// headers only when the whole answer is done — a slow plan on the busy shared box failed with "fetch failed"
// at exactly 5 min (2026-09-29). With streaming, headers arrive at once and `timeoutMs` is the only limit.
async function ollama(path, body, timeoutMs) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, stream: true }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`ollama ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const dec = new TextDecoder();
    let buf = "", content = "", response = "", thinking = "", last = {};
    const take = (line) => {
      if (!line.trim()) return;
      const j = JSON.parse(line);
      if (j.error) throw new Error(`ollama ${path}: ${j.error}`);
      if (j.message?.content) content += j.message.content;
      if (j.message?.thinking) thinking += j.message.thinking;
      if (j.response) response += j.response;
      if (j.done) last = j;
    };
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) { take(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
    }
    take(buf);
    return { ...last, message: { role: "assistant", content, thinking }, response };
  } finally {
    clearTimeout(to);
  }
}

/** First balanced {...} block in `text`, parsed. Throws if none parses. */
export function extractJson(text) {
  const t = String(text ?? "").replace(/```(?:json)?/gi, "");
  for (let start = t.indexOf("{"); start !== -1; start = t.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try { return JSON.parse(t.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  throw new Error("no JSON object in model reply");
}

/**
 * Chat call that returns parsed JSON. Deliberately NOT using Ollama's `format`: with qwen3-vl the reply
 * comes back empty whenever a format is set (the model stops after its reasoning — verified 2026-09-29),
 * so the prompt asks for JSON and the reply is extracted. One retry on unparseable output.
 */
// Timeouts are generous: the Ollama box is shared, and a plan took 4.8 min on prod while another project's model
// was loaded (2026-09-29) — 2-3x the dev timing.
async function chatJson(model, content, images, { temperature = 0.3, numPredict = 3000, numCtx, timeoutMs = 180000 } = {}) {
  const msg = { role: "user", content: `${content}

Reply with ONLY the JSON object — no markdown, no commentary.`, ...(images?.length ? { images } : {}) };
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const j = await ollama(
      "/api/chat",
      { model, messages: [msg], think: false, options: { temperature, num_predict: numPredict, ...(numCtx ? { num_ctx: numCtx } : {}) } },
      timeoutMs,
    );
    last = j;
    try {
      return { data: extractJson(j.message?.content), raw: j };
    } catch (e) {
      if (attempt === 1) throw new Error(`${e.message} (eval ${j.eval_count} tok, done: ${j.done_reason})`);
    }
  }
  return { data: {}, raw: last };
}

const str = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const words = (s) => (s ? s.split(/\s+/).filter(Boolean).length : 0);

// ── 1. Understand ────────────────────────────────────────────────────────────────────────────────

// Expected reply shape (documentation + for models where `format` works).
export const DESCRIBE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    subject: { type: "string" },
    setting: { type: "string" },
    mood: { type: "string" },
    people: { type: "integer" },
    textInImage: { type: "string" },
    goodFor: { type: "array", items: { type: "string", enum: ROLES } },
    quality: { type: "integer" },
  },
  required: ["summary", "subject", "setting", "mood", "people", "textInImage", "goodFor", "quality"],
};

/**
 * Describe one photo/video from base64 JPEG frames. `note` is the user's per-item prompt (context only).
 * Returns { summary, subject, setting, mood, people, textInImage, goodFor[], quality 1-5 }.
 */
export async function describeMedia(framesB64, { kind, note, durationSec } = {}) {
  const prompt =
    `You are helping plan a short marketing video. These ${framesB64.length} frame(s) come from one ` +
    `${kind === "video" ? `video clip (${durationSec ? `${Math.round(durationSec)} s` : "short"})` : "photo"}.` +
    (note ? ` The owner's note about it: "${note.slice(0, 300)}".` : "") +
    ` Describe what is actually visible. summary: one factual sentence. subject: the main subject in 2-5 words. ` +
    `setting: where, 2-5 words. mood: 1-3 words. people: how many people are visible (0 if none). ` +
    `textInImage: any readable text or logo in the frame, else "". goodFor: which scene roles this suits ` +
    `(hook = eye-catching opener, benefit/proof = shows the product or result, content = general, title/cta = calm background for text). ` +
    `quality: 1-5 for sharpness and lighting.
` +
    `JSON keys: {"summary":string,"subject":string,"setting":string,"mood":string,"people":integer,` +
    `"textInImage":string,"goodFor":[${ROLES.map((r) => `"${r}"`).join("|")}],"quality":integer}`;
  const { data: d } = await chatJson(VISION_MODEL, prompt, framesB64, { temperature: 0.2, numPredict: 3000 });
  return {
    summary: str(d.summary, 240),
    subject: str(d.subject, 60),
    setting: str(d.setting, 60),
    mood: str(d.mood, 40),
    people: Number.isFinite(d.people) ? Math.max(0, Math.min(50, Math.round(d.people))) : 0,
    textInImage: str(d.textInImage, 120),
    goodFor: Array.isArray(d.goodFor) ? d.goodFor.filter((r) => ROLES.includes(r)).slice(0, 4) : [],
    quality: Number.isFinite(d.quality) ? Math.max(1, Math.min(5, Math.round(d.quality))) : 3,
    model: VISION_MODEL,
  };
}

// ── 2. Plan ──────────────────────────────────────────────────────────────────────────────────────

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string", enum: ROLES },
          media: { type: "integer" }, // 1-based index into the media list, 0 = no media (text card)
          durationSec: { type: "number" },
          headline: { type: "string" },
          sub: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
          layout: { type: "string", enum: LAYOUTS },
          why: { type: "string" },
        },
        required: ["role", "media", "durationSec", "headline", "sub", "bullets", "layout", "why"],
      },
    },
  },
  required: ["title", "scenes"],
};

const MODE_GUIDE = {
  ad:
    "An AD. Structure: a 'hook' scene first (the most eye-catching media, a short punchy headline, max ~1.5-2.5 s), " +
    "then 'benefit'/'proof' scenes showing the product or result, then a final 'cta' scene (layout cta-card, media 0 " +
    "unless a calm background suits it) with the call to action. Headlines: max 6 words, concrete, no clichés. " +
    "Each benefit scene makes ONE point.",
  slideshow:
    "A SLIDESHOW / STORY. Tell it in a natural order (chronological when the media suggests a sequence). " +
    "Use 'title' for an optional opening card, 'content' for the rest. Text is a short caption per scene " +
    "(max 8 words) — warm and specific to what is shown. End with a closing scene; add a 'cta' card only if a " +
    "call to action is given.",
};

/**
 * Plan a storyboard. Input:
 *   brief: { mode, prompt, goal?, audience?, tone?, offer?, cta?: {text,url}, lengthSec, textMode: auto|manual|off }
 *   media: [{ id, kind, durationSec, note, desc }]   (desc from describeMedia; order = upload order)
 *   locked: [{ orderIndex, role, assetId, durationSec, text }]  scenes the planner must keep as-is
 * Returns { title, scenes: [{ role, assetId|null, durationSec, text:{headline,sub,bullets}, layout, why }] }
 * (already validated / repaired — see repairPlan).
 */
export async function planStoryboard(brief, media, locked = []) {
  const mode = MODES.includes(brief.mode) ? brief.mode : "ad";
  const length = Math.max(6, Math.min(180, Number(brief.lengthSec) || (mode === "ad" ? 15 : 45)));
  const list = media
    .map((m, i) => {
      const d = m.desc ?? {};
      return (
        `${i + 1}. ${m.kind}${m.kind === "video" && m.durationSec ? ` ${Math.round(m.durationSec)}s` : ""} — ${d.summary || "(no description)"}` +
        ` [subject: ${d.subject || "?"}; mood: ${d.mood || "?"}; people: ${d.people ?? "?"}; quality ${d.quality ?? "?"}/5` +
        `${d.goodFor?.length ? `; good for: ${d.goodFor.join(", ")}` : ""}${d.textInImage ? `; text in image: "${d.textInImage}"` : ""}]` +
        (m.note ? `\n   OWNER'S NOTE: "${m.note}"` : "")
      );
    })
    .join("\n");
  const textRule =
    brief.textMode === "off"
      ? "The owner wants NO on-screen text: leave headline, sub and bullets empty for every scene except the cta scene."
      : `On-screen text must be readable in the scene's time: at most ${WORDS_PER_SEC} words per second of scene duration in total (headline + sub + bullets).`;
  const lockedList = locked.length
    ? `\nThese scenes are LOCKED by the owner and will be kept exactly; plan the other scenes around them ` +
      `(do not repeat their text): ${locked.map((l) => `#${l.orderIndex + 1} ${l.role} "${l.text?.headline ?? ""}"`).join("; ")}.`
    : "";
  const prompt =
    `You are an expert video editor and copywriter. Plan a ${length}-second ${mode} video using ONLY the owner's media below.\n` +
    `${MODE_GUIDE[mode]}\n\n` +
    `BRIEF: "${str(brief.prompt, 1500)}"\n` +
    (brief.goal ? `Goal: ${str(brief.goal, 200)}\n` : "") +
    (brief.audience ? `Audience: ${str(brief.audience, 200)}\n` : "") +
    (brief.tone ? `Tone: ${str(brief.tone, 100)}\n` : "") +
    (brief.offer ? `Offer: ${str(brief.offer, 200)}\n` : "") +
    (brief.cta?.text ? `Call to action (use verbatim in the cta scene headline or sub): "${str(brief.cta.text, 120)}"\n` : "") +
    `\nMEDIA (refer to them by number):\n${list}\n${lockedList}\n` +
    `RULES:\n` +
    `- Use every media item that fits the brief; EVERY item with an owner's note must appear. Notes are instructions (placement, what to say) — follow them.\n` +
    `- Write every headline yourself from the brief — never copy words, brand names or signs visible in the media ("text in image" is context only).\n` +
    `- If a note asks for specific wording in quotes, use those exact words.\n` +
    `- Scene durations must add up to about ${length} seconds (each between ${MIN_SCENE} and ${MAX_SCENE} s; videos no longer than their length).\n` +
    `- ${textRule}\n` +
    `- Never invent facts, prices, awards or claims that are not in the brief or notes.\n` +
    `- layout: headline-bottom (default over media), headline-center (bold statement), lower-third (subtle caption), ` +
    `bullets (2-3 short bullet points), title-card (text on a plain brand background, media 0), cta-card (final call to action).\n` +
    `- why: one short sentence explaining the choice of media and text for that scene.\n` +
    `- title: a short internal name for this video.

` +
    `JSON shape: {"title":string,"scenes":[{"role":${ROLES.map((r) => `"${r}"`).join("|")},"media":integer (1-based, 0 = none),` +
    `"durationSec":number,"headline":string,"sub":string,"bullets":[string],"layout":${LAYOUTS.map((l) => `"${l}"`).join("|")},"why":string}]}`;
  const t0 = Date.now();
  const { data: raw, raw: j } = await chatJson(TEXT_MODEL, prompt, null, { temperature: 0.5, numPredict: 8000, numCtx: 16384, timeoutMs: 600000 });
  if (process.env.DECK_DEBUG === "1") console.log(`[deck] raw plan: ${JSON.stringify(raw).slice(0, 4000)}`);
  const plan = repairPlan(raw, { brief: { ...brief, mode, lengthSec: length }, media, locked });
  plan.stats = { model: TEXT_MODEL, ms: Date.now() - t0, promptTokens: j.prompt_eval_count, outTokens: j.eval_count };
  return plan;
}

/** Trim text to fit `maxWords`, dropping bullets first, then shortening sub, then the headline. */
function fitText(t, maxWords) {
  const out = { headline: t.headline, sub: t.sub, bullets: [...t.bullets] };
  const total = () => words(out.headline) + words(out.sub) + out.bullets.reduce((n, b) => n + words(b), 0);
  while (total() > maxWords && out.bullets.length) out.bullets.pop();
  if (total() > maxWords && out.sub) out.sub = "";
  if (total() > maxWords) out.headline = out.headline.split(/\s+/).slice(0, Math.max(2, maxWords)).join(" ");
  return out;
}

// Numbers the owner actually gave (brief, offer, CTA, notes). Generated text may only use these —
// a price, percentage, count or year the model saw on a sign is not a claim the owner made.
function allowedNumbers(brief, media) {
  const src = [brief.prompt, brief.goal, brief.audience, brief.offer, brief.cta?.text, ...media.map((m) => m.note)].join(" ");
  return new Set((src.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".")));
}
const numbersIn = (t) => (String(t ?? "").match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
const unverified = (t, ok) => numbersIn(t).some((n) => !ok.has(n));

// Placement words in an owner's note: "show this first", "open with", "end on this", "last".
const wantsFirst = (note) => /\b(first|open(?:ing)?|start|begin|lead)\b/i.test(note ?? "");
const wantsLast = (note) => /\b(last|end(?:ing)?|close|closing|finish|final)\b/i.test(note ?? "");

/**
 * Validate + repair a model plan: known media only, durations clamped and scaled to the target length,
 * text rules (textMode off / reading speed), a CTA end card for ads with a CTA, locked scenes restored.
 */
export function repairPlan(raw, { brief, media, locked = [] }) {
  const length = brief.lengthSec;
  const scenes = [];
  for (const s of Array.isArray(raw?.scenes) ? raw.scenes : []) {
    const idx = Number.isInteger(s.media) ? s.media : 0;
    const m = idx >= 1 && idx <= media.length ? media[idx - 1] : null;
    const role = ROLES.includes(s.role) ? s.role : "content";
    let layout = LAYOUTS.includes(s.layout) ? s.layout : m ? "headline-bottom" : "title-card";
    if (!m && !["title-card", "cta-card"].includes(layout)) layout = role === "cta" ? "cta-card" : "title-card";
    let dur = Math.max(MIN_SCENE, Math.min(MAX_SCENE, Number(s.durationSec) || 3));
    if (m?.kind === "video" && m.durationSec) dur = Math.min(dur, Math.max(MIN_SCENE, m.durationSec));
    scenes.push({
      role,
      assetId: m?.id ?? null,
      durationSec: dur,
      text: {
        headline: str(s.headline, 90),
        sub: str(s.sub, 140),
        bullets: (Array.isArray(s.bullets) ? s.bullets : []).map((b) => str(b, 60)).filter(Boolean).slice(0, 4),
      },
      layout,
      why: str(s.why, 200),
    });
  }
  if (!scenes.length) {
    // The model returned nothing usable: one scene per media item, in upload order, no text.
    for (const m of media) scenes.push({ role: "content", assetId: m.id, durationSec: 3, text: { headline: "", sub: "", bullets: [] }, layout: "headline-bottom", why: "Fallback: media in upload order." });
  }
  // Every item the owner wrote a note on appears (the model sometimes drops one — e.g. "end on this").
  const placed = new Set(scenes.map((sc) => sc.assetId).filter(Boolean));
  for (const m of media) {
    if (!m.note || placed.has(m.id)) continue;
    const dur = m.kind === "video" && m.durationSec ? Math.min(3, Math.max(MIN_SCENE, m.durationSec)) : 3;
    const at = scenes.length && scenes[scenes.length - 1].role === "cta" ? scenes.length - 1 : scenes.length;
    scenes.splice(at, 0, {
      role: "content", assetId: m.id, durationSec: dur, text: { headline: "", sub: "", bullets: [] },
      layout: "headline-bottom", why: `Added because you wrote a note on it: "${str(m.note, 80)}".`,
    });
    placed.add(m.id);
  }
  // Owner placement notes win over the model's order: "first" media leads, "last" media closes (before a CTA card).
  const noteOf = (sc) => (sc.assetId ? media.find((m) => m.id === sc.assetId)?.note : null);
  const firsts = scenes.filter((sc) => wantsFirst(noteOf(sc)) && !wantsLast(noteOf(sc)));
  const lasts = scenes.filter((sc) => wantsLast(noteOf(sc)) && !wantsFirst(noteOf(sc)));
  if (firsts.length || lasts.length) {
    const ctas = scenes.filter((sc) => sc.role === "cta" && !sc.assetId);
    const middle = scenes.filter((sc) => !firsts.includes(sc) && !lasts.includes(sc) && !ctas.includes(sc));
    scenes.splice(0, scenes.length, ...firsts, ...middle, ...lasts, ...ctas);
  }
  // No invented facts: drop any text line carrying a number the owner never gave.
  const okNums = allowedNumbers(brief, media);
  for (const sc of scenes) {
    const t = sc.text;
    let removed = false;
    if (unverified(t.headline, okNums)) { t.headline = ""; removed = true; }
    if (unverified(t.sub, okNums)) { t.sub = ""; removed = true; }
    const before = t.bullets.length;
    t.bullets = t.bullets.filter((b) => !unverified(b, okNums));
    if (removed || t.bullets.length !== before) sc.flags = [...(sc.flags ?? []), "removed-unverified-number"];
  }
  // Ads with a CTA always end on a CTA card carrying the owner's exact words — unless the owner locked one.
  const ctaText = str(brief.cta?.text, 120);
  const lockedCta = locked.some((l) => l.role === "cta");
  if (lockedCta) {
    for (let i = scenes.length - 1; i >= 0; i--) if (scenes[i].role === "cta" && !scenes[i].assetId) scenes.splice(i, 1);
  }
  if (brief.mode === "ad" && ctaText && !lockedCta) {
    let last = scenes[scenes.length - 1];
    if (!last || last.role !== "cta") {
      last = { role: "cta", assetId: null, durationSec: 2.5, text: { headline: "", sub: "", bullets: [] }, layout: "cta-card", why: "Ends on your call to action." };
      scenes.push(last);
    }
    const t = last.text;
    if (!`${t.headline} ${t.sub}`.toLowerCase().includes(ctaText.toLowerCase())) t.sub = ctaText;
    last.layout = "cta-card";
  }
  // Scale unlocked durations so the total lands on the target length (locked scenes keep theirs).
  const lockedDur = locked.reduce((n, l) => n + (Number(l.durationSec) || 0), 0);
  const sum = scenes.reduce((n, s) => n + s.durationSec, 0);
  const want = Math.max(MIN_SCENE * scenes.length, length - lockedDur);
  // Per-scene bounds: a hook needs ≥1.5 s to register, a CTA ≤3.5 s (with or without media — a prod plan put
  // 6.6 s on a CTA over a photo), a video never past its own length. Scale the scenes that still have room,
  // a few passes, so time taken from/added to clamped scenes goes to the others.
  const floorOf = (sc) => (sc.role === "hook" ? 1.5 : MIN_SCENE);
  const capOf = (sc) => {
    const m = sc.assetId ? media.find((x) => x.id === sc.assetId) : null;
    const base = sc.role === "cta" ? 3.5 : MAX_SCENE;
    return m?.kind === "video" && m.durationSec ? Math.max(Math.min(base, m.durationSec), Math.min(floorOf(sc), m.durationSec)) : base;
  };
  for (const sc of scenes) sc.durationSec = Math.max(Math.min(floorOf(sc), capOf(sc)), Math.min(capOf(sc), sc.durationSec));
  if (sum > 0) {
    for (let pass = 0; pass < 4; pass++) {
      const total = scenes.reduce((n, sc) => n + sc.durationSec, 0);
      const gap = want - total;
      if (Math.abs(gap) < 0.2) break;
      const room = scenes.filter((sc) => (gap > 0 ? sc.durationSec < capOf(sc) - 0.01 : sc.durationSec > floorOf(sc) + 0.01));
      const roomSum = room.reduce((n, sc) => n + sc.durationSec, 0);
      if (!room.length || roomSum <= 0) break;
      const k = (roomSum + gap) / roomSum;
      for (const sc of room) sc.durationSec = Math.max(floorOf(sc), Math.min(capOf(sc), sc.durationSec * k));
    }
  }
  for (const s of scenes) {
    s.durationSec = Math.round(s.durationSec * 10) / 10;
    if (brief.textMode === "off" && s.role !== "cta") s.text = { headline: "", sub: "", bullets: [] };
    else s.text = fitText(s.text, Math.max(3, Math.floor(s.durationSec * WORDS_PER_SEC) + 1));
    if (s.layout === "bullets" && s.text.bullets.length < 2) s.layout = s.assetId ? "headline-bottom" : "title-card";
  }
  return { title: str(raw?.title, 80) || "Untitled", scenes };
}

// ── 3. Rewrite one scene's text ──────────────────────────────────────────────────────────────────

/**
 * Rewrite the on-screen text of ONE scene. `instruction` is "rewrite" | "shorter" | "punchier" or the
 * owner's own words. Same guards as the planner (reading speed, no numbers the owner never gave).
 * Returns { headline, sub, bullets, flags? }.
 */
export async function rewriteScene(brief, scene, mediaItem, instruction, siblings = []) {
  const ask =
    instruction === "shorter" ? "Make it shorter and tighter."
    : instruction === "punchier" ? "Make it punchier and more energetic, still honest."
    : instruction === "rewrite" || !instruction ? "Write a fresh alternative."
    : `The owner asks: "${str(instruction, 300)}".`;
  const maxWords = Math.max(3, Math.floor((Number(scene.durationSec) || 3) * WORDS_PER_SEC) + 1);
  const d = mediaItem?.desc ?? {};
  const prompt =
    `You write on-screen text for one scene of a ${brief.mode === "slideshow" ? "slideshow" : "short ad"}.\n` +
    `BRIEF: "${str(brief.prompt, 1200)}"` + (brief.tone ? ` Tone: ${str(brief.tone, 100)}.` : "") +
    (brief.offer ? ` Offer: ${str(brief.offer, 200)}.` : "") + (brief.cta?.text ? ` CTA: "${str(brief.cta.text, 120)}".` : "") + "\n" +
    `SCENE ${scene.role}, ${scene.durationSec}s, layout ${scene.layout}. ` +
    (mediaItem ? `It shows: ${d.summary || "(no description)"}${mediaItem.note ? ` — owner's note: "${mediaItem.note}"` : ""}.` : "It is a text card with no media.") + "\n" +
    `Current text: headline "${scene.text?.headline ?? ""}", sub "${scene.text?.sub ?? ""}", bullets ${JSON.stringify(scene.text?.bullets ?? [])}.\n` +
    (siblings.length ? `Other scenes already say: ${siblings.map((t) => `"${t}"`).join(", ")} — don't repeat them.\n` : "") +
    `${ask}\nRules: at most ${maxWords} words in total; ${scene.layout === "bullets" ? "2-3 bullets" : "bullets only if the layout is bullets"}; ` +
    `never invent facts, prices, numbers or claims not in the brief or note.\n` +
    `JSON keys: {"headline":string,"sub":string,"bullets":[string]}`;
  const { data } = await chatJson(TEXT_MODEL, prompt, null, { temperature: 0.7, numPredict: 3000 });
  const media = mediaItem ? [mediaItem] : [];
  const repaired = repairPlan(
    { title: "x", scenes: [{ role: scene.role, media: mediaItem ? 1 : 0, durationSec: scene.durationSec, headline: data.headline, sub: data.sub, bullets: data.bullets, layout: scene.layout, why: "" }] },
    // textMode "auto": the owner asked for text on THIS scene, even if the project default is Off.
    { brief: { ...brief, mode: "slideshow", lengthSec: scene.durationSec, cta: null, textMode: "auto" }, media },
  ).scenes[0];
  return { ...repaired.text, ...(repaired.flags ? { flags: repaired.flags } : {}) };
}
