import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExplainerScript } from "./script";
import type { SectionTiming, WordTiming } from "./voice";
import { renderFrameRaw, WIDTH, HEIGHT } from "./compositor";
import { ambientLoopFrames } from "./ambient";

// ─── Stage 4: assembly ───────────────────────────────────────────────────────
//
//   [ambient loop, repeated] ⊕ [info layer, alpha] + [narration] → episode.mp4
//
// Two measurements shaped this file, both taken on linuxg1 at 1920×1080:
//
//   drawing one info frame ....... 2 ms
//   encoding it to PNG .......... 139 ms
//
// So frames are never encoded. They are drawn and handed to ffmpeg as raw RGBA
// over a pipe, which turns a five-minute episode from **21 minutes** of frame
// generation into **under one**. Nothing touches the disk except the audio and
// the six-second ambient loop.
//
// The ambient layer is drawn ONCE as a seamless loop and repeated by ffmpeg
// (`-stream_loop`), because every animated term in it is an integer number of
// cycles per period — 180 frames for a five-minute episode instead of 9,000.
//
// Back-pressure matters here: at 1920×1080 RGBA a frame is 8.3 MB and 30fps is
// ~249 MB/s. Writes are awaited on `drain` so the pipe throttles the renderer
// instead of buffering a whole episode into memory.

const FPS = 30;
const BYTES_PER_FRAME = WIDTH * HEIGHT * 4;

export interface AssembleResult {
  /** The finished episode. */
  video: Buffer;
  durationSec: number;
  frames: number;
  /** Wall-clock milliseconds for the whole assembly. */
  elapsedMs: number;
}

function run(cmd: string, args: string[], stdin?: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [stdin ? "pipe" : "ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr!.on("data", (d) => {
      // Keep only the tail: ffmpeg is chatty and a full log is useless noise.
      err = (err + d.toString()).slice(-2000);
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.trim()}`)),
    );
    if (stdin) {
      p.stdin!.end(stdin);
    }
  });
}

/**
 * Join the per-section narration MP3s into one track.
 *
 * `concat` on the demuxer rather than the filter: these are all the same codec
 * from the same voice at the same settings, so copying avoids a re-encode and
 * the generation loss that comes with it.
 */
async function joinNarration(dir: string, parts: Buffer[]): Promise<string> {
  const files: string[] = [];
  for (const [i, p] of parts.entries()) {
    const f = join(dir, `n${String(i).padStart(3, "0")}.mp3`);
    await writeFile(f, p);
    files.push(f);
  }
  const list = join(dir, "parts.txt");
  await writeFile(list, files.map((f) => `file '${f}'`).join("\n"));

  const joined = join(dir, "narration.mp3");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);
  return joined;
}

/** Draw the ambient loop once and encode it. */
async function buildAmbient(dir: string, seed: number): Promise<string> {
  const frames = ambientLoopFrames({ periodSec: 6, frameRate: FPS, seed });
  const out = join(dir, "ambient.mp4");

  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      "ffmpeg",
      [
        "-y", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", out,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d.toString()).slice(-1500)));
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ambient encode exited ${c}: ${err}`))));
    (async () => {
      for (const f of frames) {
        if (!p.stdin.write(f)) await new Promise((r) => p.stdin.once("drain", r));
      }
      p.stdin.end();
    })().catch(reject);
  });

  return out;
}

/** Which section owns a given moment. */
function sectionAt(timings: SectionTiming[], t: number): SectionTiming {
  for (const s of timings) if (t >= s.start && t < s.end) return s;
  return timings[timings.length - 1];
}

/**
 * Build the finished episode.
 *
 * `narrationParts` and `timings` come straight from `narrateScript` — the
 * timings already describe the final assembled audio, so nothing is rebased here.
 */
export async function assembleEpisode(opts: {
  script: ExplainerScript;
  narrationParts: Buffer[];
  timings: SectionTiming[];
  words: WordTiming[];
  durationSec: number;
  seed?: number;
  /** Called with 0..1 so a long render can report progress to the job row. */
  onProgress?: (fraction: number) => void;
}): Promise<AssembleResult> {
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), "sp-episode-"));

  try {
    const audio = await joinNarration(dir, opts.narrationParts);
    const ambient = await buildAmbient(dir, opts.seed ?? 20260913);
    const out = join(dir, "episode.mp4");

    // Index sections by id so each frame looks up its own template cheaply.
    const byId = new Map(opts.script.sections.map((s) => [s.id, s]));
    const totalFrames = Math.ceil(opts.durationSec * FPS);

    await new Promise<void>((resolve, reject) => {
      const ff = spawn(
        "ffmpeg",
        [
          "-y", "-loglevel", "error",
          // 0: the ambient loop, repeated for as long as the episode runs.
          "-stream_loop", "-1", "-i", ambient,
          // 1: the info layer, raw RGBA straight off the canvas.
          "-f", "rawvideo", "-pix_fmt", "rgba",
          "-s", `${WIDTH}x${HEIGHT}`, "-framerate", String(FPS), "-i", "-",
          // 2: the narration.
          "-i", audio,
          "-filter_complex",
          // `format=auto` lets the overlay honour the info layer's alpha, which
          // is the whole point of rendering it transparent.
          "[0:v]fps=" + FPS + ",scale=" + WIDTH + ":" + HEIGHT + "[bg];" +
            "[1:v]format=rgba[fg];" +
            "[bg][fg]overlay=0:0:format=auto[v];" +
            // Broadcast-ish loudness, so episodes match each other and the
            // listener never reaches for the volume between videos.
            // `loudnorm` resamples internally and will happily emit 96 kHz if
            // left alone — measured on the first assembled episode. Pin it to
            // 48 kHz, which is what video wants and what YouTube expects.
            //
            // Single-pass, so the result lands near the target rather than on
            // it: the same episode measured -17.5 LUFS against I=-16. That is
            // well inside tolerance for a platform that re-normalises to about
            // -14 anyway, and a two-pass measure-then-apply would double the
            // audio work for a difference nobody can hear.
            "[2:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]",
          "-map", "[v]", "-map", "[a]",
          // `veryfast` rather than `medium`: this content is flat vector graphics over a
          // slow gradient, which x264 finds trivial, and encoding dominates assembly
          // time. Measured below.
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
          // The audio is the authority on length: the ambient loops forever and
          // the frame stream is generated to match, so `-shortest` ends the file
          // when the narration does.
          "-shortest", "-movflags", "+faststart",
          out,
        ],
        { stdio: ["pipe", "ignore", "pipe"] },
      );

      let err = "";
      ff.stderr.on("data", (d) => (err = (err + d.toString()).slice(-2500)));
      ff.on("error", reject);
      ff.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`)),
      );

      (async () => {
        for (let i = 0; i < totalFrames; i++) {
          const t = i / FPS;
          const timing = sectionAt(opts.timings, t);
          const section = byId.get(timing.id);
          if (!section) continue;

          const frame = renderFrameRaw({
            section,
            words: opts.words,
            t,
            sectionStart: timing.start,
            sectionEnd: timing.end,
            // Transparent: the ambient layer is underneath.
            opaque: false,
          });

          // Await drain rather than buffering — 8.3 MB a frame adds up fast.
          if (!ff.stdin.write(frame)) {
            await new Promise((r) => ff.stdin.once("drain", r));
          }
          if (opts.onProgress && i % (FPS * 10) === 0) opts.onProgress(i / totalFrames);
        }
        ff.stdin.end();
      })().catch((e) => {
        ff.stdin.destroy();
        reject(e);
      });
    });

    const video = await readFile(out);
    return {
      video,
      durationSec: opts.durationSec,
      frames: totalFrames,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Bytes one frame occupies on the pipe — exported for the queue's budgeting. */
export const FRAME_BYTES = BYTES_PER_FRAME;
export const FRAME_RATE = FPS;

// ─── A second, smaller encode for size-limited destinations ──────────────────
//
// The master is quality-first and lands around 2 Mbps, which is right for
// YouTube and wrong for Telegram: its Bot API states bots "can currently send
// files of any type of up to 50 MB in size", and the measured 2m08s episode is
// 31.4 MB — so a five-minute episode is roughly 74 MB and would simply be
// refused.
//
// This transcodes the finished master rather than re-rendering frames. Drawing
// is the expensive half of assembly and nothing about it changes, so re-running
// it to produce a smaller file would be pure waste.

// Telegram's ceiling now lives with the other network capabilities, since the
// composer's pre-flight checks need it too. Re-exported so importers here are
// unaffected.
export { TELEGRAM_MAX_BYTES } from "@/lib/social/network-capabilities";
import { TELEGRAM_MAX_BYTES } from "@/lib/social/network-capabilities";

/** Headroom under the limit: container overhead and rate control both overshoot. */
const SIZE_SAFETY = 0.88;

/** Audio bitrate for the compact cut, in bits per second. */
const COMPACT_AUDIO_BPS = 96_000;

/**
 * Below this, video bitrate buys nothing back — the text would smear and the
 * point of the episode is that the text is legible. A video that cannot fit
 * under the cap at this bitrate should be linked to instead of uploaded.
 */
const MIN_VIDEO_BPS = 500_000;

export interface CompactResult {
  video: Buffer;
  bytes: number;
  /** The video bitrate actually targeted. */
  videoBps: number;
  /** False when even the floor bitrate could not fit the budget. */
  withinBudget: boolean;
}

/**
 * Re-encode `master` to sit under `maxBytes`.
 *
 * The bitrate is computed from the episode's real duration rather than guessed,
 * and rate control is capped (`maxrate`/`bufsize`) rather than left to average
 * out — an average-only target overshoots on a long tail, which is precisely
 * where a hard platform limit bites.
 */
export async function makeCompactVariant(
  master: Buffer,
  durationSec: number,
  maxBytes: number = TELEGRAM_MAX_BYTES,
): Promise<CompactResult> {
  const budgetBits = maxBytes * SIZE_SAFETY * 8;
  const wanted = Math.floor(budgetBits / Math.max(1, durationSec)) - COMPACT_AUDIO_BPS;
  const videoBps = Math.max(MIN_VIDEO_BPS, wanted);

  const dir = await mkdtemp(join(tmpdir(), "sp-compact-"));
  try {
    const inFile = join(dir, "master.mp4");
    const outFile = join(dir, "compact.mp4");
    await writeFile(inFile, master);

    await run("ffmpeg", [
      "-y", "-loglevel", "error", "-i", inFile,
      "-c:v", "libx264", "-preset", "veryfast",
      "-b:v", String(videoBps),
      // Cap the peak, not just the average. Flat vector content is cheap for
      // most of a frame and then spikes on a reveal; an uncapped average lets
      // those spikes push the file over a hard limit.
      "-maxrate", String(Math.floor(videoBps * 1.25)),
      "-bufsize", String(videoBps * 2),
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", String(COMPACT_AUDIO_BPS), "-ar", "48000",
      "-movflags", "+faststart",
      outFile,
    ]);

    const video = await readFile(outFile);
    return {
      video,
      bytes: video.length,
      videoBps,
      withinBudget: video.length <= maxBytes && wanted >= MIN_VIDEO_BPS,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Pull a podcast-ready MP3 out of a finished episode.
 *
 * Taken from the assembled master rather than by re-joining the narration parts,
 * so the audio a listener hears is bit-for-bit the audio a viewer hears: the
 * master has already been through `loudnorm` and the per-section gaps the video
 * timing depends on. Re-concatenating the parts would drift from it.
 *
 * 128 kbps mono-safe stereo at 44.1 kHz — the format every podcast client
 * handles without transcoding, and small enough that an hour of talk stays
 * comfortably downloadable on a phone connection.
 */
export async function extractPodcastAudio(master: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "ep-audio-"));
  try {
    const src = join(dir, "master.mp4");
    const out = join(dir, "episode.mp3");
    await writeFile(src, master);
    await run("ffmpeg", [
      "-nostdin", "-y",
      "-i", src,
      "-vn",
      "-c:a", "libmp3lame",
      "-b:a", "128k",
      "-ar", "44100",
      // ID3v2 so clients that read tags find something sensible even before the
      // feed's own metadata reaches them.
      "-write_id3v1", "1",
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Networks whose feed is vertical-first, and so want the 9:16 cut. */
export const VERTICAL_NETWORKS = new Set(["tiktok", "instagram"]);

/**
 * A 9:16 cut of a finished episode, for TikTok and Reels.
 *
 * The master is landscape 1080p. Those feeds are full-screen portrait, so a
 * landscape file is letterboxed into a thin strip in the middle of the screen —
 * accepted, but it looks like a mistake.
 *
 * Cropping is not an option: the compositor puts headings, diagrams and the
 * caption band across the full width, and a centre crop to 1080×1920 would cut
 * away roughly two thirds of every frame, including most of the text the video
 * exists to show. So the frame is scaled to fit the width and centred over a
 * blurred, zoomed copy of itself — the convention these platforms' own editors
 * use, and the only one that keeps every pixel of the content legible.
 *
 * The audio is copied, not re-encoded: it is already normalised, and a second
 * lossy pass would only cost quality.
 */
export async function makeVerticalVariant(master: Buffer): Promise<{ video: Buffer; elapsedMs: number }> {
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), "ep-vert-"));
  try {
    const src = join(dir, "master.mp4");
    const out = join(dir, "vertical.mp4");
    await writeFile(src, master);
    await run("ffmpeg", [
      "-nostdin", "-y",
      "-i", src,
      "-filter_complex",
      // bg: fill the portrait frame and blur it into a backdrop — but blur it
      // SMALL and scale up. Blurring at full 1080x1920 measured 525s for a
      // 3m46s episode, longer than the assembly that produced the master;
      // blurring at 1/8 scale and letting the upscale do the rest is visually
      // the same backdrop for a fraction of the work.
      "[0:v]scale=135:240:force_original_aspect_ratio=increase,crop=135:240,boxblur=6:2," +
        "scale=1080:1920,setsar=1[bg];" +
        // fg: the real frame at full width. -2 keeps the height even, which
        // H.264 requires; an odd height fails the encode outright.
        "[0:v]scale=1080:-2[fg];" +
        "[bg][fg]overlay=(W-w)/2:(H-h)/2[v]",
      "-map", "[v]",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "copy",
      "-movflags", "+faststart",
      out,
    ]);
    return { video: await readFile(out), elapsedMs: Date.now() - started };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
