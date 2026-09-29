// WaltzDeck campaign variants (phase 4, 06_ClipWaltz_WaltzDeck_Feature_Spec.md §6): one storyboard → a pack of
// hooks × CTAs × lengths × aspects. Pure functions (no DB): the deck worker (jobs.mjs "campaign_render") turns each
// combination into a storyboard snapshot that the render worker renders instead of the project's scenes.
// Scenes are deck_scenes rows (snake_case), exactly what render-worker.mjs reads.
import { fitText, speechSec } from "./planner.mjs";

export const MAX_VARIANTS = 12;
const MIN_SCENE = 1.2;
const MAX_SCENE = 8;
const WORDS_PER_SEC = 3;
const HOOK_CODES = "ABCD";

/** "Book at lake.com" → "Book at lake dot com" (TTS reads a spoken address, like the planner's narration). */
export const spokenCta = (t) => String(t ?? "").replace(/\b([\w-]+)\.(com|net|org|io|co|us|ca|uk|app|shop|store|biz|info)\b/gi, "$1 dot $2");

/** Variant code + label: hook letter, CTA number, length, aspect → "B2 · 15s · 9:16". */
export function variantCode(hookIdx, ctaIdx, lengthSec, aspect) {
  const code = `${HOOK_CODES[hookIdx] ?? String(hookIdx + 1)}${ctaIdx + 1}`;
  return { code, label: `${code} · ${Math.round(lengthSec)}s · ${aspect}` };
}

/** Every combination, in a stable order (hook, then CTA, then length, then aspect). */
export function combinations({ hooks, ctas, lengths, aspects }) {
  const out = [];
  hooks.forEach((h, hi) => ctas.forEach((c, ci) => lengths.forEach((L) => aspects.forEach((a) => out.push({ hook: h, hookIdx: hi, cta: c, ctaIdx: ci, lengthSec: L, aspect: a })))));
  return out;
}

/**
 * One variant's storyboard. `base` = the project's scenes in order; `hook` = { original } or { assetId, inSec,
 * headline, sub, voice }; `cta` = { original } or { text }; `mediaDur` = Map(assetId → seconds) for videos;
 * `voiceOn` / `speed` = narration settings (a spoken line sets a scene's minimum length); `baseCta` = the brief's CTA.
 */
export function buildVariant(base, { hook, cta, lengthSec, mediaDur = new Map(), voiceOn = false, speed = 1, baseCta = "", mode = "ad" }) {
  const scenes = base.map((s) => ({ ...s, text: { headline: "", sub: "", bullets: [], ...(s.text ?? {}) } }));
  if (!scenes.length) return [];
  const hookAt = Math.max(0, scenes.findIndex((s) => s.role === "hook"));
  let ctaAt = -1;
  for (let i = scenes.length - 1; i >= 0; i--) if (scenes[i].role === "cta") { ctaAt = i; break; }

  if (hook && !hook.original) {
    const h = scenes[hookAt];
    if (hook.assetId !== undefined && hook.assetId !== h.asset_id) {
      h.asset_id = hook.assetId;
      h.in_sec = hook.inSec ?? null;
      // The new hook's clip is no longer repeated later in the ad.
      for (let i = scenes.length - 1; i >= 0; i--) {
        if (i !== hookAt && i !== ctaAt && hook.assetId && scenes[i].asset_id === hook.assetId && scenes.length > 2) {
          scenes.splice(i, 1);
          if (ctaAt > i) ctaAt--;
        }
      }
    }
    h.text = { ...h.text, headline: hook.headline ?? h.text.headline, sub: hook.sub ?? "" };
    if (h.text_mode === "none") h.text_mode = "auto";
    if (voiceOn) h.voice = hook.voice || h.voice;
  }

  if (cta && !cta.original && ctaAt >= 0) {
    const c = scenes[ctaAt];
    const old = String(baseCta ?? "").trim();
    const repl = (t) => (old && t && t.toLowerCase().includes(old.toLowerCase()) ? t.replace(new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), cta.text) : null);
    const h = repl(c.text.headline), s = repl(c.text.sub);
    if (h !== null) c.text.headline = h;
    else if (s !== null) c.text.sub = s;
    else c.text.sub = cta.text;
    if (voiceOn) c.voice = repl(c.voice) ?? spokenCta(cta.text);
  }

  // Fit to the target length: keep the hook and the CTA; drop middle scenes from the end while even their minimum
  // lengths don't fit; then scale the rest within [floor, cap] (a video never past its own length).
  const maxS = mode === "presentation" ? 15 : MAX_SCENE;
  // The CTA is never cut below 2.5 s (it has to be read) — nor its text trimmed, below.
  const floorOf = (s, i) => Math.max(i === ctaAt ? 2.5 : i === hookAt ? 1.5 : MIN_SCENE, voiceOn ? Math.min(maxS, speechSec(s.voice, speed)) : 0);
  const capOf = (s, i) => {
    const d = s.asset_id ? mediaDur.get(s.asset_id) : null;
    const base = i === ctaAt ? Math.max(3.5, voiceOn ? Math.min(maxS, speechSec(s.voice, speed)) : 0) : maxS;
    return d ? Math.max(Math.min(base, d), Math.min(floorOf(s, i), d)) : base;
  };
  const fixed = () => new Set([scenes.findIndex((s) => s.role === "hook") < 0 ? 0 : scenes.findIndex((s) => s.role === "hook"), ...(ctaAt >= 0 ? [ctaAt] : [])]);
  const sumFloors = () => scenes.reduce((n, s, i) => n + Math.min(floorOf(s, i), capOf(s, i)), 0);
  while (sumFloors() > lengthSec && scenes.length > fixed().size) {
    const keep = fixed();
    let drop = -1;
    for (let i = scenes.length - 1; i >= 0; i--) if (!keep.has(i)) { drop = i; break; }
    if (drop < 0) break;
    scenes.splice(drop, 1);
    if (ctaAt > drop) ctaAt--;
  }
  for (const [i, s] of scenes.entries()) s.duration_sec = Math.max(Math.min(floorOf(s, i), capOf(s, i)), Math.min(capOf(s, i), Number(s.duration_sec) || 3));
  for (let pass = 0; pass < 5; pass++) {
    const total = scenes.reduce((n, s) => n + s.duration_sec, 0);
    const gap = lengthSec - total;
    if (Math.abs(gap) < 0.15) break;
    const room = scenes.map((s, i) => [s, i]).filter(([s, i]) => (gap > 0 ? s.duration_sec < capOf(s, i) - 0.01 : s.duration_sec > floorOf(s, i) + 0.01));
    const roomSum = room.reduce((n, [s]) => n + s.duration_sec, 0);
    if (!room.length || roomSum <= 0) break;
    const k = (roomSum + gap) / roomSum;
    for (const [s, i] of room) s.duration_sec = Math.max(floorOf(s, i), Math.min(capOf(s, i), s.duration_sec * k));
  }
  // Text re-fitted to each scene's new reading time (a 6 s cut can't carry the 30 s version's words).
  for (const [i, s] of scenes.entries()) {
    s.duration_sec = Math.round(s.duration_sec * 10) / 10;
    s.order_index = i;
    const d = s.asset_id ? mediaDur.get(s.asset_id) : null;
    if (s.in_sec != null && d) s.in_sec = Math.round(Math.max(0, Math.min(d - s.duration_sec, Number(s.in_sec))) * 10) / 10;
    if (s.text_mode !== "manual" && i !== ctaAt) s.text = fitText({ headline: s.text.headline ?? "", sub: s.text.sub ?? "", bullets: s.text.bullets ?? [] }, Math.max(3, Math.floor(s.duration_sec * WORDS_PER_SEC) + 1));
  }
  return scenes;
}

/** Seconds a snapshot will run (before beat sync / narration stretch). */
export const snapshotLength = (scenes) => Math.round(scenes.reduce((n, s) => n + (Number(s.duration_sec) || 0), 0) * 10) / 10;
