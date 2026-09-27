#!/usr/bin/env node
// Waltz AI Remix — compose the final video from the source + the generated AI parts (used by
// processRemix in worker/generation-worker.mjs, on linuxg1).
//
// Output = [lead-in] + [source t0..t1 with moments overlaid in place] + [extension], plus a branded
// copy (logo) when the job is watermarked.
//
// Fast path ("splice"): only what changes is re-encoded. Renders are x264 with closed GOPs, so every
// run of whole GOPs that no AI part touches is stream-copied (the segment muxer cuts exactly at
// keyframes), and only the changed spans — lead-in, extension, each moment widened to its surrounding
// keyframes, and the partial GOPs at the trimmed head/tail — are re-encoded with the source's own x264
// settings, which makes their SPS/PPS byte-identical so the concat demuxer can join everything without
// re-encoding. The audio track is built separately (cheap) and muxed in.
// Every assumption is checked (h264, closed GOPs, constant frame rate, identical headers, exact frame
// counts); any failure falls back to the full re-encode (one ffmpeg graph over the whole video).
//
//   node worker/remix-compose.mjs --selftest <src.mp4> [options]   (synthetic AI parts; see selftest())
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { WATERMARK_PATH, wmChain } from "./watermark.mjs";

const exec = promisify(execFile);
// linuxg1 has 4 cores and also serves the website: every ffmpeg here runs at low priority, 3 threads.
const THREADS = String(process.env.REMIX_THREADS ?? 3);
const ffmpeg = async (args) => {
  const t = Date.now(), r = await exec("nice", ["-n", "15", "ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-y", ...args], { maxBuffer: 1 << 26 });
  if (process.env.REMIX_DEBUG) console.log(`[remix] ${((Date.now() - t) / 1000).toFixed(1)}s ffmpeg ${args.join(" ").slice(0, 160)}`);
  return r;
};
const ffprobe = async (args) => (await exec("ffprobe", ["-v", "error", ...args], { maxBuffer: 1 << 28 })).stdout;
const aFmt = "aformat=sample_rates=48000:channel_layouts=stereo";
const f3 = (n) => n.toFixed(3);
const f6 = (n) => n.toFixed(6);

/**
 * @param o.dir         work dir (outputs are written here)
 * @param o.srcPath     source video; o.S = { width, height, fps, duration, hasAudio }
 * @param o.t0, o.t1    source range kept (renders fade in/out: the fades are trimmed off)
 * @param o.lead / o.ext  { file, seconds } | null — AI clips; o.moments [{ file, at, seconds }]
 * @param o.music       { path, off, dur } | null — the render's song, `off` = song time at source t=0
 * @param o.watermark   branded copy wanted; o.srcWatermarked — the source already shows the logo
 * @returns {{ outPath, brandedPath, mode: "splice"|"full", encodedFrames?, copiedFrames? }}
 */
export async function composeRemix(o) {
  const log = o.log ?? console.log;
  if (o.watermark && !existsSync(WATERMARK_PATH)) throw new Error(`watermark image missing at ${WATERMARK_PATH}`);
  // A branded copy of a clean source needs the logo on every frame — nothing can be copied then
  // (in practice: Waltz AI clip sources, which are short anyway).
  if ((!o.watermark || o.srcWatermarked) && process.env.REMIX_SPLICE !== "0") {
    const work = join(o.dir, "splice");
    try {
      return await composeSpliced({ ...o, work });
    } catch (e) {
      if (process.env.REMIX_FALLBACK === "0") throw e;
      log(`[remix] splice not possible (${e.message}) — full re-encode`);
    } finally {
      if (!process.env.REMIX_KEEP) rmSync(work, { recursive: true, force: true });
    }
  }
  return composeFull(o);
}

// Audio for [lead L s][base t0..t1][ext E s] → labels [la][ba][ea] (only the parts present). The lead-in
// plays the song from L s before the first real frame (silence-padded if the render started the song
// later), the extension continues it (wrapping for a looped song), the base keeps the source's audio.
function audioGraph({ srcIdx, hasAudio, musicIdx, off, musicDur, t0, t1, L, E }) {
  const B = t1 - t0;
  let fc = "";
  const labels = [], taps = [];
  // One input can feed only one filter pad — split it for the lead-in and the extension.
  if (musicIdx >= 0) fc += `[${musicIdx}:a]asplit=2[mlead][mext];`;
  if (L) {
    const mStart = off == null ? null : off + t0 - L;
    if (musicIdx >= 0 && mStart != null && mStart > -L + 0.2) {
      const pad = Math.max(0, -mStart);
      fc += `[mlead]atrim=start=${f3(Math.max(0, mStart))}:duration=${f3(L - pad)},asetpts=PTS-STARTPTS,${aFmt}` +
        (pad ? `,adelay=${Math.round(pad * 1000)}:all=1` : "") + `,apad=whole_dur=${f6(L)},atrim=duration=${f6(L)},afade=t=in:st=0:d=1[la];`;
      taps.push("lead");
    } else fc += `anullsrc=r=48000:cl=stereo,atrim=duration=${f6(L)}[la];`;
    labels.push("[la]");
  }
  const fadeBase = E && musicIdx < 0 ? `,afade=t=out:st=${f3(Math.max(0, B - 1))}:d=1` : "";
  fc += hasAudio
    ? `[${srcIdx}:a]atrim=start=${f6(t0)}:end=${f6(t1)},asetpts=PTS-STARTPTS,${aFmt}${fadeBase}[ba];`
    : `anullsrc=r=48000:cl=stereo,atrim=duration=${f6(B)}[ba];`;
  labels.push("[ba]");
  if (E) {
    if (musicIdx >= 0 && off != null) {
      // Where the song is at the extension point. Renders loop a short song (`-ss off -stream_loop
      // -1`): after the first pass it restarts from 0, so wrap past the end (a 9-min render on a
      // 3-min song went silent here in testing).
      const md = musicDur || Infinity;
      let at = off + t1;
      if (at >= md) at = (at - md) % md;
      if (md - at < E) at = 0; // too close to the end for the whole extension: start the song over
      fc += `[mext]atrim=start=${f3(at)}:duration=${f6(E)},asetpts=PTS-STARTPTS,${aFmt},apad=whole_dur=${f6(E)},atrim=duration=${f6(E)},afade=t=out:st=${f3(Math.max(0, E - 1.5))}:d=1.5[ea];`;
      taps.push("ext");
    } else fc += `anullsrc=r=48000:cl=stereo,atrim=duration=${f6(E)}[ea];`;
    labels.push("[ea]");
  }
  for (const tap of ["lead", "ext"]) if (musicIdx >= 0 && !taps.includes(tap)) fc += `[m${tap}]anullsink;`;
  return { fc, labels };
}

// ─── Full re-encode: one ffmpeg graph over the whole video (the original path; the fallback) ──────
async function composeFull(o) {
  const { dir, srcPath, S, t0, t1, lead, ext, music } = o;
  const mom = o.moments;
  const W = S.width - (S.width % 2), H = S.height - (S.height % 2), F = Math.round(S.fps * 1000) / 1000;
  const L = lead ? lead.seconds : 0, E = ext ? ext.seconds : 0, B = t1 - t0;
  const norm = (s) => `fps=${F},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p,trim=duration=${s}`;
  const args = ["-threads", THREADS, "-i", srcPath];
  let idx = 1;
  let fc = `[0:v]trim=start=${t0}:end=${f3(t1)},setpts=PTS-STARTPTS,fps=${F},scale=${W}:${H},setsar=1,format=yuv420p[b0];`;
  mom.forEach((g, i) => {
    args.push("-i", g.file);
    const k = idx++, at = g.at - t0, d = Math.min(g.seconds, B - at);
    fc += `[${k}:v]${norm(d)},format=yuva420p,fade=t=out:st=${f3(Math.max(0, d - 0.35))}:d=0.35:alpha=1,setpts=PTS-STARTPTS+${f3(at)}/TB[m${i}];`;
    fc += `[b${i}][m${i}]overlay=enable='between(t,${f3(at)},${f3(at + d)})':eof_action=pass,format=yuv420p[b${i + 1}];`;
  });
  let musicIdx = -1;
  if (music) { args.push("-i", music.path); musicIdx = idx++; }
  const vparts = [];
  if (lead) {
    args.push("-i", lead.file);
    fc += `[${idx++}:v]${norm(L)},reverse,setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.5[lv];`;
    vparts.push("[lv]");
  }
  vparts.push(`[b${mom.length}]`);
  if (ext) {
    args.push("-i", ext.file);
    fc += `[${idx++}:v]${norm(E)},setpts=PTS-STARTPTS,fade=t=out:st=${f3(Math.max(0, E - 0.7))}:d=0.7[ev];`;
    vparts.push("[ev]");
  }
  const a = audioGraph({ srcIdx: 0, hasAudio: S.hasAudio, musicIdx, off: music?.off ?? null, musicDur: music?.dur, t0, t1, L, E });
  fc += a.fc + vparts.map((v, i) => v + a.labels[i]).join("") + `concat=n=${vparts.length}:v=1:a=1[vout][aout]`;
  // Logo in the SAME pass (clean master + branded copy written together — one decode, no second
  // full encode). A watermarked source already shows its own logo: brand only the AI ranges then.
  const total = L + B + E;
  const ranges = [...(L ? [[0, L]] : []), ...mom.map((g) => [L + g.at - t0, L + g.at - t0 + g.seconds]), ...(E ? [[L + B, total]] : [])];
  const outPath = join(dir, "remix.mp4"), brandedPath = join(dir, "remix-branded.mp4");
  const enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];
  if (o.watermark) {
    const en = o.srcWatermarked ? `:enable='${ranges.map(([p, q]) => `between(t,${f3(p)},${f3(q)})`).join("+")}'` : "";
    fc += `;[vout]split=2[vclean][vpre];[aout]asplit=2[aclean][abrand];` + wmChain("vpre", W, H).replace(":shortest=1", `:shortest=1${en}`);
    args.push("-filter_complex", fc, "-map", "[vclean]", "-map", "[aclean]", ...enc, outPath, "-map", "[out]", "-map", "[abrand]", ...enc, brandedPath);
  } else {
    args.push("-filter_complex", fc, "-map", "[vout]", "-map", "[aout]", ...enc, outPath);
  }
  await ffmpeg(args);
  return { outPath, brandedPath: o.watermark ? brandedPath : null, mode: "full" };
}

// ─── Splice: re-encode only the changed spans, stream-copy the rest ──────────────────────────────

// SPS / PPS (hex) and the x264 SEI text of a file's first video frame.
async function h264Headers(path) {
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-i", path, "-map", "0:v:0", "-c", "copy", "-bsf:v", "h264_mp4toannexb", "-frames:v", "1", "-f", "h264", "-"],
    { encoding: "buffer", maxBuffer: 1 << 27 });
  const b = Buffer.from(stdout), starts = [];
  for (let i = 0; i + 2 < b.length; i++) if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) { starts.push(i + 3); i += 2; }
  const out = { sps: null, pps: null, sei: "" };
  starts.forEach((s, k) => {
    let e = k + 1 < starts.length ? starts[k + 1] - 3 : b.length;
    while (e > s && b[e - 1] === 0) e--;
    const t = b[s] & 0x1f, nal = b.subarray(s, e);
    if (t === 7 && !out.sps) out.sps = nal.toString("hex");
    else if (t === 8 && !out.pps) out.pps = nal.toString("hex");
    else if (t === 6) out.sei += nal.toString("latin1");
  });
  return out;
}

// Frame index + keyframes of the source; throws unless it is h264, closed-GOP x264, constant frame rate.
async function sourceIndex(srcPath) {
  const j = JSON.parse(await ffprobe(["-select_streams", "v:0", "-show_entries",
    "stream=codec_name,time_base,r_frame_rate,color_range,color_space,color_transfer,color_primaries:packet=pts,flags", "-of", "json", srcPath]));
  const st = j.streams?.[0];
  if (st?.codec_name !== "h264") throw new Error(`source codec is ${st?.codec_name ?? "unknown"}`);
  const [tn, td] = String(st.time_base).split("/").map(Number), [fn, fd] = String(st.r_frame_rate).split("/").map(Number);
  if (!tn || !td || !fn || !fd) throw new Error("source timing unreadable");
  const idx = [], keys = new Set();
  for (const p of j.packets ?? []) {
    const f = (Number(p.pts) * tn * fn) / (td * fd), r = Math.round(f);
    if (!Number.isFinite(f) || Math.abs(f - r) > 0.01) throw new Error("source is not constant frame rate");
    idx.push(r);
    if (String(p.flags).includes("K")) keys.add(r);
  }
  idx.sort((a, b) => a - b);
  if (!idx.length || idx.some((v, i) => v !== i)) throw new Error("source frames are not contiguous from 0");
  const h = await h264Headers(srcPath);
  if (!h.sps || !h.pps || !/x264 - core/.test(h.sei)) throw new Error("source is not an x264 stream");
  if (!/open_gop=0/.test(h.sei)) throw new Error("source uses open GOPs");
  // The source's colour tags (they are in the SPS): AI parts are converted to its range and tagged alike.
  const known = (v) => (v && v !== "unknown" ? v : null);
  const range = known(st.color_range);
  const tags = [range && `range=${range}`, known(st.color_primaries) && `color_primaries=${st.color_primaries}`,
    known(st.color_transfer) && `color_trc=${st.color_transfer}`, known(st.color_space) && `colorspace=${st.color_space}`].filter(Boolean);
  // Frame n at exactly n × (1/F): integer timestamps (a float expression like N/F/TB truncates — 122.999
  // became 122 and duplicated a timestamp).
  return { N: idx.length, keys, range, cfr: `settb=${fd}/${fn},setpts=N`, tag: tags.length ? `,setparams=${tags.join(":")}` : "", keyList: [...keys].sort((a, b) => a - b), F: fn / fd, Fr: `${fn}/${fd}`, timescale: td / tn,
    crf: h.sei.match(/crf=([\d.]+)/)?.[1] ?? "20", sps: h.sps, pps: h.pps };
}

const packetCount = async (p) =>
  Number(JSON.parse(await ffprobe(["-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "json", p])).streams?.[0]?.nb_read_packets);

async function composeSpliced(o) {
  const { dir, work, srcPath, S, lead, ext, music } = o;
  mkdirSync(work, { recursive: true });
  const src = await sourceIndex(srcPath);
  const { N, F, Fr, keys, keyList, cfr } = src, W = S.width, H = S.height;
  if (W % 2 || H % 2) throw new Error("odd frame size");
  // Everything in whole frames from here on (source frame i shows at i/F).
  const a0 = Math.min(N, Math.round(o.t0 * F)), a1 = Math.min(N, Math.round(o.t1 * F));
  if (a1 - a0 < 1) throw new Error("empty range");
  const t0 = a0 / F, t1 = a1 / F;
  const nL = lead ? Math.round(lead.seconds * F) : 0, nE = ext ? Math.round(ext.seconds * F) : 0;
  const moms = o.moments.map((g) => { const mf = Math.round(g.at * F); return { ...g, mf, n: Math.min(Math.round(g.seconds * F), a1 - mf) }; })
    .filter((g) => g.n > 0 && g.mf >= a0);

  // Frames that must change, widened to the surrounding keyframes → spans to re-encode.
  const prevK = (f) => { let r = 0; for (const k of keyList) { if (k > f) break; r = k; } return r; };
  const nextK = (f) => keyList.find((k) => k >= f) ?? N;
  const dirty = [];
  if (!keys.has(a0)) dirty.push([a0, a0 + 1]); // trimmed head (inside a GOP)
  for (const g of moms) dirty.push([g.mf, g.mf + g.n]);
  if (a1 < N && !keys.has(a1)) dirty.push([a1 - 1, a1]); // trimmed tail
  const spans = [];
  for (const [s, e] of dirty.map(([s, e]) => [Math.max(a0, prevK(s)), Math.min(a1, nextK(e))]).sort((p, q) => p[0] - q[0])) {
    const last = spans.at(-1);
    if (last && s <= last.e) last.e = Math.max(last.e, e);
    else spans.push({ kind: "enc", s, e });
  }
  const base = [];
  let cur = a0;
  for (const sp of spans) { if (sp.s > cur) base.push({ kind: "copy", s: cur, e: sp.s }); base.push(sp); cur = sp.e; }
  if (cur < a1) base.push({ kind: "copy", s: cur, e: a1 });
  for (const p of base) {
    p.n = p.e - p.s;
    if (p.kind === "copy" && !(keys.has(p.s) && (keys.has(p.e) || p.e === N))) throw new Error(`copy span ${p.s}-${p.e} not on keyframes`);
  }

  // Re-encoded pieces: same encoder settings as the source (→ identical SPS/PPS), exact frame counts.
  // (passthrough: the graph already emits exact CFR timestamps; ffmpeg 7.1's cfr sync dropped a frame)
  const venc = (n) => ["-frames:v", String(n), "-fps_mode", "passthrough", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", src.crf, "-pix_fmt", "yuv420p",
    "-threads", THREADS, "-video_track_timescale", String(src.timescale)];
  const norm = (n) => `fps=${Fr},scale=${W}:${H}:force_original_aspect_ratio=increase${src.range ? `:out_range=${src.range}` : ""},crop=${W}:${H},` +
    `setsar=1,format=yuv420p${src.tag},tpad=stop_mode=clone:stop=${n},trim=end_frame=${n}`; // AI clip → exactly n frames at the source rate
  const at = (fr) => f6((fr - 0.5) / F); // timeline test for frame fr of a piece, centred between frames
  let pieceNo = 0;
  async function encode(inputs, fc, n, logo /* null | "all" | [[from, to) frame ranges] */) {
    const out = join(work, `enc${pieceNo++}.mp4`);
    if (!o.watermark || !logo || (Array.isArray(logo) && !logo.length)) {
      await ffmpeg([...inputs, "-filter_complex", fc, "-map", "[v]", ...venc(n), out]);
      return { file: out, branded: out };
    }
    const outB = out.replace(/\.mp4$/, ".b.mp4");
    const en = logo === "all" ? "" : `:enable='${logo.map(([p, q]) => `between(t,${at(p)},${at(q)})`).join("+")}'`;
    // (overlaying the RGBA logo re-tags the frames as colorspace=gbr: tag them like the source again)
    fc += `;[v]split=2[vc][vpre];` + wmChain("vpre", W, H).replace(":shortest=1", `:shortest=1${en}`).replace(/\[out\]$/, `${src.tag}[out]`);
    await ffmpeg([...inputs, "-filter_complex", fc, "-map", "[vc]", ...venc(n), out, "-map", "[out]", ...venc(n), outB]);
    return { file: out, branded: outB };
  }
  const pieces = [];
  if (lead) {
    const r = await encode(["-i", lead.file], `[0:v]${norm(nL)},reverse,${cfr},fade=t=in:st=0:d=0.5[v]`, nL, "all");
    pieces.push({ kind: "lead", n: nL, ...r });
  }
  for (const p of base) {
    if (p.kind === "copy") { pieces.push(p); continue; }
    // Seek: a span starting on a keyframe starts decoding right there (no discarded GOP); the trimmed
    // head starts inside a GOP, so decode from its keyframe and drop the frames before a0.
    const seek = p.s === 0 ? [] : keys.has(p.s) ? ["-noaccurate_seek", "-ss", f6((p.s + 0.25) / F)] : ["-ss", f6((p.s - 0.5) / F)];
    const inputs = ["-threads", THREADS, ...seek, "-i", srcPath];
    // (fps= is a no-op on these exact timestamps but carries the rate to x264 — ffmpeg 7.1 otherwise
    // encoded at "15360 fps": level 6.2 in the SPS)
    let fc = `[0:v]${cfr},fps=${Fr},trim=end_frame=${p.n},setsar=1,format=yuv420p${src.tag}[b0];`, label = "b0";
    const logo = [];
    moms.filter((g) => g.mf >= p.s && g.mf < p.e).forEach((g, i) => {
      inputs.push("-i", g.file);
      const off = g.mf - p.s;
      fc += `[${i + 1}:v]${norm(g.n)},format=yuva420p,fade=t=out:st=${f3(Math.max(0, g.n / F - 0.35))}:d=0.35:alpha=1,${cfr}+${off}[m${i}];`;
      fc += `[${label}][m${i}]overlay=enable='between(t,${at(off)},${at(off + g.n)})':eof_action=pass,format=yuv420p[b${i + 1}];`;
      label = `b${i + 1}`;
      logo.push([off, off + g.n]);
    });
    const r = await encode(inputs, `${fc}[${label}]null[v]`, p.n, logo);
    pieces.push({ ...p, ...r });
  }
  if (ext) {
    const r = await encode(["-i", ext.file], `[0:v]${norm(nE)},${cfr},fade=t=out:st=${f3(Math.max(0, nE / F - 0.7))}:d=0.7[v]`, nE, "all");
    pieces.push({ kind: "ext", n: nE, ...r });
  }

  // Copied pieces: one stream-copy pass; the segment muxer splits exactly at the listed keyframes.
  const copies = pieces.filter((p) => p.kind === "copy");
  if (copies.length) {
    const cuts = [...new Set(copies.flatMap((p) => [p.s, p.e]))].filter((f) => f > 0 && f < N).sort((a, b) => a - b);
    await ffmpeg(["-i", srcPath, "-map", "0:v:0", "-c", "copy", "-f", "segment",
      ...(cuts.length ? ["-segment_frames", cuts.join(",")] : ["-segment_time", "1000000"]), "-reset_timestamps", "1", join(work, "seg%04d.mp4")]);
    const starts = [0, ...cuts];
    for (const p of copies) { p.file = p.branded = join(work, `seg${String(starts.indexOf(p.s)).padStart(4, "0")}.mp4`); }
  }

  // Verify before joining: every piece has exactly its frames; re-encoded ones carry the source's headers.
  for (const p of pieces) {
    for (const f of new Set([p.file, p.branded])) {
      const n = await packetCount(f);
      if (n !== p.n) throw new Error(`${p.kind} piece has ${n} frames, expected ${p.n}`);
      if (p.kind !== "copy") {
        const h = await h264Headers(f);
        if (h.sps !== src.sps || h.pps !== src.pps) throw new Error(`re-encoded ${p.kind} piece's ${h.sps !== src.sps ? "SPS" : "PPS"} differs from the source's`);
      }
    }
  }

  // Audio: the whole track in one cheap pass, timed to the frame-exact video.
  const audio = join(work, "audio.m4a");
  const aIn = ["-i", srcPath];
  if (music) aIn.push("-i", music.path);
  const a = audioGraph({ srcIdx: 0, hasAudio: S.hasAudio, musicIdx: music ? 1 : -1, off: music?.off ?? null, musicDur: music?.dur, t0, t1, L: nL / F, E: nE / F });
  await ffmpeg([...aIn, "-filter_complex", `${a.fc}${a.labels.join("")}concat=n=${a.labels.length}:v=0:a=1[a]`, "-map", "[a]", "-c:a", "aac", "-b:a", "192k", audio]);

  const total = pieces.reduce((s, p) => s + p.n, 0);
  const mux = async (key, out) => {
    const list = join(work, `${key}.ffconcat`);
    writeFileSync(list, "ffconcat version 1.0\n" + pieces.map((p) => `file '${p[key]}'\nduration ${f6(p.n / F)}\n`).join(""));
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-i", audio, "-map", "0:v", "-map", "1:a", "-c", "copy", "-movflags", "+faststart", out]);
    // Exactly `total` frames, evenly spaced (no duplicated or skipped timestamps at any join).
    const pts = JSON.parse(await ffprobe(["-select_streams", "v:0", "-show_entries", "packet=pts", "-of", "json", out])).packets.map((q) => Number(q.pts)).sort((x, y) => x - y);
    if (pts.length !== total) throw new Error(`joined video has ${pts.length} frames, expected ${total}`);
    const step = pts[1] - pts[0];
    if (!(step > 0) || pts.some((v, i) => i && v - pts[i - 1] !== step)) throw new Error("joined video timestamps are not evenly spaced");
  };
  const outPath = join(dir, "remix.mp4"), brandedPath = join(dir, "remix-branded.mp4");
  await mux("file", outPath);
  if (o.watermark) await mux("branded", brandedPath);
  const encodedFrames = pieces.filter((p) => p.kind !== "copy").reduce((s, p) => s + p.n, 0);
  return { outPath, brandedPath: o.watermark ? brandedPath : null, mode: "splice", encodedFrames, copiedFrames: total - encodedFrames };
}

// ─── Self-test: compose a real source with synthetic AI parts, no DB / AI server needed ──────────
//   node worker/remix-compose.mjs --selftest <src.mp4> [--out DIR] [--lead 5] [--ext 5]
//        [--moments 12.3,200] [--moment-secs 5] [--music song.mp3 --off 1.23] [--wm] [--src-wm] [--full]
// Prints the mode, frame split and wall time; leaves remix.mp4 (+ remix-branded.mp4) in --out.
async function selftest(argv) {
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const flag = (k) => argv.includes(`--${k}`);
  const srcPath = argv[0];
  if (!srcPath || !existsSync(srcPath)) { console.log("usage: node worker/remix-compose.mjs --selftest <src.mp4> [--out DIR] [--lead S] [--ext S] [--moments a,b] [--moment-secs S] [--music F --off S] [--wm] [--src-wm] [--full]"); return; }
  const dir = opt("out", `/tmp/cw-remix-selftest-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const j = JSON.parse(await ffprobe(["-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", srcPath]));
  const v = j.streams.find((s) => s.codec_type === "video"), [fn, fd] = v.r_frame_rate.split("/").map(Number);
  const S = { width: v.width, height: v.height, fps: fn / fd, duration: Number(j.format.duration), hasAudio: j.streams.some((s) => s.codec_type === "audio") };
  const clip = async (name, secs, hue) => {
    const file = join(dir, `${name}.mp4`);
    await ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=24:duration=${secs + 0.05},hue=h=${hue}`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file]);
    return { file, seconds: secs };
  };
  const L = Number(opt("lead", 5)), E = Number(opt("ext", 5)), ms = Number(opt("moment-secs", 5));
  const t0 = L ? 0.6 : 0, t1 = E ? S.duration - 0.8 : S.duration;
  const moments = [];
  for (const [i, m] of String(opt("moments", "")).split(",").filter(Boolean).entries()) moments.push({ ...(await clip(`moment${i}`, ms, 90 * (i + 1))), at: Number(m) });
  const musicFile = opt("music", null);
  const music = musicFile ? { path: musicFile, off: Number(opt("off", 0)), dur: Number((await ffprobe(["-show_entries", "format=duration", "-of", "csv=p=0", musicFile])).trim()) } : null;
  if (flag("full")) process.env.REMIX_SPLICE = "0";
  else process.env.REMIX_FALLBACK = "0"; // a self-test of the splice must not silently fall back
  const lead = L ? await clip("lead", L, 0) : null, ext = E ? await clip("ext", E, 180) : null;
  const started = Date.now();
  const r = await composeRemix({ dir, srcPath, S, t0, t1, lead, ext, moments, music, watermark: flag("wm"), srcWatermarked: flag("src-wm") });
  console.log(JSON.stringify({ ...r, seconds: Math.round((Date.now() - started) / 100) / 10, t0, t1, moments: moments.map((m) => m.at) }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && process.argv[2] === "--selftest") {
  selftest(process.argv.slice(3)).catch((e) => { console.error(e); process.exit(1); });
}
