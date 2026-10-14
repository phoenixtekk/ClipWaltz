// Waltz Avatar (Phase 1) in WaltzDeck renders: presenter scenes (layouts presenter-full | presenter-split |
// presenter-bubble). Each voiced presenter scene's narration WAV is lip-synced onto the deck's presenter by MuseTalk on
// AISERVER (presenter-lipsync-v1, aiserver/talking/presenter.py) and cached in MinIO by what was asked for (the spoken
// line, voice, speed, pronunciations) — Kokoro's output differs slightly on every call, so the cache also keeps that
// narration (WAV + word timings) and a cache hit reuses it: clip, voice and captions stay exactly in sync, and re-renders
// of an unchanged line cost nothing. A presenter scene without narration shows the presenter's own footage.
//
// Env (render worker): AISERVER_API_URL, AISERVER_API_TOKEN — the same wrapper the generation worker uses.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const AISERVER_URL = (process.env.AISERVER_API_URL ?? "http://192.168.166.158:8189").replace(/\/$/, "");
const AI_HEADERS = { authorization: `Bearer ${process.env.AISERVER_API_TOKEN ?? ""}` };
const ENGINE = "musetalk15-mp-v1"; // part of the cache key: a new engine re-renders instead of reusing old clips
const LIPSYNC_TIMEOUT_MS = 30 * 60_000;
const LABEL_FONTS = [process.env.AI_LABEL_FONT, "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"].filter(Boolean);

export const PRESENTER_LAYOUTS = ["presenter-full", "presenter-split", "presenter-bubble"];
/** Keep in sync with src/lib/presenters.ts PRESENTER_SECONDS_PER_CREDIT. */
export const PRESENTER_SECONDS_PER_CREDIT = 10;
export const presenterCredits = (seconds) => (seconds > 0 ? Math.ceil(seconds / PRESENTER_SECONDS_PER_CREDIT) : 0);
export const isPresenterLayout = (l) => typeof l === "string" && l.startsWith("presenter-");

async function stage(file, name, type) {
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(file)], { type }), name);
  const r = await fetch(`${AISERVER_URL}/inputs`, { method: "POST", headers: AI_HEADERS, body: fd });
  if (!r.ok) throw new Error(`presenter: stage ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).filename;
}

async function runJob(workflow, inputs) {
  const sub = await fetch(`${AISERVER_URL}/jobs`, {
    method: "POST", headers: { ...AI_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ workflow, inputs }),
  });
  if (!sub.ok) throw new Error(`presenter: /jobs ${sub.status} ${(await sub.text()).slice(0, 200)}`);
  const id = (await sub.json()).job_id;
  const t0 = Date.now();
  while (Date.now() - t0 < LIPSYNC_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await fetch(`${AISERVER_URL}/jobs/${id}`, { headers: AI_HEADERS });
    if (!r.ok) continue;
    const st = await r.json();
    if (st.status === "completed" || st.status === "failed" || st.status === "cancelled") return st;
  }
  await fetch(`${AISERVER_URL}/jobs/${id}/cancel`, { method: "POST", headers: AI_HEADERS }).catch(() => {});
  throw new Error("presenter: lip-sync timed out");
}

/**
 * The lip-synced clip for one scene's narration (MP4 with the speech, the presenter footage's size) → local file path.
 * `voice` is the slot's { file, dur, words } — replaced in place by the cached narration on a cache hit. `request` is
 * what the narration was made from ({ text, voiceId, speed, pronunciations }).
 * io: { download(key, file), upload(key, file, type), exists(key) }.
 */
/** Shared with clone-voice.mjs: stage a file on AISERVER, run a wrapper job to the end, download one of its outputs. */
export { stage as aiStage, runJob as aiRunJob };
export async function aiDownload(o, file) {
  const rel = o?.subfolder ? `${o.subfolder}/${o.filename}` : o?.filename;
  const dl = await fetch(`${AISERVER_URL}/outputs/${rel}`, { headers: AI_HEADERS });
  if (!dl.ok) throw new Error(`AISERVER /outputs ${dl.status}`);
  writeFileSync(file, Buffer.from(await dl.arrayBuffer()));
}

/** MinIO key prefix of a cached clip (+ .mp4 / .wav / .json). Also used by the app to price a render (render-actions). */
export function clipCacheBase(presenter, request) {
  const hash = createHash("sha256").update(ENGINE).update(presenter.id).update(JSON.stringify(request)).digest("hex").slice(0, 32);
  return `presenters/${presenter.user_id}/${presenter.id}/clips/${hash}`;
}

/** The narration request as the render worker makes it — the cache key's input (keep the field order). */
export function narrationRequest(line, voice, pronunciations) {
  return { text: String(line ?? "").trim(), voiceId: voice?.voiceId, speed: voice?.speed, pronunciations: Array.isArray(pronunciations) ? pronunciations : [] };
}

export async function presenterClip(presenter, voice, request, dir, io, tag) {
  const base = clipCacheBase(presenter, request);
  const key = `${base}.mp4`;
  const out = join(dir, `presenter-${tag}.mp4`);
  if (await io.exists(key) && await io.exists(`${base}.json`)) {
    await io.download(key, out);
    const meta = join(dir, `presenter-${tag}.json`);
    await io.download(`${base}.json`, meta);
    const cached = JSON.parse(readFileSync(meta, "utf8"));
    await io.download(`${base}.wav`, voice.file);
    voice.dur = cached.dur;
    voice.words = cached.words;
    return { file: out, cached: true };
  }
  const wavFile = voice.file;
  const audio = await stage(wavFile, "speech.wav", "audio/wav");
  let st = await runJob("presenter-lipsync-v1", { presenter_id: presenter.id, audio });
  if (st.status === "failed" && st.error === "not_prepared") {
    // AISERVER lost (or never had) this presenter's cache — rebuild it from the footage (consent was checked when the
    // presenter was created; the rebuild doesn't repeat it).
    const foot = join(dir, `presenter-footage-${presenter.id}.mp4`);
    if (!existsSync(foot)) await io.download(presenter.footage_key, foot);
    const video = await stage(foot, "footage.mp4", "video/mp4");
    const prep = await runJob("presenter-prepare-v1", { presenter_id: presenter.id, video });
    if (prep.status !== "completed") throw new Error(`presenter: rebuild failed — ${prep.error ?? prep.status}`);
    const audio2 = await stage(wavFile, "speech.wav", "audio/wav");
    st = await runJob("presenter-lipsync-v1", { presenter_id: presenter.id, audio: audio2 });
  }
  if (st.status !== "completed") throw new Error(`presenter: lip-sync failed — ${st.error ?? st.status}`);
  const o = st.outputs?.[0];
  const rel = o?.subfolder ? `${o.subfolder}/${o.filename}` : o?.filename;
  const dl = await fetch(`${AISERVER_URL}/outputs/${rel}`, { headers: AI_HEADERS });
  if (!dl.ok) throw new Error(`presenter: /outputs ${dl.status}`);
  writeFileSync(out, Buffer.from(await dl.arrayBuffer()));
  try {
    // A presenter deleted while this render ran: don't write its likeness back into storage.
    if (io.alive && !(await io.alive(presenter.id))) throw new Error("presenter deleted");
    // The narration first, the clip last: a clip in the cache always has its WAV + timings beside it.
    await io.upload(`${base}.wav`, wavFile, "audio/wav");
    const meta = join(dir, `presenter-${tag}.json`);
    writeFileSync(meta, JSON.stringify({ dur: voice.dur, words: voice.words }));
    await io.upload(`${base}.json`, meta, "application/json");
    await io.upload(key, out, "video/mp4");
  } catch (e) {
    console.warn(`[presenter] cache upload failed: ${e.message}`);
  }
  return { file: out, cached: false };
}

/** The presenter's own footage for a scene with no narration (silent; looped if the scene is longer). */
export async function presenterFootage(presenter, dir, io) {
  const foot = join(dir, `presenter-footage-${presenter.id}.mp4`);
  if (!existsSync(foot)) await io.download(presenter.footage_key, foot);
  return foot;
}

export function labelFont() {
  const f = LABEL_FONTS.find((p) => existsSync(p));
  // The label is a legal requirement (EU AI Act Art. 50): never ship a presenter scene unlabelled.
  if (!f) throw new Error("no font for the AI-generated label — install fonts-dejavu-core or set AI_LABEL_FONT");
  return f;
}

/** drawtext for the "AI-generated" label at the top-right of a W×H region whose top-left is (x0, y0). */
export function aiLabel(font, x0, y0, w, h) {
  const short = Math.min(w, h);
  const fs = Math.max(12, Math.round(short * 0.035)), pad = Math.round(short * 0.03);
  return `drawtext=fontfile='${font.replace(/:/g, "\\:")}':text='AI-generated':fontsize=${fs}:fontcolor=white:` +
    `box=1:boxcolor=black@0.45:boxborderw=${Math.round(fs * 0.4)}:x=${x0}+${w}-tw-${pad}:y=${y0}+${pad}`;
}

/**
 * Where the presenter goes in a W×H frame for each layout → { x, y, w, h, round } (round = circle bubble).
 * split: beside the slide (right 42 % in landscape, bottom 45 % in portrait); bubble: a circle bottom-right, a third of
 * the short side (the watermark sits bottom-left, worker/watermark.mjs).
 */
export function presenterRect(layout, W, H) {
  if (layout === "presenter-split") {
    if (W >= H) {
      const w = Math.round((W * 0.42) / 2) * 2;
      return { x: W - w, y: 0, w, h: H, round: false };
    }
    const h = Math.round((H * 0.45) / 2) * 2;
    return { x: 0, y: H - h, w: W, h, round: false };
  }
  if (layout === "presenter-bubble") {
    const d = Math.round((Math.min(W, H) * 0.34) / 2) * 2;
    const m = Math.round(Math.min(W, H) * 0.04);
    return { x: W - d - m, y: H - d - m, w: d, h: d, round: true };
  }
  return { x: 0, y: 0, w: W, h: H, round: false };
}

/** The slide part's rectangle (what's left beside a split presenter; the whole frame otherwise). */
export function slideRect(layout, W, H) {
  if (layout !== "presenter-split") return { x: 0, y: 0, w: W, h: H };
  const p = presenterRect(layout, W, H);
  return W >= H ? { x: 0, y: 0, w: W - p.w, h: H } : { x: 0, y: 0, w: W, h: H - p.h };
}
