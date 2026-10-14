// Waltz Avatar Phase 2: WaltzDeck narration in a presenter's own cloned voice (brief.voice.voiceId = "clone:<presenterId>").
// Every voiced scene's line is spoken by Chatterbox on AISERVER (voice-clone-tts-v1, aiserver/voice/service.py) from the
// presenter's reference clip, with word timings for the captions. Lines are cached in MinIO by what was asked for (words,
// language, pronunciations) — like the lip-sync cache — so a re-render of unchanged lines costs nothing and keeps the
// same take (the presenter clips are keyed on the same request, so they stay in sync).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aiStage, aiRunJob, aiDownload } from "./presenter.mjs";
import { respell, respokenWords } from "./voice.mjs";

const ENGINE = "chatterbox-mtl-v1";

/** The cache key's input for one line (keep the field order — the app prices renders with the same function). */
export function voiceLineRequest(line, language, pronunciations) {
  return { text: String(line ?? "").trim(), language: language || "en", pronunciations: Array.isArray(pronunciations) ? pronunciations : [] };
}

/** MinIO key prefix of a cached line (+ .wav / .json). */
export function voiceCacheBase(presenter, request) {
  const hash = createHash("sha256").update(ENGINE).update(presenter.id).update(JSON.stringify(request)).digest("hex").slice(0, 32);
  return `presenters/${presenter.user_id}/${presenter.id}/voice/${hash}`;
}

/**
 * Narrate every slot whose scene has a voice line, in the presenter's cloned voice. Sets slot.voice = { file, dur, words }
 * like synthScenes (worker/deck/voice.mjs). Returns the seconds newly spoken (cache misses — what the render is charged for).
 * io: { download(key, file), upload(key, file, type), exists(key), alive(id) }.
 */
export async function synthCloneScenes(slots, { presenter, language, pronunciations }, dir, io) {
  const todo = [];
  for (let i = 0; i < slots.length; i++) {
    const written = String(slots[i].scene?.voice ?? "").trim();
    if (!written) continue;
    const req = voiceLineRequest(written, language, pronunciations);
    const base = voiceCacheBase(presenter, req);
    const file = join(dir, `voice${i}.wav`);
    if (await io.exists(`${base}.wav`) && await io.exists(`${base}.json`)) {
      await io.download(`${base}.wav`, file);
      const meta = join(dir, `voice${i}.json`);
      await io.download(`${base}.json`, meta);
      const m = JSON.parse(readFileSync(meta, "utf8"));
      slots[i].voice = { file, dur: m.dur, words: m.words };
      continue;
    }
    const { text, subs } = respell(written, pronunciations);
    todo.push({ i, base, file, text, subs });
  }
  if (!todo.length) return 0;

  const ref = join(dir, "voice-ref.wav");
  await io.download(presenter.voice_ref_key, ref);
  const audio = await aiStage(ref, "ref.wav", "audio/wav");
  const st = await aiRunJob("voice-clone-tts-v1", { audio, lines: todo.map((t) => t.text.slice(0, 600)), language: language || "en" });
  if (st.status !== "completed") throw new Error(`your cloned voice failed — ${st.error ?? st.status}`);
  const [manifestOut, ...wavs] = st.outputs ?? [];
  const manifestFile = join(dir, "voice-manifest.json");
  await aiDownload(manifestOut, manifestFile);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  let seconds = 0;
  for (const [k, t] of todo.entries()) {
    const m = manifest[k];
    const out = wavs.find((w) => w.filename === m?.file);
    if (!m || !out) throw new Error("your cloned voice returned fewer lines than asked");
    await aiDownload(out, t.file);
    const words = respokenWords(Array.isArray(m.words) ? m.words : [], t.subs);
    slots[t.i].voice = { file: t.file, dur: Number(m.dur) || 0, words };
    seconds += Number(m.dur) || 0;
    try {
      if (io.alive && !(await io.alive(presenter.id))) throw new Error("presenter deleted");
      const meta = join(dir, `voice${t.i}.json`);
      writeFileSync(meta, JSON.stringify({ dur: Number(m.dur) || 0, words }));
      await io.upload(`${t.base}.json`, meta, "application/json");
      await io.upload(`${t.base}.wav`, t.file, "audio/wav"); // the WAV last: a cached WAV always has its timings
    } catch (e) {
      console.warn(`[clone-voice] cache upload skipped: ${e.message}`);
    }
  }
  return seconds;
}
