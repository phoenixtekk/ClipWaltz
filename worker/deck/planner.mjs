// WaltzDeck planner — turns a brief + the user's media into a storyboard (06_ClipWaltz_WaltzDeck_Feature_Spec.md).
// Two model calls against the self-hosted Ollama box:
//   1. describeMedia(): a vision model looks at 1–3 frames of each photo/video and says what's in it.
//   2. planStoryboard(): a text model writes the scene list as JSON (constrained by a JSON schema), which
//      is then validated and repaired here — the model never gets the last word on ids, timing or text rules.
// Pure functions: no DB, no storage. The caller (generation worker) loads inputs and saves the result.

import { MOTION_LAYOUTS, OVER_MEDIA_LAYOUTS } from "./motion.mjs";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://192.168.166.182:11434";
// One model for both steps by default: the Ollama box is shared and evicts idle models, so a second
// model means a 15–60 s reload between describe and plan (measured 2026-09-29). qwen3-vl:30b (MoE) answers
// in ~4–9 s warm. It reasons before answering even with think:false (~500 chars), so budgets are generous.
export const VISION_MODEL = process.env.DECK_VISION_MODEL || "qwen3-vl:30b";
export const TEXT_MODEL = process.env.DECK_TEXT_MODEL || "qwen3-vl:30b";

export const MODES = ["ad", "slideshow", "presentation", "explainer"];
export const LAYOUTS = ["headline-bottom", "headline-center", "lower-third", "bullets", "title-card", "cta-card", "slide", ...MOTION_LAYOUTS];
export const ROLES = ["hook", "problem", "benefit", "proof", "content", "title", "cta"];
const WORDS_PER_SEC = 3; // comfortable on-screen reading speed
const SPEECH_WPS = 2.8; // Kokoro at speed 1.0 (measured 2.7-3.3 words/s incl. pauses)
/** Seconds a narration line needs at `speed`, with a short breath after it. */
export const speechSec = (line, speed = 1) => (line ? words(line) / (SPEECH_WPS * (speed || 1)) + 0.4 : 0);
// Deck languages (phase 5; keep in sync with src/lib/deck/types.ts LANGUAGES).
export const LANG_NAMES = { en: "English", es: "Spanish", fr: "French", it: "Italian", pt: "Brazilian Portuguese" };
/** Prompt line making the model write in the deck's language ("" for English). */
const langRule = (brief) => {
  const name = LANG_NAMES[brief?.language];
  return name && brief.language !== "en"
    ? `LANGUAGE: write ALL on-screen text, bullets and voice lines in ${name} (natural, idiomatic — not word-for-word). Keep web addresses, codes, prices and brand names exactly as given.\n`
    : "";
};
const MIN_SCENE = 1.2;
const MAX_SCENE = 8;
// Slides are read, not glanced at: longer scenes and more / longer points than an ad.
const maxSceneOf = (mode) => (mode === "presentation" ? 15 : MAX_SCENE);
const bulletLimits = (mode) => (mode === "presentation" ? { n: 5, chars: 80 } : mode === "explainer" ? { n: 6, chars: 80 } : { n: 4, chars: 60 });
const isMg = (l) => MOTION_LAYOUTS.includes(l);
/** Animated layouts: how many bullets each uses (chat messages, channels, the end card's web address). */
const MG_BULLETS = { "mg-swarm": 3, "mg-chat": 5, "mg-fanout": 6, "mg-end": 1, "mg-steps": 4, "mg-features": 6, "mg-compare": 6, "mg-browser": 4 };

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
// Budgets: qwen3-vl reasons before it answers even with think:false — a 3,000-token budget ran out mid-thought on a scene
// rewrite (prod 2026-10-05: "no JSON object in model reply (eval 3000 tok, done: length)", 1 of 2 tries locally).
export async function chatJson(model, content, images, { temperature = 0.3, numPredict = 8000, numCtx, timeoutMs = 300000 } = {}) {
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
// Bump when the description shape changes so cached descriptions are redone (v2: per-moment captions).
export const DESCRIBE_VERSION = 2;

export async function describeMedia(framesB64, { kind, note, durationSec, times = [] } = {}) {
  const isVideo = kind === "video" && framesB64.length > 1;
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
    (isVideo ? `moments: for EACH frame in order, a caption of 4-10 words saying what that frame shows.\n` : "") +
    `JSON keys: {"summary":string,"subject":string,"setting":string,"mood":string,"people":integer,` +
    `"textInImage":string,"goodFor":[${ROLES.map((r) => `"${r}"`).join("|")}],"quality":integer${isVideo ? ',"moments":[string]' : ""}}`;
  const { data: d } = await chatJson(VISION_MODEL, prompt, framesB64, { temperature: 0.2, numPredict: 8000, timeoutMs: 300000 });
  return {
    summary: str(d.summary, 240),
    subject: str(d.subject, 60),
    setting: str(d.setting, 60),
    mood: str(d.mood, 40),
    people: Number.isFinite(d.people) ? Math.max(0, Math.min(50, Math.round(d.people))) : 0,
    textInImage: str(d.textInImage, 120),
    goodFor: Array.isArray(d.goodFor) ? d.goodFor.filter((r) => ROLES.includes(r)).slice(0, 4) : [],
    quality: Number.isFinite(d.quality) ? Math.max(1, Math.min(5, Math.round(d.quality))) : 3,
    // Per-frame captions with their time in the clip — lets a scene use the moment that matches its text/note.
    moments: isVideo && Array.isArray(d.moments)
      ? d.moments.slice(0, framesB64.length).map((c, i) => ({ t: Math.round((times[i] ?? 0) * 10) / 10, caption: str(c, 90) })).filter((m) => m.caption)
      : [],
    model: VISION_MODEL,
    v: DESCRIBE_VERSION,
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
          shot: { type: "string" }, // explainer: an AI video shot to generate for this scene (optional)
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
  presentation:
    "A PRESENTATION (slides someone can present or export to PowerPoint). Structure: a 'title' slide first " +
    "(layout slide or title-card: the topic as headline, a one-line sub), then 'content' slides that each make ONE " +
    "point — a short headline plus 2-4 bullets (max 8 words each) in layout 'slide' (media beside the text) or " +
    "'bullets'; use a photo/video on most slides when one fits. End with a closing slide (a summary or 'cta' card " +
    "if a call to action is given). Slides last 6-12 s — long enough to read.",
  explainer:
    "An ANIMATED EXPLAINER: a voiceover carries the story, animated scenes and a few real AI-filmed shots show it. " +
    "Follow the STORY ARC given below. Use the ANIMATED layouts (mg-*) for most scenes and pick, for each scene, the " +
    "layout whose PICTURE matches what that scene's voiceover says — vary them (at least 4 different layouts; never the " +
    "same layout twice in a row). On-screen text is short (a headline of max 6 words); the voiceover explains. Scenes " +
    "last 3.5-7 s. Write everything fresh for THIS product — never reuse wording from these instructions.",
};

/** The animated layouts as the planner sees them (worker/deck/motion.mjs). */
const MG_GUIDE =
  "ANIMATED layouts (media 0 unless noted) — pick by what the scene SAYS:\n" +
  "  mg-orbit — icons circling a device: many tools / apps / places at once; headline only.\n" +
  "  mg-swarm — things piling onto a device with a climbing counter: overload, noise, things slipping through; headline; bullets optional = 1-3 kinds of thing that pile up, drawn as icons (e.g. 'Laptops', 'iPhones', 'Emails', 'Invoices') — empty = numbered alert badges.\n" +
  "  mg-words — 2-5 big words appearing one by one: a key statement or question; headline = the words; sub optional. Can sit over a shot.\n" +
  "  mg-logo — the product name revealed; headline = the product/brand name, sub = a short tagline.\n" +
  "  mg-chat — a conversation on a phone: people messaging; headline = chat name; bullets = 3-5 messages as 'Name: what they say (Channel)', the sender's own as 'Me: …'. Can sit over a shot.\n" +
  "  mg-fanout — one thing reaching many destinations and back; headline; bullets = 2-6 short destination names.\n" +
  "  mg-steps — how it works in 2-4 numbered steps; headline; bullets = the steps (max 6 words each).\n" +
  "  mg-features — 3-6 feature cards with icons; headline; bullets = feature names (max 4 words each).\n" +
  "  mg-compare — before vs after; headline; bullets = 2-3 lines 'Before: …' and 2-3 lines 'After: …'.\n" +
  "  mg-browser — the product's website or app screen; headline = what the page says, sub = one line, bullets = 2-4 short items on it.\n" +
  "  mg-end — end card; headline = the name, sub = a tagline, bullets = [the web address or call to action]. Can sit over a shot.\n";

/** Story arcs for explainers — one is picked at random per plan so two explainers never share a structure. */
export const STORY_ARCS = [
  "PROBLEM → TURN → REVEAL → HOW → CLOSE: show the pain (1-2 scenes), a turning statement, reveal the product, how it helps (2-3 scenes), end card.",
  "QUESTION-LED: open with a question the viewer has, reveal the product as the answer, 3 numbered steps, one key benefit, end card.",
  "BEFORE / AFTER: life without the product, a direct before-vs-after comparison, what changes (features), reveal, end card.",
  "DAY IN THE LIFE: follow one person through a moment of their day (real shots), where the product steps in, what it does, end card.",
  "FEATURE TOUR: reveal the product first, then its 3-4 strongest capabilities each with its own picture, who it's for, end card.",
  "BOLD CLAIM-FREE PITCH: one striking opening statement, the product on screen (website/app screen), how simple it is (steps), end card.",
];

/** The numbered media list the model sees (descriptions, notes, moments). */
function mediaList(media) {
  return media
    .map((m, i) => {
      const d = m.desc ?? {};
      return (
        `${i + 1}. ${m.kind}${m.kind === "video" && m.durationSec ? ` ${Math.round(m.durationSec)}s` : ""} — ${d.summary || "(no description)"}` +
        ` [subject: ${d.subject || "?"}; mood: ${d.mood || "?"}; people: ${d.people ?? "?"}; quality ${d.quality ?? "?"}/5` +
        `${d.goodFor?.length ? `; good for: ${d.goodFor.join(", ")}` : ""}${d.textInImage ? `; text in image: "${d.textInImage}"` : ""}]` +
        (m.note ? `\n   OWNER'S NOTE: "${m.note}"` : "") +
        (d.moments?.length ? `\n   moments: ${d.moments.map((x, k) => `[${k + 1}] ${x.t}s ${x.caption}`).join("; ")}` : "")
      );
    })
    .join("\n");
}

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
  const list = mediaList(media);
  // A different story structure each time (owner, 2026-10-05: "never similar videos unless explicitly asked for").
  const arc = STORY_ARCS[Math.floor(Math.random() * STORY_ARCS.length)];
  const textRule =
    brief.textMode === "off"
      ? "The owner wants NO on-screen text: leave headline, sub and bullets empty for every scene except the cta scene."
      : `On-screen text must be readable in the scene's time: at most ${WORDS_PER_SEC} words per second of scene duration in total (headline + sub + bullets).`;
  const lockedList = locked.length
    ? `\nThese scenes are LOCKED by the owner and will be kept exactly; plan the other scenes around them ` +
      `(do not repeat their text): ${locked.map((l) => `#${l.orderIndex + 1} ${l.role} "${l.text?.headline ?? ""}"`).join("; ")}.`
    : "";
  const prompt =
    `You are an expert video editor and copywriter. Plan a ${length}-second ${mode} video using ONLY the owner's media below` +
    `${mode === "explainer" ? " (an explainer may use none — its animated scenes need no media)" : ""}.\n` +
    `${MODE_GUIDE[mode]}\n${mode === "explainer" ? `STORY ARC for this video: ${arc}\n` : ""}${langRule(brief)}\n` +
    `BRIEF: "${str(brief.prompt, 1500)}"\n` +
    (brief.goal ? `Goal: ${str(brief.goal, 200)}\n` : "") +
    (brief.audience ? `Audience: ${str(brief.audience, 200)}\n` : "") +
    (brief.tone ? `Tone: ${str(brief.tone, 100)}\n` : "") +
    (brief.offer ? `Offer: ${str(brief.offer, 200)}\n` : "") +
    (brief.cta?.text ? `Call to action (use verbatim in the cta scene headline or sub): "${str(brief.cta.text, 120)}"\n` : "") +
    `\nMEDIA (refer to them by number):\n${list || "(none)"}\n${lockedList}\n` +
    `RULES:\n` +
    `- Use every media item that fits the brief; EVERY item with an owner's note must appear. Notes are instructions (placement, what to say) — follow them.\n` +
    `- Write every headline yourself from the brief — never copy words, brand names or signs visible in the media ("text in image" is context only).\n` +
    `- If a note asks for specific wording in quotes, use those exact words.\n` +
    `- Scene durations must add up to about ${length} seconds (each between ${MIN_SCENE} and ${maxSceneOf(mode)} s; videos no longer than their length).\n` +
    `- ${textRule}\n` +
    `- Never invent facts, prices, awards or claims that are not in the brief or notes — no "limited time", "best", "#1", "free", "guaranteed", "certified", ratings or reviews unless the brief says so.\n` +
    `- For a video with moments, set "moment" to the number of the moment that best matches that scene's text or the owner's note (0 = let the editor choose).\n` +
    `- layout: headline-bottom (default over media), headline-center (bold statement), lower-third (subtle caption), ` +
    `bullets (2-3 short bullet points), title-card (text on a plain brand background, media 0), cta-card (final call to action)` +
    `${mode === "presentation" ? ", slide (presentation slide: headline + 2-4 bullets on a brand panel beside the media, or on its own with media 0)" : ""}.\n` +
    (mode === "explainer"
      ? MG_GUIDE +
        `- shot: give 2-3 scenes a real filmed shot: write "shot" = one sentence describing a REAL scene the AI video model can film ` +
        `for THIS product's world (specific people, places and objects; bright light, cinematic camera; no text, logos, screens ` +
        `with words or abstract ideas) and give that scene layout mg-words, mg-chat or mg-end so the words sit over the shot. ` +
        `Leave "shot" empty everywhere else.\n`
      : "") +
    `- why: one short sentence explaining the choice of media and text for that scene.\n` +
    (brief.voice?.mode === "auto"
      ? `- voice: a spoken narration line for EVERY scene (a voiceover, read at ~${SPEECH_WPS} words per second): conversational, ` +
        `complements the on-screen text instead of repeating it word for word, and fits the scene (a 3 s scene ≈ 7 words). ` +
        `The cta scene's voice says the call to action. Write web addresses as spoken ("example dot com"). Same rule: no invented facts or claims.\n`
      : "") +
    `- title: a short internal name for this video.

` +
    `JSON shape: {"title":string,"scenes":[{"role":${ROLES.map((r) => `"${r}"`).join("|")},"media":integer (1-based, 0 = none),` +
    `"durationSec":number,"moment":integer,${brief.voice?.mode === "auto" ? '"voice":string,' : ""}"headline":string,"sub":string,"bullets":[string],"layout":${LAYOUTS.filter((l) => mode === "explainer" || !isMg(l)).map((l) => `"${l}"`).join("|")},${mode === "explainer" ? '"shot":string,' : ""}"why":string}]}`;
  const t0 = Date.now();
  let { data: raw, raw: j } = await chatJson(TEXT_MODEL, prompt, null, { temperature: 0.5, numPredict: 8000, numCtx: 16384, timeoutMs: 600000 });
  if (process.env.DECK_DEBUG === "1") console.log(`[deck] raw plan: ${JSON.stringify(raw).slice(0, 4000)}`);
  // No scenes at all (seen once on an explainer, 2026-10-05: the model returned nothing usable): one more try.
  if (!Array.isArray(raw?.scenes) || !raw.scenes.length) {
    console.warn("[deck] plan came back without scenes — retrying once");
    ({ data: raw, raw: j } = await chatJson(TEXT_MODEL, prompt, null, { temperature: 0.6, numPredict: 8000, numCtx: 16384, timeoutMs: 600000 }));
  }
  // Animated layouts are offered to explainers only (the JSON schema enum lists them all): elsewhere a model pick
  // falls back to the usual defaults — an mg-orbit with the owner's photo would never show the photo.
  if (mode !== "explainer") for (const s of Array.isArray(raw?.scenes) ? raw.scenes : []) if (isMg(s?.layout)) s.layout = "";
  let plan = repairPlan(raw, { brief: { ...brief, mode, lengthSec: length }, media, locked });
  // Narration that just repeats the on-screen text is dull (prod plan 2026-09-29: 6/6 lines == headline).
  // When most lines duplicate their text, one focused call writes the narration alone, then re-repair.
  if (brief.voice?.mode === "auto" && plan.scenes.length) {
    const dup = plan.scenes.filter((sc) => !sc.voice || sameWords(sc.voice, `${sc.text.headline} ${sc.text.sub}`)).length;
    if (dup / plan.scenes.length > 0.5) {
      const lines = await writeNarration({ ...brief, mode, lengthSec: length }, plan.scenes, media).catch(() => null);
      if (lines) {
        const raw2 = { title: plan.title, scenes: plan.scenes.map((sc, i) => ({
          role: sc.role, media: sc.assetId ? media.findIndex((m) => m.id === sc.assetId) + 1 : 0, durationSec: sc.durationSec,
          headline: sc.text.headline, sub: sc.text.sub, bullets: sc.text.bullets, layout: sc.layout, why: sc.why,
          voice: lines[i] ?? sc.voice, moment: 0,
        })) };
        const inSecs = plan.scenes.map((sc) => sc.inSec);
        plan = repairPlan(raw2, { brief: { ...brief, mode, lengthSec: length }, media, locked });
        plan.scenes.forEach((sc, i) => { if (inSecs[i] != null) sc.inSec = inSecs[i]; });
      }
    }
  }
  // Explainers get real footage: the model often suggests no shot (0 in 3 runs, 2026-10-05) — one focused call fills
  // the gap so every explainer has at least two.
  if (mode === "explainer") await ensureShots({ ...brief, mode }, plan.scenes).catch((e) => console.warn(`[deck] shots: ${e.message}`));
  plan.stats = { model: TEXT_MODEL, ms: Date.now() - t0, promptTokens: j.prompt_eval_count, outTokens: j.eval_count };
  return plan;
}

/**
 * Make sure an explainer has at least `want` suggested AI shots (scene.shot): pick text scenes without media where a
 * real shot fits (layouts that sit over media first), ask the model to describe one filmable shot each, and move a
 * scene onto big words if its layout can't show media. Mutates `scenes`.
 */
export async function ensureShots(brief, scenes, want = 2) {
  if (scenes.length < 3) return;
  // The closing scene always gets a filmed shot (owner, 2026-10-05) — unless it already shows media or has one.
  const lastIdx = scenes.length - 1, last = scenes[lastIdx];
  const closing = !last.assetId && !last.shot ? [{ s: last, i: lastIdx }] : [];
  const have = scenes.filter((s) => s.shot).length + closing.length;
  const free = scenes.map((s, i) => ({ s, i })).filter(({ s, i }) => i !== lastIdx && !s.assetId && !s.shot && s.layout !== "mg-logo");
  const over = free.filter(({ s }) => OVER_MEDIA_LAYOUTS.includes(s.layout));
  const other = free.filter(({ s }) => !OVER_MEDIA_LAYOUTS.includes(s.layout) && s.text.headline && !["mg-steps", "mg-features", "mg-compare", "mg-browser", "mg-fanout"].includes(s.layout));
  const picks = [...closing, ...[...over, ...other].slice(0, Math.max(0, want - have))];
  if (!picks.length) return;
  const list = picks.map(({ s, i }, k) => `${k + 1}. scene ${i + 1} (${s.role}) — on screen: "${[s.text.headline, s.text.sub].filter(Boolean).join(" — ")}"; voiceover: "${s.voice || ""}"`).join("\n");
  const prompt =
    `You direct the real filmed shots of a short explainer video. ${langRule(brief)}BRIEF: "${str(brief.prompt, 1000)}"\n` +
    `For each scene below, describe ONE real cinematic shot an AI video model can film that fits what the scene says ` +
    `(a specific person, place or object from this product's world; natural action; bright light; cinematic camera move). ` +
    `No text, logos, readable screens, brand names or abstract ideas. One sentence each, max 35 words.\n${list}\n` +
    `JSON keys: {"shots":[string]}`;
  // One retry when the reply is short (the closing scene must get its shot).
  let shots = [];
  for (let attempt = 0; attempt < 2 && shots.length < picks.length; attempt++) {
    const { data } = await chatJson(TEXT_MODEL, prompt, null, { temperature: 0.9, numPredict: 8000, timeoutMs: 300000 });
    const got = Array.isArray(data?.shots) ? data.shots.map((x) => str(x, 400)).filter(Boolean) : [];
    if (got.length > shots.length) shots = got;
  }
  picks.forEach(({ s }, k) => {
    if (!shots[k]) return;
    s.shot = shots[k];
    // The shot must be visible: a layout that draws its own picture becomes one that sits over the footage — the
    // closing scene (or a name reveal) becomes the end card, anything else big words.
    if (!OVER_MEDIA_LAYOUTS.includes(s.layout)) {
      const toEnd = s === last && (s.role === "cta" || s.layout === "mg-logo" || s.role === "title");
      s.layout = toEnd ? "mg-end" : "mg-words";
      s.text = { headline: s.text.headline, sub: s.text.sub, bullets: [] };
    }
    s.why = `${s.why} Suggested AI shot ready — open "Generate a shot" on this scene.`.trim();
  });
}

/** Trim text to fit `maxWords`, dropping bullets first, then shortening sub, then the headline. */
export function fitText(t, maxWords) {
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

// Claim classes → words that must appear in the owner's own text for the claim to stand. Offer words (deal,
// sale, discount, promo) are fine whenever the brief has an offer.
const CLAIM_RULES = [
  { re: /\b(limited[- ]time|today only|while (supplies|stocks?) lasts?|ends (soon|today|tonight)|last chance|hurry|don'?t miss)\b/i, keys: ["limited", "today", "supplies", "stock", "ends", "last chance", "hurry", "miss"] },
  { re: /\b(guarantee[ds]?|money[- ]back|risk[- ]free|no risk)\b/i, keys: ["guarantee", "money-back", "money back", "risk"] },
  { re: /(\b(award(s|-winning)?|number one|no\.?\s?1|(best|top)[- ]rated|best|world[- ]class|leading|premier)\b|(^|[^\w])#\s?1\b)/i, keys: ["award", "#1", "number one", "best", "top", "leading", "world-class", "premier"] },
  { re: /\bfree\b/i, keys: ["free"] },
  { re: /\b(cheapest|lowest prices?|best prices?|bargain|unbeatable)\b/i, keys: ["cheap", "lowest", "best price", "bargain", "unbeatable"] },
  { re: /\b(certified|licensed|accredited|official|approved|authori[sz]ed|organic|all[- ]natural|eco[- ]friendly|sustainable|vegan|gluten[- ]free|non[- ]gmo)\b/i, keys: ["certified", "licensed", "accredited", "official", "approved", "authori", "organic", "natural", "eco", "sustainable", "vegan", "gluten", "gmo"] },
  { re: /\b(trusted by|loved by|thousands of|millions of|five[- ]star|5[- ]star|\d(\.\d)?[- ]stars?|rated|reviews?|customers love)\b/i, keys: ["trusted", "loved", "thousand", "million", "star", "rated", "review"] },
  { re: /\b(exclusive|the only)\b/i, keys: ["exclusive", "only"] },
  { re: /\b(clinically|scientifically|proven|doctor[- ]recommended|dermatologist)\b/i, keys: ["clinical", "scientific", "proven", "doctor", "dermatologist"] },
  { re: /\b(deals?|sale|discounts?|promo(tion)?s?|special offer)\b/i, keys: ["deal", "sale", "discount", "promo", "offer"], offerOk: true },
];
const DOT_STOP = new Set(["more", "no", "a", "the", "any", "one", "every", "of", "and", "or", "to", "our", "your", "this", "that", "old", "new", "big", "early"]);
export function unverifiedClaim(line, srcLower, hasOffer) {
  // Web addresses (written or spoken: "example dot com") the owner never gave are invented — an explainer plan put a
  // made-up "txtya.com" on its end card and in the voiceover (2026-10-05).
  // "example dot com" is an address; "no more dot com clutter" isn't (a common word before "dot").
  const low = String(line).toLowerCase().replace(/\b([a-z0-9-]+) dot (com|net|org|io|co|app|ai)\b/g,
    (m, w, tld) => (DOT_STOP.has(w) ? m : `${w}.${tld}`));
  const doms = low.match(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|ai|dev|us|uk|ca|au|de|fr|es|it|shop|store|biz|info|me|tv)\b/g) ?? [];
  if (doms.some((d) => !srcLower.includes(d.replace(/^www\./, "")))) return true;
  for (const r of CLAIM_RULES) {
    if (!r.re.test(line)) continue;
    if (r.offerOk && hasOffer) continue;
    // Keys match at the start of a word ("eco" must not match inside "second" — verified false keep).
    if (!r.keys.some((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\#-]/g, "\\$&")}`).test(srcLower))) return true;
  }
  return false;
}

// Moment whose caption shares the most words with `text` (null when nothing overlaps).
const STOP = new Set(["the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "with", "is", "are", "this", "that", "your", "our", "it", "by", "from"]);
function bestMoment(moments, text) {
  const want = new Set(String(text).toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !STOP.has(w)) ?? []);
  if (!want.size) return null;
  let best = null, score = 0;
  for (const m of moments) {
    const s = (m.caption.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => want.has(w) || [...want].some((x) => x.length > 4 && w.startsWith(x.slice(0, 5)))).length;
    if (s > score) { score = s; best = m.t; }
  }
  return best;
}

// True when two lines say the same words (order/case/punctuation ignored, ≥80 % overlap).
function sameWords(a, b) {
  const wa = String(a).toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const wb = new Set(String(b).toLowerCase().match(/[a-z0-9]+/g) ?? []);
  if (!wa.length) return true;
  return wa.filter((w) => wb.has(w)).length / wa.length >= 0.8;
}

/** One call that writes only the spoken narration for already-planned scenes. Returns string[] or null. */
async function writeNarration(brief, scenes, media) {
  const list = scenes.map((sc, i) => {
    const m = sc.assetId ? media.find((x) => x.id === sc.assetId) : null;
    return `${i + 1}. ${sc.role}, ${sc.durationSec}s — shows: ${m?.desc?.summary || (m ? "the owner's media" : "a text card")}; on-screen text: "${[sc.text.headline, sc.text.sub].filter(Boolean).join(" — ")}"`;
  }).join("\n");
  const prompt =
    `Write the VOICEOVER for a ${brief.mode === "slideshow" ? "slideshow" : brief.mode === "explainer" ? "short animated explainer" : "short ad"}. ${langRule(brief)}BRIEF: "${str(brief.prompt, 1200)}"` +
    (brief.tone ? ` Tone: ${str(brief.tone, 100)}.` : "") + (brief.offer ? ` Offer: ${str(brief.offer, 200)}.` : "") +
    (brief.cta?.text ? ` Call to action: "${str(brief.cta.text, 120)}".` : "") + `\nSCENES:\n${list}\n` +
    `One spoken line per scene, in order. Each line: conversational, 5-14 words, fits the scene length at ~${SPEECH_WPS} words per second, ` +
    `and ADDS something the on-screen text doesn't say (never repeat the on-screen text). Flow from line to line like one script. ` +
    `The last line says the call to action; write web addresses as spoken ("example dot com"). ` +
    `Never invent facts, prices, numbers or claims not in the brief.\nJSON keys: {"lines":[string]}`;
  const { data } = await chatJson(TEXT_MODEL, prompt, null, { temperature: 0.7, numPredict: 8000, timeoutMs: 300000 });
  const lines = Array.isArray(data.lines) ? data.lines.map((l) => str(l, 300)) : null;
  return lines && lines.length >= Math.ceil(scenes.length / 2) ? lines : null;
}

// Placement words in an owner's note: "show this first", "open with", "end on this", "last".
const wantsFirst = (note) => /\b(first|open(?:ing)?|start|begin|lead)\b/i.test(note ?? "");
const wantsLast = (note) => /\b(last|end(?:ing)?|close|closing|finish|final)\b/i.test(note ?? "");

/**
 * Validate + repair a model plan: known media only, durations clamped and scaled to the target length,
 * text rules (textMode off / reading speed), a CTA end card for ads with a CTA, locked scenes restored.
 */
export function repairPlan(raw, { brief, media, locked = [], single = false }) {
  const length = brief.lengthSec;
  const MAXS = maxSceneOf(brief.mode);
  const BL = bulletLimits(brief.mode);
  const scenes = [];
  for (const s of Array.isArray(raw?.scenes) ? raw.scenes : []) {
    const idx = Number.isInteger(s.media) ? s.media : 0;
    const m = idx >= 1 && idx <= media.length ? media[idx - 1] : null;
    const role = ROLES.includes(s.role) ? s.role : "content";
    let layout = LAYOUTS.includes(s.layout) ? s.layout : m ? "headline-bottom" : brief.mode === "explainer" ? "mg-words" : "title-card";
    if (!m && !isMg(layout) && !["title-card", "cta-card", "slide"].includes(layout)) {
      layout = role === "cta" ? (brief.mode === "explainer" ? "mg-end" : "cta-card") : brief.mode === "presentation" ? "slide" : brief.mode === "explainer" ? "mg-words" : "title-card";
    }
    // A suggested AI shot (explainer) goes behind an over-media layout once it's generated.
    const shot = brief.mode === "explainer" && !m ? str(s.shot, 400) : "";
    if (shot && !OVER_MEDIA_LAYOUTS.includes(layout)) layout = role === "cta" ? "mg-end" : "mg-words";
    let dur = Math.max(MIN_SCENE, Math.min(MAXS, Number(s.durationSec) || 3));
    if (m?.kind === "video" && m.durationSec) dur = Math.min(dur, Math.max(MIN_SCENE, m.durationSec));
    const moments = m?.desc?.moments ?? [];
    const mi = Number.isInteger(s.moment) && s.moment >= 1 && s.moment <= moments.length ? s.moment - 1 : -1;
    scenes.push({
      role,
      assetId: m?.id ?? null,
      momentT: mi >= 0 ? moments[mi].t : null,
      voice: brief.voice?.mode === "auto" ? str(s.voice, 300) : "",
      durationSec: dur,
      text: {
        headline: str(s.headline, 90),
        sub: str(s.sub, 140),
        bullets: (Array.isArray(s.bullets) ? s.bullets : []).map((b) => str(b, BL.chars)).filter(Boolean).slice(0, BL.n),
      },
      layout,
      shot,
      why: str(s.why, 200),
    });
  }
  // At most 3 suggested shots (each is ~10 min of GPU time).
  scenes.filter((sc) => sc.shot).slice(3).forEach((sc) => { sc.shot = ""; });
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
    if (sc.voice && unverified(sc.voice, okNums)) { sc.voice = ""; removed = true; }
    if (removed || t.bullets.length !== before) sc.flags = [...(sc.flags ?? []), "removed-unverified-number"];
  }
  // No invented claims beyond numbers: a line making one of these claims is kept only when the owner's own
  // words (brief, offer, CTA, notes) contain the claim. Verified need: "Limited time offer" slipped into a prod ad.
  const srcText = [brief.prompt, brief.goal, brief.audience, brief.tone, brief.offer, brief.cta?.text, brief.cta?.url, ...media.map((m) => m.note)].join(" ").toLowerCase();
  for (const sc of scenes) {
    const t = sc.text;
    const bad = (line) => !!line && unverifiedClaim(line, srcText, !!str(brief.offer, 200));
    let removed = false;
    if (bad(t.headline)) { t.headline = ""; removed = true; }
    if (bad(t.sub)) { t.sub = ""; removed = true; }
    if (sc.voice && bad(sc.voice)) { sc.voice = ""; removed = true; }
    const n = t.bullets.length;
    t.bullets = t.bullets.filter((b) => !bad(b));
    if (removed || t.bullets.length !== n) sc.flags = [...(sc.flags ?? []), "removed-unverified-claim"];
  }
  // Ads with a CTA always end on a CTA card carrying the owner's exact words — unless the owner locked one.
  const ctaText = str(brief.cta?.text, 120);
  const lockedCta = locked.some((l) => l.role === "cta");
  if (lockedCta) {
    for (let i = scenes.length - 1; i >= 0; i--) if (scenes[i].role === "cta" && !scenes[i].assetId) scenes.splice(i, 1);
  }
  // Explainers end on the animated end card carrying the call to action (its web address when there is one).
  if (brief.mode === "explainer" && ctaText && !lockedCta && !single) {
    let last = scenes[scenes.length - 1];
    if (!last || last.role !== "cta") {
      last = { role: "cta", assetId: null, durationSec: 4, text: { headline: "", sub: "", bullets: [] }, layout: "mg-end", shot: "", why: "Ends on your call to action." };
      scenes.push(last);
    }
    last.layout = "mg-end";
    const url = str(brief.cta?.url, 80);
    last.text.bullets = [url || ctaText];
    // The owner's CTA words are on screen: in the pill (no web address) or else the tagline.
    const t = last.text;
    if (url && !`${t.headline} ${t.sub}`.toLowerCase().includes(ctaText.toLowerCase())) t.sub = ctaText;
  }
  if (brief.mode === "ad" && ctaText && !lockedCta && !single) {
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
  const floorOf = (sc) => Math.max(sc.role === "hook" ? 1.5 : MIN_SCENE, Math.min(MAXS, speechSec(sc.voice, brief.voice?.speed)));
  const capOf = (sc) => {
    const m = sc.assetId ? media.find((x) => x.id === sc.assetId) : null;
    // The CTA cap yields to its narration (a spoken CTA must fit).
    const base = sc.role === "cta" ? Math.max(3.5, Math.min(MAXS, speechSec(sc.voice, brief.voice?.speed))) : MAXS;
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
    // Video window centred on the chosen moment (model pick, else the moment whose caption best matches the
    // scene text + the owner's note); null = the render worker picks the most active stretch.
    const m = s.assetId ? media.find((x) => x.id === s.assetId) : null;
    const moments = m?.desc?.moments ?? [];
    let t = s.momentT;
    if (t == null && moments.length) t = bestMoment(moments, `${s.text.headline} ${s.text.sub} ${m.note ?? ""}`);
    s.inSec = t == null || !m?.durationSec ? null : Math.round(Math.max(0, Math.min(m.durationSec - s.durationSec, t - s.durationSec / 2)) * 10) / 10;
    delete s.momentT;
    if (brief.textMode === "off" && s.role !== "cta") s.text = { headline: "", sub: "", bullets: [] };
    else if (isMg(s.layout)) {
      // Animated layouts: the bullets are part of the picture (chat messages, channels, the end card's address), not
      // reading load — keep them to what the layout uses; the headline stays short.
      s.text = { headline: s.text.headline.split(/\s+/).slice(0, s.layout === "mg-words" ? 8 : 10).join(" "), sub: s.text.sub, bullets: s.text.bullets.slice(0, MG_BULLETS[s.layout] ?? 0) };
    } else s.text = fitText(s.text, Math.max(3, Math.floor(s.durationSec * WORDS_PER_SEC) + 1));
    if (s.shot) s.why = `${s.why} Suggested AI shot ready — open "Generate a shot" on this scene.`.trim();
    if (s.layout === "bullets" && s.text.bullets.length < 2) s.layout = s.assetId ? "headline-bottom" : "title-card";
    // A chat needs a conversation: with fewer than two messages it becomes big words.
    if (s.layout === "mg-chat" && s.text.bullets.length < 2) s.layout = "mg-words";
    // List layouts need their list: with fewer than two items (the model put the steps in the voiceover, 2026-10-05) they
    // become big words — never placeholder items on screen.
    if (["mg-steps", "mg-features", "mg-compare", "mg-fanout"].includes(s.layout) && s.text.bullets.length < 2) { s.layout = "mg-words"; s.text.bullets = []; }
    // An explainer stays animated: plain text cards become their animated equivalents.
    if (brief.mode === "explainer" && !s.assetId && ["title-card", "cta-card", "slide", "headline-center"].includes(s.layout)) {
      s.layout = s.role === "cta" ? "mg-end" : s.role === "title" ? "mg-logo" : "mg-words";
    }
    // A presentation point with bullets but a layout that can't show them becomes a slide.
    if (brief.mode === "presentation" && s.text.bullets.length >= 2 && !["bullets", "slide"].includes(s.layout) && s.role !== "cta") s.layout = "slide";
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
    : `The owner asks: "${str(instruction, 600)}".`;
  const maxWords = Math.max(3, Math.floor((Number(scene.durationSec) || 3) * WORDS_PER_SEC) + 1);
  const d = mediaItem?.desc ?? {};
  const prompt =
    `You write on-screen text for one scene of a ${brief.mode === "slideshow" ? "slideshow" : brief.mode === "presentation" ? "presentation (one slide)" : "short ad"}.\n` +
    langRule(brief) +
    `BRIEF: "${str(brief.prompt, 1200)}"` + (brief.tone ? ` Tone: ${str(brief.tone, 100)}.` : "") +
    (brief.offer ? ` Offer: ${str(brief.offer, 200)}.` : "") + (brief.cta?.text ? ` CTA: "${str(brief.cta.text, 120)}".` : "") + "\n" +
    `SCENE ${scene.role}, ${scene.durationSec}s, layout ${scene.layout}. ` +
    (mediaItem ? `It shows: ${d.summary || "(no description)"}${mediaItem.note ? ` — owner's note: "${mediaItem.note}"` : ""}.` : "It is a text card with no media.") + "\n" +
    `Current text: headline "${scene.text?.headline ?? ""}", sub "${scene.text?.sub ?? ""}", bullets ${JSON.stringify(scene.text?.bullets ?? [])}.\n` +
    (siblings.length ? `Other scenes already say: ${siblings.map((t) => `"${t}"`).join(", ")} — don't repeat them.\n` : "") +
    (isMg(scene.layout) ? `This is an ANIMATED scene: ${MG_GUIDE.split("\n").find((l) => l.trim().startsWith(scene.layout)) ?? scene.layout}\n` : "") +
    `${ask}\nRules: ${isMg(scene.layout)
      ? `headline at most ${scene.layout === "mg-words" ? 5 : 6} words; ${MG_BULLETS[scene.layout] ? `bullets as the layout describes (keep their meaning and format)` : "no bullets"}`
      : `at most ${maxWords} words in total; ${scene.layout === "bullets" || scene.layout === "slide" ? "2-4 bullets" : "bullets only if the layout is bullets or slide"}`}; ` +
    `never invent facts, prices, numbers or claims not in the brief or note (no "limited time", "best", "free", "guaranteed", ratings…).\n` +
    (brief.voice?.mode === "auto" ? `Also write "voice": the spoken narration for this scene (≈${Math.max(3, Math.round((Number(scene.durationSec) || 3) * SPEECH_WPS))} words, complements the text).\n` : "") +
    `JSON keys: {"headline":string,"sub":string,"bullets":[string]${brief.voice?.mode === "auto" ? ',"voice":string' : ""}}`;
  const { data } = await chatJson(TEXT_MODEL, prompt, null, { temperature: 0.7, numPredict: 8000, timeoutMs: 300000 });
  const media = mediaItem ? [mediaItem] : [];
  const repaired = repairPlan(
    { title: "x", scenes: [{ role: scene.role, media: mediaItem ? 1 : 0, durationSec: scene.durationSec, headline: data.headline, sub: data.sub, bullets: data.bullets, voice: data.voice, layout: scene.layout, why: "" }] },
    // textMode "auto": the owner asked for text on THIS scene, even if the project default is Off.
    // `single`: one scene being rewritten — no end card is added; the CTA stays in the owner's words (web-address guard).
    { brief: { ...brief, mode: ["presentation", "explainer"].includes(brief.mode) ? brief.mode : "slideshow", lengthSec: scene.durationSec, textMode: "auto" }, media, single: true },
  ).scenes[0];
  // An animated scene's lines are part of its picture (chat, channels, the end card's address): a reply without them
  // keeps the current ones.
  if (MG_BULLETS[scene.layout] && !repaired.text.bullets.length) repaired.text.bullets = (scene.text?.bullets ?? []).slice(0, MG_BULLETS[scene.layout]);
  return { ...repaired.text, ...(brief.voice?.mode === "auto" ? { voice: repaired.voice } : {}), ...(repaired.flags ? { flags: repaired.flags } : {}) };
}

// ── 4. Campaign hooks + CTAs (phase 4) ───────────────────────────────────────────────────────────

const HOOK_ANGLES = ["a question to the viewer", "the main benefit, stated plainly", "curiosity (tease what's coming)", "a bold, concrete statement from the brief", "the problem the viewer has"];

/**
 * Alternative opening scenes and CTA wordings for a campaign pack. `base` = the current first (hook) scene
 * { assetId, text, voice }; `winner` (optional) = { headline, voice, angle } of the best-performing hook and
 * `losers` = headlines that did worse — "make more like the winner". Returns
 * { hooks: [{ assetId, inSec, headline, sub, voice, angle, why, flags? }], ctas: [string] }, guarded like a plan
 * (no numbers or claims the owner didn't give, reading-speed fit). Never throws for bad model output — an
 * unusable reply just yields fewer options.
 */
export async function writeHooks(brief, media, base, { hooks: k = 2, ctas: kc = 2, hookSec = 2, winner = null, losers = [] } = {}) {
  const want = Math.max(0, Math.min(4, k)), wantC = Math.max(0, Math.min(3, kc));
  if (!want && !wantC) return { hooks: [], ctas: [] };
  const maxWords = Math.max(3, Math.floor(hookSec * WORDS_PER_SEC) + 1);
  const baseIdx = base?.assetId ? media.findIndex((m) => m.id === base.assetId) + 1 : 0;
  const cta = str(brief.cta?.text, 120);
  const prompt =
    `You are a performance-ad copywriter. Write alternative OPENING scenes (hooks) for a short video ad and alternative ` +
    `call-to-action wordings, to A/B test.\n` + langRule(brief) +
    `BRIEF: "${str(brief.prompt, 1500)}"\n` +
    (brief.audience ? `Audience: ${str(brief.audience, 200)}\n` : "") + (brief.tone ? `Tone: ${str(brief.tone, 100)}\n` : "") +
    (brief.offer ? `Offer: ${str(brief.offer, 200)}\n` : "") + (cta ? `Current call to action: "${cta}"\n` : "") +
    `\nMEDIA (refer to them by number):\n${mediaList(media)}\n\n` +
    `CURRENT HOOK: media ${baseIdx || "none"}, headline "${str(base?.text?.headline, 90)}"${base?.voice ? `, voice "${str(base.voice, 200)}"` : ""}.\n` +
    (winner
      ? `THE WINNING HOOK so far (best click rate): headline "${str(winner.headline, 90)}"${winner.voice ? `, voice "${str(winner.voice, 200)}"` : ""}` +
        `${winner.angle ? ` (angle: ${winner.angle})` : ""}. Hooks that did worse: ${losers.map((l) => `"${str(l, 90)}"`).join(", ") || "none"}.\n` +
        `Write ${want} NEW hooks that use the same approach as the winner — same kind of angle and energy — but different words ` +
        `(not copies, not the losers' approach).\n`
      : `Write ${want} hooks, each with a DIFFERENT angle, e.g. ${HOOK_ANGLES.slice(0, Math.max(want, 3)).join("; ")}. Each must differ from the current hook.\n`) +
    `Rules for hooks: headline max ${maxWords} words, punchy, concrete; "media" = the most eye-catching item for THAT hook ` +
    `(may differ from the current one; 0 = keep the current media); "moment" = the number of the best moment for a video (0 = any).` +
    (brief.voice?.mode && brief.voice.mode !== "off" ? ` "voice": a spoken line of about ${Math.max(3, Math.round(hookSec * SPEECH_WPS))} words that complements the headline.` : "") +
    `\n` +
    (wantC
      ? `Write ${wantC} alternative call-to-action wordings (max 8 words each) that ask for the same action` +
        `${cta ? ` and keep every web address, code and number of the current one exactly ("${cta}")` : ""}.\n`
      : "") +
    `Never invent facts, prices, numbers, awards or claims that are not in the brief or notes.\n\n` +
    `JSON shape: {"hooks":[{"media":integer,"moment":integer,"headline":string,"sub":string,` +
    `${brief.voice?.mode && brief.voice.mode !== "off" ? '"voice":string,' : ""}"angle":string,"why":string}],"ctas":[string]}`;
  let data = {};
  try {
    ({ data } = await chatJson(TEXT_MODEL, prompt, null, { temperature: 0.8, numPredict: 8000, numCtx: 16384, timeoutMs: 600000 }));
  } catch (e) {
    console.error(`[deck] writeHooks failed: ${e.message}`);
    return { hooks: [], ctas: [] };
  }
  // Guard every hook exactly like a planned scene (numbers, claims, reading speed).
  const raw = (Array.isArray(data.hooks) ? data.hooks : []).slice(0, want).map((h) => ({
    role: "hook", media: Number.isInteger(h.media) && h.media > 0 ? h.media : baseIdx, moment: h.moment, durationSec: hookSec,
    headline: h.headline, sub: h.sub, bullets: [], voice: h.voice, layout: "headline-bottom", why: h.why,
  }));
  const guarded = raw.length
    ? repairPlan({ title: "x", scenes: raw }, { brief: { ...brief, mode: "ad", lengthSec: hookSec * raw.length, cta: null, voice: brief.voice?.mode === "manual" ? { ...brief.voice, mode: "auto" } : brief.voice }, media }).scenes
    : [];
  const seen = new Set([str(base?.text?.headline, 90).toLowerCase()]);
  const hooks = [];
  for (const [i, g] of guarded.entries()) {
    const headline = g.text.headline;
    if (!headline || seen.has(headline.toLowerCase())) continue;
    seen.add(headline.toLowerCase());
    hooks.push({
      assetId: g.assetId ?? base?.assetId ?? null, inSec: g.inSec ?? null, headline, sub: g.text.sub || "",
      voice: g.voice || "", angle: str(data.hooks[i]?.angle, 60), why: g.why || "", ...(g.flags ? { flags: g.flags } : {}),
    });
  }
  // CTAs: same claim/number guard; web addresses and codes of the original must survive.
  const okNums = allowedNumbers(brief, media);
  const src = [brief.prompt, brief.goal, brief.audience, brief.tone, brief.offer, brief.cta?.text, brief.cta?.url, ...media.map((m) => m.note)].join(" ").toLowerCase();
  const must = (cta.match(/\b[\w-]+(\.[\w-]+)+\b|\b[A-Z0-9]{4,}\b/g) ?? []).map((x) => x.toLowerCase());
  const ctas = [];
  for (const c of (Array.isArray(data.ctas) ? data.ctas : []).slice(0, wantC)) {
    let line = str(c, 120);
    if (!line || line.toLowerCase() === cta.toLowerCase() || ctas.some((x) => x.toLowerCase() === line.toLowerCase())) continue;
    if (unverified(line, okNums) || unverifiedClaim(line, src, !!str(brief.offer, 200))) continue;
    const missing = must.filter((m) => !line.toLowerCase().includes(m));
    if (missing.length) line = `${line.replace(/[.!]+$/, "")} — ${missing.join(" ")}`;
    ctas.push(line);
  }
  return { hooks, ctas };
}

// ── 5. Translate a deck (phase 5) ────────────────────────────────────────────────────────────────

const numsOf = (t) => (String(t ?? "").match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
const addrsOf = (t) => (String(t ?? "").match(/\b[\w-]+(\.[\w-]+)+\b/g) ?? []).map((a) => a.toLowerCase());
/** A translated line keeps every number and web address of its source, else the source line is kept. */
function keepFacts(src, out) {
  if (!src) return "";
  if (!out || typeof out !== "string") return src;
  const o = out.toLowerCase();
  const ok = numsOf(src).every((n) => numsOf(out).includes(n)) && addrsOf(src).every((a) => o.includes(a) || o.includes(a.replace(/\./g, " dot ")) || o.includes(a.split(".")[0]));
  return ok ? out.replace(/\s+/g, " ").trim() : src;
}

/**
 * Translate a deck's words into `lang` (a LANG_NAMES code). `brief` = { prompt, goal, audience, tone, offer, cta:{text} },
 * `scenes` = [{ text:{headline,sub,bullets}, voice }]. Returns { brief, scenes, kept } in the same shape, with lengths
 * trimmed to the scene limits; a line whose numbers or web addresses didn't survive stays in the source language
 * (`kept` counts them). Voice lines are written to be spoken (web addresses as words, e.g. "punto com").
 */
export async function translateDeck(brief, scenes, lang) {
  const name = LANG_NAMES[lang];
  if (!name) throw new Error("unsupported language");
  const src = LANG_NAMES[brief.language] ?? "English";
  const items = scenes.map((sc, i) => ({ i, headline: sc.text?.headline ?? "", sub: sc.text?.sub ?? "", bullets: sc.text?.bullets ?? [], voice: sc.voice ?? "" }));
  const b = { prompt: str(brief.prompt, 1500), goal: str(brief.goal, 200), audience: str(brief.audience, 200), tone: str(brief.tone, 100), offer: str(brief.offer, 200), cta: str(brief.cta?.text, 120) };
  const prompt =
    `Translate this short video / slide deck from ${src} into ${name}. Natural, idiomatic ${name} for the same audience — ` +
    `not word-for-word. Keep headlines about as short as the original (they must fit on screen). Keep every number, price, ` +
    `code, brand name and web address EXACTLY as written. In "voice" lines (spoken narration) write web addresses the way a ` +
    `${name} speaker says them aloud. Don't add or drop claims.\n\n` +
    `BRIEF: ${JSON.stringify(b)}\nSCENES: ${JSON.stringify(items)}\n\n` +
    `JSON shape: {"brief":{"prompt":string,"goal":string,"audience":string,"tone":string,"offer":string,"cta":string},` +
    `"scenes":[{"i":integer,"headline":string,"sub":string,"bullets":[string],"voice":string}]}`;
  const { data } = await chatJson(TEXT_MODEL, prompt, null, { temperature: 0.3, numPredict: 12000, numCtx: 24576, timeoutMs: 900000 });
  const byI = new Map((Array.isArray(data.scenes) ? data.scenes : []).map((x) => [Number(x?.i), x]));
  let kept = 0;
  // Trimmed at a word boundary (a translation can run longer than the source's limit).
  const cutW = (t, max) => { const v = str(t, 10000); if (v.length <= max) return v; const c = v.slice(0, max); const i = c.lastIndexOf(" "); return (i > max * 0.6 ? c.slice(0, i) : c).replace(/[,;:\-–—]+$/, "") + "…"; };
  const keep = (a, o, max) => { const r = keepFacts(a, o); if (a && r === a && o !== a) kept++; return cutW(r, max); };
  const outScenes = items.map((it) => {
    const t = byI.get(it.i) ?? {};
    const bullets = it.bullets.map((bl, k) => keep(bl, Array.isArray(t.bullets) ? t.bullets[k] : null, 90)).filter(Boolean);
    return { text: { headline: keep(it.headline, t.headline, 90), sub: keep(it.sub, t.sub, 140), bullets }, voice: it.voice ? keep(it.voice, t.voice, 400) : "" };
  });
  const tb = data.brief ?? {};
  return {
    brief: {
      prompt: keep(b.prompt, tb.prompt, 2000), goal: keep(b.goal, tb.goal, 200), audience: keep(b.audience, tb.audience, 200),
      tone: keep(b.tone, tb.tone, 100), offer: keep(b.offer, tb.offer, 200), cta: keep(b.cta, tb.cta, 120),
    },
    scenes: outScenes,
    kept,
  };
}

// ── 6. Chat editing ("Edit with AI") ─────────────────────────────────────────────────────────────

/**
 * The planner's layout rules for one scene edited outside a plan (chat): a chat needs 2+ messages and a list layout
 * 2+ items (else big words — never placeholders), and an explainer's text-only scenes stay animated. Returns the layout.
 */
export function fixLayout({ layout, text, role, hasMedia }, mode) {
  const n = Array.isArray(text?.bullets) ? text.bullets.filter(Boolean).length : 0;
  if (["mg-chat", "mg-steps", "mg-features", "mg-compare", "mg-fanout"].includes(layout) && n < 2) return "mg-words";
  if (mode === "explainer" && !hasMedia && !isMg(layout)) return role === "cta" ? "mg-end" : role === "title" ? "mg-logo" : "mg-words";
  return layout;
}

const EDIT_LOOKS = ["auto", "neon", "clean", "bold", "paper", "grid", "sunset"];

/**
 * One chat turn: the owner's request (the last user message in `history`) → { reply, ops, flags }.
 * `scenes` = [{ n, layout, role, durationSec, text, voice, shot, locked, hasMedia }] (n = 1-based, current order).
 * Ops (scene numbers refer to the storyboard as given): update / add / delete / move / look / shuffle / replan —
 * validated here (known layouts, clamped durations, scene numbers in range). Text the owner never gave — numbers,
 * claims, web addresses — is dropped (the owner's chat messages count as given), same guards as the planner.
 */
export async function editDeck(brief, scenes, history) {
  const look = brief.motion?.look ?? "auto";
  const list = scenes.map((s) =>
    `#${s.n} ${s.layout} (${s.role}, ${s.durationSec}s${s.locked ? ", LOCKED" : ""}${s.hasMedia ? ", shows a photo/video" : ""}) ` +
    `headline:${JSON.stringify(s.text?.headline ?? "")} sub:${JSON.stringify(s.text?.sub ?? "")} bullets:${JSON.stringify(s.text?.bullets ?? [])} ` +
    `voice:${JSON.stringify(s.voice ?? "")}${s.shot ? ` shot:${JSON.stringify(s.shot)}` : ""}${s.captions ? ` captions:${s.captions}` : ""}`).join("\n");
  const convo = history.slice(-12).map((m) => `${m.role === "user" ? "OWNER" : "YOU"}: ${str(m.text, 1500)}`).join("\n");
  const prompt =
    `You edit a short ${brief.mode === "explainer" ? "animated explainer" : brief.mode ?? "ad"} video in ClipWaltz. The owner chats with you to change it. ${langRule(brief)}\n` +
    `BRIEF: "${str(brief.prompt, 1200)}"` + (brief.cta?.text ? ` CTA: "${str(brief.cta.text, 120)}"${brief.cta.url ? ` (${str(brief.cta.url, 120)})` : ""}.` : "") + "\n" +
    `CURRENT STORYBOARD (in order; #1 is the opening scene${scenes.length ? `, #${scenes.length} is the LAST / closing scene` : ""}):\n${list || "(empty)"}\n` +
    `Animated-scenes LOOK: ${look} (options: ${EDIT_LOOKS.join(", ")}).\n` +
    `LAYOUTS: ${LAYOUTS.join(", ")}.\n${MG_GUIDE}` +
    `CONVERSATION:\n${convo}\n\n` +
    `Do what the owner's LAST message asks — that and nothing else. If it is unclear, ask one short question and make no changes.\n` +
    `Operations (scene numbers = the CURRENT storyboard above):\n` +
    `  {"op":"update","scene":n, and any of "headline","sub","bullets","voice","layout","durationSec","shot","captions"}\n` +
    `  ("captions" = where that scene's voiceover words show: "top", "bottom" or "auto" = the video's default)\n` +
    `  {"op":"add","after":n (0 = at the start),"role":"content","layout":…,"headline":…,"sub":…,"bullets":[…],"voice":…,"durationSec":…,"shot":…}\n` +
    `  {"op":"delete","scene":n}   {"op":"move","scene":n,"to":m}\n` +
    `  {"op":"look","look":"${EDIT_LOOKS.join("|")}"}   {"op":"shuffle"} (a fresh visual take of every animated scene)\n` +
    `  {"op":"replan"} (ONLY if the owner asks to start over / redo the whole video)\n` +
    `"shot" = a real cinematic shot an AI video model can film for that scene (people, places, objects; no text or logos).\n` +
    `Rules: never change LOCKED scenes; never invent facts, prices, numbers, claims or web addresses that are not in the brief or ` +
    `the owner's messages; on-screen text short; voice lines conversational, about ${SPEECH_WPS} words per second of the scene.\n` +
    `"reply": one or two friendly sentences saying what you changed (or your question).\nJSON: {"reply":string,"ops":[…]}`;
  const { data } = await chatJson(TEXT_MODEL, prompt, null, { temperature: 0.4, numPredict: 10000, numCtx: 16384, timeoutMs: 420000 });

  // Guards: what the owner has said (brief + their chat) is the source of truth for numbers, claims and addresses.
  const said = history.filter((m) => m.role === "user").map((m) => m.text).join(" ");
  const src = { ...brief, prompt: `${brief.prompt ?? ""} ${said}` };
  const okNums = allowedNumbers(src, []);
  const srcLower = [src.prompt, brief.goal, brief.audience, brief.tone, brief.offer, brief.cta?.text, brief.cta?.url].join(" ").toLowerCase();
  const flags = [];
  const clean = (v, max, field) => {
    const t = str(v, max);
    // A flagged field is left OUT of the op (undefined) so the scene keeps what it had — never blanked.
    if (t && (unverified(t, okNums) || unverifiedClaim(t, srcLower, !!str(brief.offer, 200)))) { flags.push(field); return undefined; }
    return t;
  };
  const n = scenes.length;
  const sceneNo = (v) => (Number.isInteger(v) && v >= 1 && v <= n ? v : null);
  const fields = (o) => {
    const f = {};
    const put = (k, v) => { if (v !== undefined) f[k] = v; };
    if (o.headline !== undefined) put("headline", clean(o.headline, 90, "headline"));
    if (o.sub !== undefined) put("sub", clean(o.sub, 140, "sub"));
    if (Array.isArray(o.bullets)) {
      const raw = o.bullets.map((b) => clean(b, 90, "bullet"));
      // Any flagged line: keep the scene's current lines rather than a partial list.
      if (!raw.some((b) => b === undefined)) put("bullets", raw.filter(Boolean).slice(0, 8));
    }
    if (o.voice !== undefined) put("voice", clean(o.voice, 300, "voice"));
    if (typeof o.layout === "string" && LAYOUTS.includes(o.layout)) f.layout = o.layout;
    if (o.durationSec !== undefined && Number.isFinite(Number(o.durationSec))) f.durationSec = Math.round(Math.max(MIN_SCENE, Math.min(15, Number(o.durationSec))) * 10) / 10;
    if (o.shot !== undefined) f.shot = str(o.shot, 400);
    if (["top", "bottom", "auto"].includes(o.captions)) f.captions = o.captions;
    return f;
  };
  const ops = [];
  for (const o of Array.isArray(data?.ops) ? data.ops.slice(0, 30) : []) {
    if (!o || typeof o !== "object") continue;
    if (o.op === "update" && sceneNo(o.scene)) ops.push({ op: "update", scene: o.scene, ...fields(o) });
    else if (o.op === "add" && Number.isInteger(o.after) && o.after >= 0 && o.after <= n) {
      const f = fields(o);
      ops.push({ op: "add", after: o.after, role: ROLES.includes(o.role) ? o.role : "content", layout: f.layout ?? (brief.mode === "explainer" ? "mg-words" : "title-card"),
        headline: f.headline ?? "", sub: f.sub ?? "", bullets: f.bullets ?? [], voice: f.voice ?? "", durationSec: f.durationSec ?? 4, shot: f.shot ?? "" });
    } else if (o.op === "delete" && sceneNo(o.scene)) ops.push({ op: "delete", scene: o.scene });
    else if (o.op === "move" && sceneNo(o.scene) && sceneNo(o.to)) ops.push({ op: "move", scene: o.scene, to: o.to });
    else if (o.op === "look" && EDIT_LOOKS.includes(o.look)) ops.push({ op: "look", look: o.look });
    else if (o.op === "shuffle") ops.push({ op: "shuffle" });
    else if (o.op === "replan") ops.push({ op: "replan" });
  }
  return { reply: str(data?.reply, 600) || (ops.length ? "Done." : "Sorry — I couldn't work out a change from that. Could you say it another way?"), ops, flags: [...new Set(flags)] };
}
