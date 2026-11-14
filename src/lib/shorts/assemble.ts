import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SectionTiming, WordTiming } from "@/lib/explainer/voice";
import type { ShortScript } from "./script";
import { renderShortFrameRaw, scenesFor, sceneAt, WIDTH, HEIGHT } from "./compositor";

// ─── Building the vertical mp4 ───────────────────────────────────────────────
//
// Deliberately simpler than the explainer assembler, in one way that matters:
// there is **no ambient video layer**. The explainer renders its information
// layer transparent and overlays it on a generated ambient loop, which costs an
// extra input, an overlay filter and a second decode. A short is a flat brand
// card by design — busy motion behind 46px type is the thing that makes a short
// unreadable — so the compositor draws its own opaque background and ffmpeg
// takes a single raw video stream.
//
// That leaves one input for frames and one for narration, which is also why
// this can afford `-crf 20` at 1080×1920 and still finish quickly.

const FPS = 30;

export interface ShortAssembleResult {
  video: Buffer;
  durationSec: number;
  frames: number;
  elapsedMs: number;
}

export async function assembleShort(opts: {
  script: ShortScript;
  narrationParts: Buffer[];
  timings: SectionTiming[];
  words: WordTiming[];
  durationSec: number;
  onProgress?: (fraction: number) => void;
}): Promise<ShortAssembleResult> {
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), "sp-short-"));

  try {
    const audio = await joinNarration(dir, opts.narrationParts);
    const out = join(dir, "short.mp4");

    const scenes = scenesFor(opts.script, opts.timings);
    const totalFrames = Math.ceil(opts.durationSec * FPS);

    await new Promise<void>((resolve, reject) => {
      const ff = spawn(
        "ffmpeg",
        [
          "-y", "-loglevel", "error",
          // 0: the frames, raw RGBA straight off the canvas.
          "-f", "rawvideo", "-pix_fmt", "rgba",
          "-s", `${WIDTH}x${HEIGHT}`, "-framerate", String(FPS), "-i", "-",
          // 1: the narration.
          "-i", audio,
          // Matched to the explainer's loudness so a short and an episode play
          // at the same level back to back. 48 kHz is pinned because loudnorm
          // resamples internally and will otherwise emit 96 kHz.
          "-filter_complex", "[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]",
          "-map", "0:v", "-map", "[a]",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
          // yuv420p needs even dimensions; 1080×1920 already is, but a future
          // size change should fail loudly here rather than produce a green file.
          "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
          // The narration is the authority on length.
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
          const frame = renderShortFrameRaw({ scene: sceneAt(scenes, t), words: opts.words, t });
          // Wait for drain rather than buffering — a frame is 8.3 MB.
          if (!ff.stdin.write(frame)) {
            await new Promise((r) => ff.stdin.once("drain", r));
          }
          if (opts.onProgress && i % (FPS * 5) === 0) opts.onProgress(i / totalFrames);
        }
        ff.stdin.end();
      })().catch((e) => {
        ff.stdin.destroy();
        reject(e);
      });
    });

    return {
      video: await readFile(out),
      durationSec: opts.durationSec,
      frames: totalFrames,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Concatenate the per-sentence narration clips into one track.
 *
 * Re-encoded rather than stream-copied. The MP3s come back from ElevenLabs one
 * sentence at a time and a bare concat of separate MP3 files leaves a frame of
 * padding at every join — across six clips that is an audible stutter, and the
 * word timings the captions are drawn from would drift past it.
 */
async function joinNarration(dir: string, parts: Buffer[]): Promise<string> {
  const files: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const f = join(dir, `n${i}.mp3`);
    await writeFile(f, parts[i]);
    files.push(f);
  }
  const listFile = join(dir, "list.txt");
  await writeFile(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));

  const out = join(dir, "narration.m4a");
  await new Promise<void>((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile,
       "-c:a", "aac", "-b:a", "192k", "-ar", "48000", out],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    ff.stderr.on("data", (d) => (err = (err + d.toString()).slice(-1500)));
    ff.on("error", reject);
    ff.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg concat exited ${c}: ${err.trim()}`))));
  });
  return out;
}

/** The narration sections a short is spoken in, in order. */
export function narrationSections(script: ShortScript): { id: string; heading: string; narration: string }[] {
  return [
    { id: "hook", heading: "Hook", narration: script.hook },
    { id: "problem", heading: "Problem", narration: script.problem },
    ...script.steps.map((s, i) => ({ id: `step${i + 1}`, heading: s.label, narration: s.detail })),
    { id: "payoff", heading: "Payoff", narration: script.payoff },
  ].filter((s) => s.narration.trim());
}
