// Proof composer: storyboard → finished explainer MP4. Runs on the render box (Chromium, ffmpeg, Kokoro TTS on
// 127.0.0.1:8191). Reuses the deck engine's narration + karaoke-caption code (worker/deck/voice.mjs).
// Usage: node scripts/proof/compose.mjs <wanDir> <workDir> <out.mp4> [music.mp3]
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { renderTemplate } from "./motion.mjs";
import { SCENES } from "./storyboard.mjs";
import { synthScenes, buildNarration, buildCaptionsAss } from "../../worker/deck/voice.mjs";

const [wanDir, work, outFile, music] = process.argv.slice(2);
if (!wanDir || !work || !outFile) throw new Error("usage: compose.mjs <wanDir> <workDir> <out.mp4> [music]");
mkdirSync(work, { recursive: true });
const W = 1920, H = 1080, FPS = 30, XF = 0.4; // crossfade between scenes
const ff = (args) => new Promise((res, rej) => {
  const p = spawn("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
  p.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}: ${args.slice(-1)}`))));
});
const t0 = Date.now();
const lap = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

// 1. Voice first: each scene lasts as long as its line (plus a breath), never less than its minimum.
// The brand is spoken "Text Ya" (owner, 2026-10-04); captions keep "TxtYa" — the product's brand pronunciations.
const slots = SCENES.map((s) => ({ scene: { voice: s.voice } }));
await synthScenes(slots, { voiceId: process.env.VOICE || "af_heart", speed: 1, pronunciations: [{ word: "TxtYa", say: "Text Ya" }] }, work);
const durs = SCENES.map((s, i) => Math.max(s.minDur, (slots[i].voice?.dur ?? 0) + 0.12 + 0.6) + (i < SCENES.length - 1 ? XF : 0));
lap(`voice: ${durs.map((d) => d.toFixed(2)).join(" ")}`);

// 2. One segment per scene.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"] });
// A Wan clip (24 fps, ~5 s, 1280×704 or 704×1280) stretched to `dur`, scaled to cover w×h.
const wanFilter = (dur, w, h, fx = 0.5) => `setpts=PTS*${(dur / 5).toFixed(4)},fps=${FPS},scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}:(iw-${w})*${fx}:(ih-${h})/2,trim=duration=${dur.toFixed(3)},setsar=1`;
const segs = [];
for (const [i, s] of SCENES.entries()) {
  const dur = durs[i], seg = join(work, `seg${i}.mp4`);
  segs.push(seg);
  if (existsSync(seg) && !process.env.FORCE) continue;
  if (s.motion) {
    await renderTemplate(browser, s.motion.template, { W, H, dur, ...s.motion.params }, seg, { fps: FPS });
  } else if (s.wan) {
    const ov = join(work, `ov${i}.mov`);
    await renderTemplate(browser, s.overlay.template, { W, H, dur, ...s.overlay.params }, ov, { fps: FPS });
    await ff(["-i", join(wanDir, `${s.wan}.mp4`), "-i", ov, "-filter_complex",
      `[0:v]${wanFilter(dur, W, H)}[b];[b][1:v]overlay=0:0:format=auto,format=yuv420p[v]`, "-map", "[v]", "-t", dur.toFixed(3), "-c:v", "libx264", "-crf", "16", "-preset", "medium", seg]);
  } else if (s.split) {
    // Three portrait panels: Wan | chat UI | Wan, sliding in left to right over the starfield.
    const pw = 560, ph = 920, y = 34, xs = [70, 680, 1290];
    const ui = join(work, `ui${i}.mp4`), bg = join(work, `bg${i}.mp4`);
    await renderTemplate(browser, s.split.center.template, { W: pw, H: ph, dur, ...s.split.center.params }, ui, { fps: FPS });
    await renderTemplate(browser, "starfield", { W, H, dur }, bg, { fps: FPS });
    const panel = (k, src) => `[${src}:v]${src === 3 ? `fps=${FPS},scale=${pw}:${ph},setsar=1` : wanFilter(dur, pw, ph, src === 1 ? (s.split.leftFocus ?? 0.5) : (s.split.rightFocus ?? 0.5))},format=yuva420p,fade=in:st=${(0.15 * k).toFixed(2)}:d=0.5:alpha=1,drawbox=c=0x22d3ee@0.9:t=4[p${k}]`;
    await ff(["-i", bg, "-i", join(wanDir, `${s.split.left}.mp4`), "-i", join(wanDir, `${s.split.right}.mp4`), "-i", ui, "-filter_complex",
      [panel(0, 1), panel(1, 3), panel(2, 2),
        `[0:v][p0]overlay=x='${xs[0]}-80*(1-min(t/0.5\\,1))':y=${y}[a]`, `[a][p1]overlay=x=${xs[1]}:y='${y}+60*(1-min(max(t-0.15\\,0)/0.5\\,1))'[b]`,
        `[b][p2]overlay=x='${xs[2]}+80*(1-min(max(t-0.3\\,0)/0.5\\,1))':y=${y},format=yuv420p[v]`].join(";"),
      "-map", "[v]", "-t", dur.toFixed(3), "-c:v", "libx264", "-crf", "16", "-preset", "medium", seg]);
  }
  lap(`scene ${s.id} (${dur.toFixed(2)} s)`);
}
await browser.close();

// 3. Crossfade the segments into one picture track; each scene's start is where its fade begins.
const starts = [];
let acc = 0;
for (const d of durs) { starts.push(acc); acc += d - XF; }
const total = acc + XF;
const vf = [];
let last = "[0:v]";
for (let i = 1; i < segs.length; i++) {
  const o = `[x${i}]`;
  vf.push(`${last}[${i}:v]xfade=transition=fade:duration=${XF}:offset=${starts[i].toFixed(3)}${o}`);
  last = o;
}
const picture = join(work, "picture.mp4");
await ff([...segs.flatMap((s) => ["-i", s]), "-filter_complex", vf.join(";"), "-map", last, "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", picture]);
lap(`picture ${total.toFixed(2)} s`);

// 4. Narration on the scene starts, karaoke captions at the bottom, music bed under the voice.
const narration = await buildNarration(slots, starts, total, work, ff);
const ass = buildCaptionsAss(slots, starts, W, H, { primary: "#22d3ee", headingFont: "Montserrat" })
  .replace(/^(Style: Cap,[^\n]*,)8,(\d+),(\d+),(\d+),1$/m, (_, a, l, r) => `${a}2,${l},${r},${Math.round(H * 0.06)},1`)
  .replace(/^(Style: Cap,Montserrat,)(\d+)/m, (_, a) => `${a}${Math.round(H * 0.052)}`);
const assFile = join(work, "captions.ass");
writeFileSync(assFile, ass);
const audioIn = music ? ["-i", narration, "-stream_loop", "-1", "-i", music] : ["-i", narration];
const af = music
  ? `[2:a]aresample=48000,volume=0.22,afade=t=in:d=1,afade=t=out:st=${(total - 2).toFixed(2)}:d=2[m];[1:a]asplit[v1][v2];[m][v2]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=400[md];[v1][md]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]`
  : `[1:a]anull[a]`;
await ff(["-i", picture, ...audioIn, "-filter_complex", `[0:v]subtitles=${assFile}[v];${af}`, "-map", "[v]", "-map", "[a]",
  "-t", total.toFixed(3), "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outFile]);
lap(`done → ${outFile}`);
