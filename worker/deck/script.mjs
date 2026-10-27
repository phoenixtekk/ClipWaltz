// WaltzDeck "follow my script": a brief written as a scene-by-scene script ("Scene 1 — 0:00–0:05 | THE PROBLEM",
// "On-screen text:", "Voiceover:") is turned into the storyboard directly — the owner's timing, on-screen words and
// narration are used word for word, and each scene's picture description becomes its suggested AI shot. No model call:
// a model rewrites (owner, 2026-10-27: "follow it exactly"). Anything that isn't a script goes to the planner as before.

const SCENE_RE = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:scene|shot)\s*#?\s*(\d{1,2})\b\s*[:.\-–—|)]*\s*(.*)$/i;
const TIME_RE = /(\d{1,2}):(\d{2})(?:\.(\d+))?\s*(?:–|—|-|to)\s*(\d{1,2}):(\d{2})(?:\.(\d+))?/i;
const TEXT_HEAD = /^\s*[*\-•]?\s*(?:on[\s-]?screen(?:\s+text)?|text\s+on\s+screen|super(?:s)?|title\s+card|caption(?:s)?)\b[^:]*:\s*(.*)$/i;
const VOICE_HEAD = /^\s*[*\-•]?\s*(?:voice[\s-]?over|vo|narration|narrator)\b[^:]*:\s*(.*)$/i;
// A section after the scenes ("Production requirements:") ends the last scene.
const END_HEAD = /^\s*(?:#{1,6}\s*)?(?:production|requirements|technical|deliverables?|global|general\s+notes|notes|music|audio|sound)\b[^:]*:\s*$/i;
const QUOTED = /^\s*[*\-•]?\s*["“”«](.+?)["“”»]\s*$/;

const tidy = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const secs = (m, h) => Number(m[h]) * 60 + Number(m[h + 1]) + (m[h + 2] ? Number(`0.${m[h + 2]}`) : 0);
const quoted = (line) => {
  const m = QUOTED.exec(line);
  return m ? tidy(m[1]) : null;
};

/**
 * Read a brief as a script. Returns null unless it has at least two "Scene N" headings; otherwise
 * { title, context, scenes: [{ n, label, startSec, endSec, visual, text: [lines], voice }] }.
 */
export function parseScript(prompt) {
  if (typeof prompt !== "string") return null;
  const lines = prompt.replace(/\r/g, "").split("\n");
  if (lines.filter((l) => SCENE_RE.test(l)).length < 2) return null;
  const pre = [];
  const scenes = [];
  let cur = null, state = "visual";
  for (const raw of lines) {
    const line = raw.trim();
    const head = SCENE_RE.exec(line);
    if (head) {
      const rest = head[2] ?? "";
      const t = TIME_RE.exec(rest);
      const label = tidy(rest.replace(TIME_RE, "").replace(/^[\s|:.\-–—]+|[\s|:.\-–—]+$/g, "").replace(/\s*\|\s*/g, " "));
      cur = { n: Number(head[1]), label, startSec: t ? secs(t, 1) : null, endSec: t ? secs(t, 4) : null, visual: [], text: [], voice: [] };
      scenes.push(cur);
      state = "visual";
      continue;
    }
    if (!cur) { if (line) pre.push(tidy(line)); continue; }
    if (END_HEAD.test(line)) { cur = null; continue; }
    if (!line) continue;
    const th = TEXT_HEAD.exec(line), vh = VOICE_HEAD.exec(line);
    if (vh) {
      state = "voice";
      const inline = vh[1] ? quoted(vh[1]) ?? tidy(vh[1]) : "";
      if (inline) cur.voice.push(inline);
      continue;
    }
    if (th) {
      state = "text";
      const inline = th[1] ? quoted(th[1]) ?? tidy(th[1]) : "";
      if (inline) cur.text.push(inline);
      continue;
    }
    const q = quoted(line);
    if (q != null) {
      // A quoted line is spoken under a voiceover heading, otherwise it is on-screen text (e.g. under "Below the logo:").
      (state === "voice" ? cur.voice : cur.text).push(q);
      continue;
    }
    // Unquoted narration right after its heading ("Voiceover:" then the line itself).
    if (state === "voice" && !cur.voice.length) { cur.voice.push(tidy(line)); continue; }
    state = "visual";
    // "Below the logo:" style labels only introduce the text that follows.
    if (/:\s*$/.test(line) && line.length <= 60) continue;
    cur.visual.push(tidy(line));
  }
  return {
    title: pre[0] ? pre[0].slice(0, 80) : "",
    context: pre.join(" "),
    scenes: scenes.map((s) => ({ ...s, visual: s.visual.join(" "), voice: s.voice.join(" ") })),
  };
}

const URL_RE = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|ai|app|co|us|dev)\b/i;

/** The scene's role from its heading, else its place in the script. */
function roleOf(s, i, n) {
  const l = s.label.toLowerCase();
  if (/call to action|\bcta\b|get started|sign up|contact/.test(l)) return "cta";
  if (/problem|pain|challenge|struggle/.test(l)) return "problem";
  if (/introduc|meet|reveal|brand/.test(l) && i < n - 1) return "title";
  if (/solution|benefit|transform|result|after/.test(l)) return "benefit";
  if (/proof|testimonial|review|demo/.test(l)) return "proof";
  if (i === n - 1 && (s.text.some((t) => URL_RE.test(t)) || /brand/.test(l))) return "cta";
  return i === 0 ? "hook" : "content";
}

/**
 * Turn a parsed script into planner scenes ({ role, assetId, durationSec, inSec, text, layout, voice, shot, why }).
 * `media` items whose note names a scene ("scene 6", "use in scene 3") are placed in that scene.
 * `speechSec(line)` is the narration length — a scene is never shorter than its spoken line.
 */
export function scenesFromScript(script, { mode, media = [], lengthSec, speechSec, minScene = 1.2, maxScene = 30 }) {
  const n = script.scenes.length;
  const timed = script.scenes.filter((s) => s.startSec != null && s.endSec > s.startSec);
  const timedSum = timed.reduce((t, s) => t + (s.endSec - s.startSec), 0);
  // Untimed scenes share what the brief's length leaves (4 s each when nothing is left).
  const spare = n > timed.length ? Math.max(0, (Number(lengthSec) || 0) - timedSum) / (n - timed.length) : 0;
  const byScene = new Map();
  for (const m of media) {
    const k = /\bscene\s*#?\s*(\d{1,2})\b/i.exec(m.note ?? "");
    if (k && !byScene.has(Number(k[1]))) byScene.set(Number(k[1]), m);
  }
  return script.scenes.map((s, i) => {
    const role = roleOf(s, i, n);
    const m = byScene.get(s.n) ?? null;
    const lines = s.text.map((t) => t.slice(0, 140)).filter(Boolean);
    let text = { headline: "", sub: "", bullets: [] };
    if (role === "cta") {
      const url = lines.find((t) => URL_RE.test(t));
      const rest = lines.filter((t) => t !== url);
      text = { headline: (rest[0] ?? "").slice(0, 90), sub: rest.slice(1).join(" ").slice(0, 140), bullets: url ? [url.slice(0, 80)] : [] };
    } else if (lines.length) {
      const all = lines.join(" ");
      // Lines shown one after another stay together while they fit one headline; a longer list becomes bullets.
      text = all.length <= 90 && lines.length !== 2
        ? { headline: all, sub: "", bullets: [] }
        : lines.length === 2
          ? { headline: lines[0].slice(0, 90), sub: lines[1], bullets: [] }
          : { headline: lines[0].slice(0, 90), sub: "", bullets: lines.slice(1, 7).map((b) => b.slice(0, 80)) };
    }
    let layout;
    if (mode === "explainer") layout = role === "cta" ? "mg-end" : "mg-words";
    else if (m) layout = text.bullets.length >= 2 ? "bullets" : role === "cta" ? "cta-card" : "headline-bottom";
    else layout = role === "cta" ? "cta-card" : mode === "presentation" ? "slide" : text.bullets.length >= 2 ? "bullets" : "title-card";
    const voice = s.voice.slice(0, 400);
    const planned = s.startSec != null && s.endSec > s.startSec ? s.endSec - s.startSec : spare || 4;
    let dur = Math.max(minScene, Math.min(maxScene, planned), Math.min(maxScene, speechSec(voice)));
    if (m?.kind === "video" && m.durationSec) dur = Math.min(dur, Math.max(minScene, m.durationSec));
    return {
      role,
      assetId: m?.id ?? null,
      inSec: null,
      durationSec: Math.round(dur * 10) / 10,
      text,
      layout,
      voice,
      shot: m ? "" : s.visual.slice(0, 400),
      why: `From your script — Scene ${s.n}${s.label ? `: ${s.label}` : ""}.${!m && s.visual ? ' The picture you described is ready — open "Generate a shot" on this scene.' : ""}`.slice(0, 300),
    };
  });
}
