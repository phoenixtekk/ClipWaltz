// ─── Stage 2 of the explainer pipeline: script → narration + a timing map ─────
//
// This is the stage the whole video hangs off. The audio is what people hear,
// and the timing map is what lets the compositor reveal a caption or a diagram
// node exactly as the narration says it. Without the map, captions drift and the
// video feels dead — so the timing is the product here, not a by-product.
//
// Verified live against the owner's own cloned voice on 2026-09-13:
//   POST /v1/text-to-speech/{voice_id}/with-timestamps   ← the endpoint
//   header `xi-api-key`   (confirmed by the API itself: with no header it
//   answers "Neither authorization header nor xi-api-key received")
//   75-char probe  → 1.1s, 75/75 characters aligned, 4.27s audio
//   900-char probe → 8.3s, 783 KB mp3, 48.9s audio
//
// ⚠️ The alignment is CHARACTER-level, not word-level. The spec assumed
// "word/character timing"; the API returns `characters`,
// `character_start_times_seconds` and `character_end_times_seconds` only. Word
// boundaries are derived here, once, so nothing downstream has to know that.

/** One spoken word, with the seconds it occupies in the audio. */
export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

/** One narrated section: its audio offset, so it can become a chapter. */
export interface SectionTiming {
  id: string;
  heading: string;
  start: number;
  end: number;
}

export interface Narration {
  /** The whole narration as one MP3. */
  audio: Buffer;
  durationSec: number;
  words: WordTiming[];
  sections: SectionTiming[];
  /** Characters billed — the plan is denominated in characters, see below. */
  charactersUsed: number;
}

const API = "https://api.elevenlabs.io/v1";

function key(): string {
  return process.env.ELEVENLABS_API_KEY || "";
}
function voiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID || "";
}
function model(): string {
  return process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
}

export function voiceConfigured(): boolean {
  return Boolean(key() && voiceId());
}

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/**
 * Turn character timings into word timings.
 *
 * Whitespace closes the current word; everything else extends it. Punctuation
 * deliberately stays attached to the word it follows ("gate." rather than
 * "gate" + "."), because the compositor highlights whole spoken tokens and a
 * lone full stop is not something a viewer perceives as a word.
 */
export function wordsFromAlignment(a: Alignment): WordTiming[] {
  const out: WordTiming[] = [];
  let cur = "";
  let start: number | null = null;
  let lastEnd = 0;

  const n = Math.min(
    a.characters.length,
    a.character_start_times_seconds.length,
    a.character_end_times_seconds.length,
  );

  for (let i = 0; i < n; i++) {
    const ch = a.characters[i];
    if (/\s/.test(ch)) {
      if (cur) out.push({ word: cur, start: start ?? lastEnd, end: lastEnd });
      cur = "";
      start = null;
      continue;
    }
    if (start === null) start = a.character_start_times_seconds[i];
    cur += ch;
    lastEnd = a.character_end_times_seconds[i];
  }
  if (cur) out.push({ word: cur, start: start ?? lastEnd, end: lastEnd });
  return out;
}

/**
 * Narrate one block of text.
 *
 * Resolves with an error rather than throwing, like the publishing providers —
 * a voicing failure is a render-job outcome to record and retry, not an
 * exception that takes down the sweep.
 */
async function speak(text: string, voice?: string): Promise<{ audio: Buffer; alignment: Alignment } | { error: string }> {
  const vid = voice || voiceId();
  if (!key() || !vid) {
    return { error: "ElevenLabs is not configured (ELEVENLABS_API_KEY / voice id)." };
  }

  let res: Response;
  try {
    res = await fetch(`${API}/text-to-speech/${encodeURIComponent(vid)}/with-timestamps`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": key() },
      body: JSON.stringify({ text, model_id: model() }),
      // 900 characters took 8.3s; a full section is a few thousand. Generous,
      // because this only ever runs inside a background render job.
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Network error calling ElevenLabs." };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 401 is the one worth naming precisely: the API distinguishes "no header"
    // from "invalid key", and the fix differs.
    if (res.status === 401) {
      return { error: `ElevenLabs rejected the credentials: ${body.slice(0, 160)}` };
    }
    if (res.status === 422) {
      return { error: `ElevenLabs rejected the request (422) — usually an unknown voice id or model. ${body.slice(0, 160)}` };
    }
    return { error: `ElevenLabs returned HTTP ${res.status}. ${body.slice(0, 160)}` };
  }

  const d = (await res.json().catch(() => null)) as
    | { audio_base64?: string; alignment?: Alignment }
    | null;
  if (!d?.audio_base64 || !d.alignment) {
    return { error: "ElevenLabs returned no audio or no alignment." };
  }

  return { audio: Buffer.from(d.audio_base64, "base64"), alignment: d.alignment };
}

/**
 * Narrate a whole script, section by section.
 *
 * Sections are spoken separately on purpose. One call for the whole script
 * would be fewer round trips, but the section boundaries are what become
 * YouTube chapters and podcast structure, and recovering them from a single
 * timing map means string-matching narration back onto itself — fragile the
 * moment the model repeats a sentence. Speaking each section gives exact
 * boundaries for free.
 *
 * The MP3 parts are returned in order for ffmpeg to concatenate in stage 4;
 * timings are rebased onto the running offset so the map describes the FINAL
 * assembled audio rather than each fragment.
 */
export async function narrateScript(
  sections: { id: string; heading: string; narration: string }[],
  // ClipWaltz: which ElevenLabs voice. ELEVENLABS_VOICE_ID is the OWNER's cloned voice (SP's channel voice), so the
  // job runner passes it only for site-admin workspaces; everyone else gets ELEVENLABS_DEFAULT_VOICE_ID (a stock
  // voice). Never another person's clone.
  opts: { voiceId?: string } = {},
): Promise<{ parts: Buffer[]; narration: Omit<Narration, "audio"> } | { error: string }> {
  const parts: Buffer[] = [];
  const words: WordTiming[] = [];
  const timings: SectionTiming[] = [];
  let offset = 0;
  let characters = 0;

  for (const s of sections) {
    const text = s.narration.trim();
    if (!text) continue;

    const r = await speak(text, opts.voiceId);
    if ("error" in r) return { error: `Section "${s.heading}": ${r.error}` };

    const local = wordsFromAlignment(r.alignment);
    const ends = r.alignment.character_end_times_seconds;
    const dur = ends.length ? ends[ends.length - 1] : 0;

    for (const w of local) words.push({ word: w.word, start: w.start + offset, end: w.end + offset });
    timings.push({ id: s.id, heading: s.heading, start: offset, end: offset + dur });

    parts.push(r.audio);
    offset += dur;
    characters += text.length;
  }

  if (parts.length === 0) return { error: "The script had no narration to speak." };

  return {
    parts,
    narration: { durationSec: offset, words, sections: timings, charactersUsed: characters },
  };
}

/**
 * YouTube chapter lines, built from the section boundaries.
 *
 * YouTube requires the first chapter to start at 00:00, so the opening section
 * is pinned there regardless of any leading silence.
 */
export function chapterLines(sections: SectionTiming[]): string {
  return sections
    .map((s, i) => `${hhmmss(i === 0 ? 0 : s.start)} ${s.heading}`)
    .join("\n");
}

function hhmmss(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
