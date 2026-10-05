// WaltzDeck voice & captions (phase 2): scene narration via the local Kokoro service (worker/tts/server.py,
// 127.0.0.1:8191 on the render box), one narration track aligned to the scene starts, and an ASS subtitle file
// that highlights each word as it's spoken (libass \kf karaoke), burned in by the render's look pass.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const TTS_URL = process.env.TTS_URL || "http://127.0.0.1:8191";

// Brand pronunciations (brand_kits.pronunciations_json, [{ word, say }]): the voice reads the respelling ("TxtYa" →
// "Text Ya"), then the spoken words are merged back into the written one so the captions match the screen.
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bare = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const usable = (list) => (Array.isArray(list) ? list : [])
  .filter((p) => p && String(p.word ?? "").trim() && String(p.say ?? "").trim())
  .sort((a, b) => b.word.length - a.word.length); // longest first: "TxtYa Pro" before "TxtYa"

/** The line as it should be spoken, plus which words were respelled (in order) for respokenWords(). */
export function respell(line, list) {
  const ps = usable(list);
  if (!ps.length) return { text: line, subs: [] };
  // One pass with every word as an alternative, so a respelling is never matched again and subs stay in line order.
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${ps.map((p) => reEsc(p.word.trim())).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const subs = [];
  const text = line.replace(re, (m) => {
    const p = ps.find((x) => x.word.trim().toLowerCase() === m.toLowerCase());
    subs.push(p);
    return p.say.trim();
  });
  return { text, subs };
}

/** Merge each respelled run of spoken words back into its written word (timings span the run), in order. */
export function respokenWords(words, subs) {
  const out = [...words];
  let k = 0;
  for (const p of subs) {
    const say = p.say.trim().split(/\s+/).map(bare).filter(Boolean);
    if (!say.length) continue;
    for (; k + say.length <= out.length; k++) {
      if (!say.every((t, j) => bare(out[k + j].w) === t)) continue;
      const last = out[k + say.length - 1];
      const tail = String(last.w).match(/[^\p{L}\p{N}]+$/u)?.[0] ?? "";
      out.splice(k, say.length, { ...out[k], w: p.word.trim() + tail, e: last.e });
      k++;
      break;
    }
  }
  return out;
}

/** Narrate every slot whose scene has a voice line. Sets slot.voice = { file, dur, words:[{w,s,e}] }. */
export async function synthScenes(slots, { voiceId = "af_heart", speed = 1, pronunciations = [] } = {}, dir) {
  for (let i = 0; i < slots.length; i++) {
    const written = String(slots[i].scene?.voice ?? "").trim();
    if (!written) continue;
    const { text: line, subs } = respell(written, pronunciations);
    let res;
    try {
      res = await fetch(`${TTS_URL}/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: line.slice(0, 2000), voice: voiceId, speed }),
        signal: AbortSignal.timeout(120000),
      });
    } catch (e) {
      throw new Error(`voiceover service unavailable (${e.message}) — try the render again in a minute`);
    }
    if (!res.ok) throw new Error(`voiceover failed for scene ${i + 1}: ${res.status} ${(await res.text()).slice(0, 160)}`);
    const j = await res.json();
    const file = join(dir, `voice${i}.wav`);
    writeFileSync(file, Buffer.from(j.wav, "base64"));
    slots[i].voice = { file, dur: Number(j.duration) || 0, words: respokenWords(Array.isArray(j.words) ? j.words : [], subs) };
  }
}

/** One narration track (48 kHz stereo WAV) with each scene's voice placed at its scene start (`starts`, s). */
export async function buildNarration(slots, starts, total, dir, ffmpeg) {
  const inputs = [];
  const parts = [];
  slots.forEach((s, i) => {
    if (!s.voice) return;
    const k = parts.length; // input index (not the args count: each input adds two args)
    inputs.push("-i", s.voice.file);
    const ms = Math.max(0, Math.round((starts[i] + 0.12) * 1000)); // a beat after the cut
    parts.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${k}]`);
  });
  if (!parts.length) return null;
  const n = parts.length;
  const out = join(dir, "narration.wav");
  const T = total.toFixed(3);
  const tail = n > 1
    ? `${parts.map((_, k) => `[v${k}]`).join("")}amix=inputs=${n}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad=whole_dur=${T}[out]`
    : `[v0]loudnorm=I=-16:TP=-1.5:LRA=11,apad=whole_dur=${T}[out]`; // broadcast speech level
  await ffmpeg([...inputs, "-filter_complex", `${parts.join(";")};${tail}`, "-map", "[out]", "-t", T, "-c:a", "pcm_s16le", out]);
  return out;
}

const assTime = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
};
// #rrggbb → ASS &HAABBGGRR (opaque)
const assColour = (hex, fallback) => {
  const h = /^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex : fallback;
  return `&H00${h.slice(5, 7)}${h.slice(3, 5)}${h.slice(1, 3)}&`.toUpperCase();
};
const clean = (w) => String(w).replace(/[{}\\]/g, "").trim();

/**
 * ASS captions: each scene's words in short groups (≤4 words, or up to a pause), each word filling with the
 * brand colour as it's spoken. Top-centre, clear of the bottom text layouts and the watermark.
 */
export function buildCaptionsAss(slots, starts, W, H, brand = {}) {
  const fs = Math.round(Math.min(W, H) * 0.08);
  const font = String(brand.headingFont || "Montserrat").replace(/[^A-Za-z0-9 -]/g, "") || "Montserrat";
  const lines = [];
  slots.forEach((s, i) => {
    if (!s.voice?.words?.length) return;
    const base = starts[i] + 0.12;
    const ws = s.voice.words.map((w) => ({ w: clean(w.w), s: base + Number(w.s), e: base + Number(w.e) })).filter((w) => w.w);
    let group = [];
    const flush = () => {
      if (!group.length) return;
      const start = group[0].s, end = group[group.length - 1].e + 0.15;
      const text = group.map((w, k) => {
        const next = group[k + 1];
        const dur = (next ? next.s : w.e) - w.s; // include the gap before the next word
        return `{\\kf${Math.max(1, Math.round(dur * 100))}}${w.w}`;
      }).join(" ");
      lines.push({ start, end, text });
      group = [];
    };
    for (const w of ws) {
      if (group.length && (group.length >= 4 || w.s - group[group.length - 1].e > 0.35)) flush();
      group.push(w);
    }
    flush();
  });
  if (!lines.length) return null;
  // A line never lingers into the next one (libass would stack them).
  lines.sort((a, b) => a.start - b.start);
  for (let k = 0; k < lines.length - 1; k++) lines[k].end = Math.min(lines[k].end, lines[k + 1].start - 0.01);
  const events = lines.map((l) => `Dialogue: 0,${assTime(l.start)},${assTime(l.end)},Cap,,0,0,0,,${l.text}`);
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Primary = the spoken (highlighted) colour, Secondary = not yet spoken.
    `Style: Cap,${font},${fs},${assColour(brand.primary, "#fde047")},&H00FFFFFF&,&H00000000&,&H78000000&,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(fs * 0.07))},${Math.round(fs * 0.04)},8,${Math.round(W * 0.07)},${Math.round(W * 0.07)},${Math.round(H * 0.1)},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
