#!/usr/bin/env node
// ClipWaltz Connector — lets ClipWaltz use the AI models on YOUR computer (Ollama) to write your videos.
//
//   node clipwaltz-connector.mjs pair      connect this computer to your ClipWaltz account (shows a code to approve)
//   node clipwaltz-connector.mjs           run (after pairing): waits for AI jobs and answers them with your local Ollama
//   node clipwaltz-connector.mjs status    show the saved connection and the Ollama models found
//   node clipwaltz-connector.mjs unpair    forget the connection on this computer (also remove it in ClipWaltz → AI models)
//
// Options: --server https://www.clipwaltz.com   --ollama http://127.0.0.1:11434   --comfy http://127.0.0.1:8188
//          --name "My PC"
//
// What it does, and doesn't: it only makes outbound HTTPS requests to ClipWaltz (no ports opened, works behind any
// router) and accepts two kinds of jobs:
//   • "llm.chat"  → sent to the Ollama address YOU set here, using a model installed on this computer;
//   • "comfy.run" (v0.2) → one of the video TEMPLATES written in this file, run by the ComfyUI address YOU set here. The
//     server only sends values (text, numbers, the job's photo/speech); it can never send nodes, code or a workflow.
// It never runs commands, reads your files or reaches other addresses. Requires Node.js 18+.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, chmodSync } from "node:fs";
import { homedir, hostname, platform, arch } from "node:os";
import { join } from "node:path";

const VERSION = "0.2.0";
const CONFIG_DIR = join(homedir(), ".clipwaltz");
const CONFIG = join(CONFIG_DIR, "connector.json");
const MAX_PROMPT = 400_000;
const MAX_IMAGES = 8;
const MAX_IMAGE_B64 = 8_000_000;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const command = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--"))) ?? "run";
const log = (...m) => console.log(`[${new Date().toLocaleTimeString()}]`, ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}
function saveConfig(c) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // The token is a password for this computer's connection: created owner-only (macOS/Linux; on Windows the file is
  // in the user's own profile). chmod also covers a file that already existed with wider permissions.
  writeFileSync(CONFIG, JSON.stringify(c, null, 2), { mode: 0o600 });
  try {
    chmodSync(CONFIG, 0o600);
  } catch {
    /* Windows */
  }
}

const cfg = loadConfig();
const SERVER = (flag("server") || cfg.server || "https://www.clipwaltz.com").replace(/\/+$/, "");
const OLLAMA = (flag("ollama") || cfg.ollama || "http://127.0.0.1:11434").replace(/\/+$/, "");
const COMFY = (flag("comfy") || cfg.comfy || "http://127.0.0.1:8188").replace(/\/+$/, "");

const authHeaders = () => ({
  "user-agent": `clipwaltz-connector/${VERSION}`,
  ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
});

async function api(path, { method = "GET", body, timeoutMs = 30_000 } = {}) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: { "content-type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

// ── ComfyUI templates (v0.2) ──────────────────────────────────────────────────────────────────────
// Each template is a fixed ComfyUI graph written here. `build` turns the job's checked values into that graph; anything
// out of range is rejected. `needs` lists what must be installed in ComfyUI (node types, and model files that its loader
// nodes list), so ClipWaltz only offers what this computer can run.
const int = (v, lo, hi, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`bad ${name}`);
  return n;
};
const text = (v, max, name) => {
  if (typeof v !== "string" || v.length > max) throw new Error(`bad ${name}`);
  return v;
};
const WAN_NEGATIVE = "static, still image, blurry, low quality, JPEG artifacts, distorted, deformed, extra fingers, watermark, text, subtitles";

const TEMPLATES = {
  // Wan 2.2 TI2V-5B image→video (core ComfyUI nodes). ~8 GB VRAM with ComfyUI's offloading.
  "wan-i2v-v1": {
    label: "Image → video (Wan 2.2 5B)",
    minVramMb: 8000,
    needs: {
      nodes: ["UNETLoader", "CLIPLoader", "VAELoader", "LoadImage", "CLIPTextEncode", "Wan22ImageToVideoLatent", "ModelSamplingSD3", "KSampler", "VAEDecodeTiled", "CreateVideo", "SaveVideo"],
      models: [["UNETLoader", "unet_name", "wan2.2_ti2v_5B_fp16.safetensors"], ["CLIPLoader", "clip_name", "umt5_xxl_fp8_e4m3fn_scaled.safetensors"], ["VAELoader", "vae_name", "wan2.2_vae.safetensors"]],
    },
    files: ["photo"],
    build(v, f) {
      const width = int(v.width, 256, 1280, "width"), height = int(v.height, 256, 1280, "height");
      if (width % 32 || height % 32) throw new Error("bad size");
      const length = int(v.length, 1, 145, "length");
      if ((length - 1) % 4) throw new Error("bad length");
      return {
        3: { class_type: "KSampler", inputs: { seed: int(v.seed, 0, 2 ** 32 - 1, "seed"), steps: int(v.steps ?? 20, 4, 40, "steps"), cfg: 5, sampler_name: "uni_pc", scheduler: "simple", denoise: 1, model: ["48", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["55", 0] } },
        6: { class_type: "CLIPTextEncode", inputs: { text: text(v.prompt ?? "", 2000, "prompt"), clip: ["38", 0] } },
        7: { class_type: "CLIPTextEncode", inputs: { text: [WAN_NEGATIVE, text(v.negativePrompt ?? "", 2000, "negative prompt")].filter(Boolean).join(", "), clip: ["38", 0] } },
        // Tiled decode: a full decode of 121 frames overflows a 10 GB card that also drives the desktop (Windows then
        // spills to system RAM and takes 20+ min — measured 2026-10-14 on an RTX 3080).
        8: { class_type: "VAEDecodeTiled", inputs: { samples: ["3", 0], vae: ["39", 0], tile_size: 256, overlap: 64, temporal_size: 32, temporal_overlap: 8 } },
        37: { class_type: "UNETLoader", inputs: { unet_name: "wan2.2_ti2v_5B_fp16.safetensors", weight_dtype: "fp8_e4m3fn" } },
        38: { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan", device: "default" } },
        39: { class_type: "VAELoader", inputs: { vae_name: "wan2.2_vae.safetensors" } },
        48: { class_type: "ModelSamplingSD3", inputs: { shift: 8, model: ["37", 0] } },
        55: { class_type: "Wan22ImageToVideoLatent", inputs: { width, height, length, batch_size: 1, vae: ["39", 0], start_image: ["56", 0] } },
        56: { class_type: "LoadImage", inputs: { image: f.photo } },
        57: { class_type: "CreateVideo", inputs: { fps: 24, images: ["8", 0] } },
        58: { class_type: "SaveVideo", inputs: { filename_prefix: "clipwaltz/i2v", format: "mp4", codec: "h264", video: ["57", 0] } },
      };
    },
  },
  // Talking photo: ClipWaltz's own node pack "ComfyUI-ClipWaltz" (github.com/phoenixtekk/ComfyUI-ClipWaltz,
  // EchoMimic v3 Flash, Apache-2.0) — the same engine and settings as ClipWaltz's GPUs; long clips in overlapping chunks
  // so 30 s fits a 10 GB card. Its "models" input lists only "ready" once every model file is installed.
  "clipwaltz-talking-v1": {
    label: "Talking photo (ClipWaltz)",
    minVramMb: 8000,
    needs: {
      nodes: ["ClipWaltzTalkingPhoto", "LoadImage", "LoadAudio", "CreateVideo", "SaveVideo"],
      models: [["ClipWaltzTalkingPhoto", "models", "ready"]],
    },
    files: ["photo", "speech"],
    build(v, f) {
      const width = int(v.width, 256, 1024, "width"), height = int(v.height, 256, 1024, "height");
      if (width % 16 || height % 16) throw new Error("bad size");
      const chunk = [65, 81, 97, 113].includes(Number(v.chunkFrames)) ? Number(v.chunkFrames) : 97;
      const maxSeconds = Number(v.maxSeconds);
      if (!(maxSeconds > 0 && maxSeconds <= 30)) throw new Error("bad length");
      return {
        8: { class_type: "LoadImage", inputs: { image: f.photo } },
        9: { class_type: "LoadAudio", inputs: { audio: f.speech } },
        20: {
          class_type: "ClipWaltzTalkingPhoto",
          inputs: { image: ["8", 0], audio: ["9", 0], width, height, seed: int(v.seed, 0, 2 ** 32 - 1, "seed"), max_seconds: maxSeconds, chunk_frames: chunk, steps: 8, models: "ready" },
        },
        24: { class_type: "CreateVideo", inputs: { images: ["20", 0], audio: ["9", 0], fps: ["20", 1] } },
        25: { class_type: "SaveVideo", inputs: { filename_prefix: "clipwaltz/talk", format: "mp4", codec: "h264", video: ["24", 0] } },
      };
    },
  },
};

async function comfy(path, { method = "GET", body, form, timeoutMs = 30_000 } = {}) {
  const res = await fetch(`${COMFY}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: form ?? (body ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ComfyUI ${path} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

/** GPU + which templates this computer's ComfyUI can run (node types installed, model files present, enough VRAM). */
async function comfyStatus() {
  try {
    const stats = await (await comfy("/system_stats", { timeoutMs: 10_000 })).json();
    const dev = (stats.devices ?? []).find((d) => d.type === "cuda") ?? null;
    const gpu = dev ? { name: String(dev.name ?? "").replace(/^cuda:\d+\s*/, "").replace(/\s+:\s+\S+$/, ""), vramMb: Math.round(Number(dev.vram_total) / 2 ** 20), driver: null } : null;
    const info = await (await comfy("/object_info", { timeoutMs: 60_000 })).json();
    const ready = [], missing = {};
    for (const [id, t] of Object.entries(TEMPLATES)) {
      const miss = [];
      for (const n of t.needs.nodes) if (!info[n]) miss.push(`node ${n}`);
      for (const [node, input, file] of t.needs.models) {
        const opts = info[node]?.input?.required?.[input]?.[0];
        if (info[node] && !(Array.isArray(opts) && opts.includes(file))) miss.push(`model ${file}`);
      }
      if (!gpu) miss.push("an NVIDIA GPU");
      else if (gpu.vramMb < t.minVramMb) miss.push(`${Math.round(t.minVramMb / 1024)} GB of GPU memory`);
      if (miss.length) missing[id] = miss;
      else ready.push(id);
    }
    return { gpu, comfy: { ok: true, version: String(stats.system?.comfyui_version ?? ""), error: null, ready, missing } };
  } catch (e) {
    return { gpu: null, comfy: { ok: false, version: null, error: `Can't reach ComfyUI at ${COMFY} (${e.message})`, ready: [], missing: {} } };
  }
}

async function ollamaModels() {
  const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Ollama at ${OLLAMA} answered ${res.status}`);
  const j = await res.json();
  return (j.models ?? []).map((m) => m.name).filter(Boolean);
}

// ── pair ──────────────────────────────────────────────────────────────────────────────────────────
async function pair() {
  const name = flag("name") || hostname() || "My computer";
  const start = await api("/api/connector/pair/start", {
    method: "POST",
    body: { name, platform: `${platform()}-${arch()}`, version: VERSION },
  });
  if (start.status !== 200) throw new Error(start.data?.error || `pairing failed (${start.status})`);
  const { deviceCode, userCode, verifyUrl, interval, expiresIn } = start.data;
  console.log(`\n  To connect "${name}" to ClipWaltz, open this page while signed in, type this code and approve:\n\n    ${verifyUrl}\n\n  Code: ${userCode}   (expires in ${Math.round(expiresIn / 60)} minutes)\n`);
  const until = Date.now() + expiresIn * 1000;
  while (Date.now() < until) {
    await sleep((interval || 3) * 1000);
    const r = await api("/api/connector/pair/poll", { method: "POST", body: { deviceCode } });
    if (r.status === 428) continue;
    if (r.status === 200 && r.data?.token) {
      saveConfig({ server: SERVER, ollama: OLLAMA, comfy: COMFY, token: r.data.token, connectorId: r.data.connectorId, name: r.data.name });
      cfg.token = r.data.token;
      console.log(`  Connected as "${r.data.name}". Saved to ${CONFIG}\n  Now run:  node clipwaltz-connector.mjs\n`);
      return;
    }
    throw new Error(r.data?.error || `pairing failed (${r.status})`);
  }
  throw new Error("The code expired — run pair again.");
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────────
let models = [];
async function hello() {
  let error;
  try {
    models = await ollamaModels();
    if (!models.length) error = `No models installed in Ollama at ${OLLAMA} — e.g. run: ollama pull qwen3:8b`;
  } catch (e) {
    models = [];
    error = `Can't reach Ollama at ${OLLAMA} (${e.message})`;
  }
  const { gpu, comfy: comfyInfo } = await comfyStatus();
  // A computer used only for video has no Ollama: don't report that as its error (writing jobs record their own).
  const reported = comfyInfo.ok && !models.length ? undefined : error;
  const r = await api("/api/connector/hello", {
    method: "POST",
    body: { version: VERSION, platform: `${platform()}-${arch()}`, models, error: reported, gpu, comfy: comfyInfo },
    timeoutMs: 60_000,
  });
  if (r.status === 401) throw Object.assign(new Error(r.data?.error || "not connected"), { fatal: true });
  if (error) log(error);
  if (comfyInfo.ok) {
    const ready = comfyInfo.ready.map((id) => TEMPLATES[id].label);
    if (comfyInfo.ready.join() !== lastReady) {
      log(`ComfyUI ${comfyInfo.version} on ${gpu?.name ?? "no NVIDIA GPU"}${gpu ? ` (${Math.round(gpu.vramMb / 1024)} GB)` : ""} — ready: ${ready.join(", ") || "nothing yet"}`);
      for (const [id, miss] of Object.entries(comfyInfo.missing)) log(`  ${TEMPLATES[id].label} needs: ${miss.join(", ")}`);
      lastReady = comfyInfo.ready.join();
    }
  }
  return r.data;
}
let lastReady = null;

// ── comfy.run (v0.2) ──────────────────────────────────────────────────────────────────────────────
const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A response body read with a running size cap (content-length may be absent or wrong). */
async function readCapped(res, max, what) {
  if (Number(res.headers.get("content-length") ?? 0) > max) throw new Error(`the ${what} is too large`);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    if (size > max) throw new Error(`the ${what} is too large`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function runComfy(job) {
  if (!UUID.test(String(job.id))) throw new Error("bad job id");
  const p = job.payload ?? {};
  const t = Object.hasOwn(TEMPLATES, p.template) ? TEMPLATES[p.template] : null;
  if (!t) throw new Error(`unknown template "${p.template}" — update the Connector`);
  // 1. The job's files: from ClipWaltz into ComfyUI's input folder (under clipwaltz/).
  const files = {};
  for (const name of t.files) {
    const res = await fetch(`${SERVER}/api/connector/jobs/${encodeURIComponent(job.id)}/input/${name}`, { headers: authHeaders(), signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`couldn't download the ${name} (${res.status})`);
    const bytes = await readCapped(res, MAX_INPUT_BYTES, name);
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a", "audio/mpeg": "mp3" }[(res.headers.get("content-type") ?? "").split(";")[0]] ?? "bin";
    const form = new FormData();
    form.append("image", new Blob([bytes]), `${job.id.slice(0, 8)}-${name}.${ext}`);
    form.append("type", "input");
    form.append("subfolder", "clipwaltz");
    form.append("overwrite", "true");
    const up = await (await comfy("/upload/image", { method: "POST", form, timeoutMs: 120_000 })).json();
    files[name] = up.subfolder ? `${up.subfolder}/${up.name}` : up.name;
  }
  // 2. Queue the template's graph.
  const graph = t.build(p.inputs ?? {}, files);
  const { prompt_id: promptId } = await (await comfy("/prompt", { method: "POST", body: { prompt: graph, client_id: `clipwaltz-${job.id}` } })).json();
  log(`job ${job.id.slice(0, 8)}: ${t.label} queued in ComfyUI`);
  // 3. Wait, reporting progress and honouring a cancel from ClipWaltz. Progress = ComfyUI's own step counter when this
  // Node has WebSocket (Node 22+), else an estimate from the expected time. Home GPUs vary a lot: at least an hour.
  const t0 = Date.now();
  const expect = Math.max(30, Number(p.expectSec) || 300) * 1000;
  const deadline = t0 + Math.min(4 * 3600_000, Math.max(60 * 60_000, expect * 6));
  let lastPing = 0;
  let steps = null; // { value, max } of the running sampler, from ComfyUI's websocket
  let ws = null;
  if (typeof WebSocket === "function") {
    try {
      ws = new WebSocket(`${COMFY.replace(/^http/, "ws")}/ws?clientId=clipwaltz-${job.id}`);
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return; // previews are binary
        try {
          const m = JSON.parse(ev.data);
          if (m.type === "progress" && m.data?.prompt_id === promptId && m.data.max > 0) steps = { value: m.data.value, max: m.data.max };
        } catch {
          /* not JSON */
        }
      };
      ws.onerror = () => {};
    } catch {
      ws = null;
    }
  }
  try {
  for (;;) {
    await sleep(3000);
    const hist = await (await comfy(`/history/${promptId}`)).json();
    const entry = hist[promptId];
    if (entry?.status?.status_str === "error") {
      const err = (entry.status.messages ?? []).find((m) => m[0] === "execution_error")?.[1];
      throw new Error(`ComfyUI: ${err?.exception_message?.split("\n")[0] ?? "the workflow failed"}${err?.node_type ? ` (${err.node_type})` : ""}`);
    }
    if (entry?.status?.completed) {
      const outs = Object.values(entry.outputs ?? {}).flatMap((o) => [...(o.images ?? []), ...(o.gifs ?? []), ...(o.videos ?? [])]);
      const vid = outs.find((o) => /\.mp4$/i.test(o.filename ?? ""));
      if (!vid) throw new Error("ComfyUI finished without a video");
      const q = new URLSearchParams({ filename: vid.filename, subfolder: vid.subfolder ?? "", type: vid.type ?? "output" });
      const bytes = await readCapped(await comfy(`/view?${q}`, { timeoutMs: 120_000 }), MAX_OUTPUT_BYTES, "video (over 50 MB)");
      // 4. The video goes to ClipWaltz.
      const up = await fetch(`${SERVER}/api/connector/jobs/${encodeURIComponent(job.id)}/output`, {
        method: "POST", headers: { ...authHeaders(), "content-type": "video/mp4" }, body: bytes, signal: AbortSignal.timeout(300_000),
      });
      if (!up.ok) throw new Error(`upload failed (${up.status}: ${(await up.text()).slice(0, 200)})`);
      log(`job ${job.id.slice(0, 8)}: done in ${Math.round((Date.now() - t0) / 1000)} s (${(bytes.length / 2 ** 20).toFixed(1)} MB)`);
      return;
    }
    if (Date.now() > deadline) {
      await stopPrompt(promptId);
      throw new Error("ComfyUI took too long");
    }
    if (Date.now() - lastPing > 15_000) {
      lastPing = Date.now();
      const progress = steps ? Math.round((steps.value / steps.max) * 90) : Math.min(95, Math.round(((Date.now() - t0) / expect) * 90));
      const r = await api(`/api/connector/jobs/${encodeURIComponent(job.id)}/progress`, { method: "POST", body: { progress } }).catch(() => null);
      if (r?.data?.cancelled) {
        await stopPrompt(promptId);
        throw new Error("cancelled in ClipWaltz");
      }
    }
  }
  } finally {
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
  }
}

/** Remove our prompt from ComfyUI's queue, and interrupt it only if it is the one running (never someone else's). */
async function stopPrompt(promptId) {
  try {
    await comfy("/queue", { method: "POST", body: { delete: [promptId] } });
    const q = await (await comfy("/queue")).json();
    if ((q.queue_running ?? []).some((item) => item[1] === promptId)) await comfy("/interrupt", { method: "POST", body: { prompt_id: promptId } });
  } catch {
    /* best effort */
  }
}

// Streams the reply (NDJSON): a non-streamed Ollama call sends no headers until it is done, and Node drops a request
// whose headers take more than 5 minutes.
async function ollamaChat(body, timeoutMs) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  let buf = "";
  let text = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line);
      if (j.error) throw new Error(`Ollama: ${j.error}`);
      if (j.message?.content) text += j.message.content;
    }
  }
  return text;
}

async function runChat(p) {
  if (typeof p?.model !== "string" || !models.includes(p.model)) throw new Error(`model "${p?.model}" isn't installed on this computer`);
  if (typeof p.prompt !== "string" || p.prompt.length > MAX_PROMPT) throw new Error("bad prompt");
  const images = Array.isArray(p.images) ? p.images : [];
  if (images.length > MAX_IMAGES || images.some((b) => typeof b !== "string" || b.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=]+$/.test(b))) {
    throw new Error("bad images");
  }
  // Only these three, clamped, so a job can't ask this computer for an enormous context or reply.
  const LIMITS = { temperature: [0, 2], num_predict: [1, 32_768], num_ctx: [512, 131_072] };
  const options = {};
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) if (Number.isFinite(p.options?.[k])) options[k] = Math.min(hi, Math.max(lo, p.options[k]));
  const msg = { role: "user", content: p.prompt, ...(images.length ? { images } : {}) };
  const body = { model: p.model, messages: [msg], options, think: false };
  try {
    return await ollamaChat(body, 300_000);
  } catch (e) {
    if (!/think/i.test(e.message)) throw e;
    delete body.think; // a model without a thinking mode can reject the switch
    return await ollamaChat(body, 300_000);
  }
}

async function run() {
  if (!cfg.token) throw new Error("This computer isn't connected yet. Run:  node clipwaltz-connector.mjs pair");
  log(`ClipWaltz Connector ${VERSION} — "${cfg.name}" → ${SERVER}, Ollama ${OLLAMA}`);
  await hello();
  log(`Ready. Models: ${models.join(", ") || "(none)"} — waiting for jobs (Ctrl+C to stop).`);
  let lastHello = Date.now();
  let backoff = 2000;
  for (;;) {
    try {
      if (Date.now() - lastHello > 60_000) {
        await hello();
        lastHello = Date.now();
      }
      const r = await api("/api/connector/jobs/next", { timeoutMs: 45_000 });
      if (r.status === 401) throw Object.assign(new Error(r.data?.error || "not connected"), { fatal: true });
      backoff = 2000;
      if (r.status === 204 || !r.data?.id) continue;
      const job = r.data;
      const t0 = Date.now();
      let result;
      try {
        if (job.kind === "comfy.run") {
          await runComfy(job);
          result = { ok: true, text: "" };
        } else if (job.kind === "llm.chat") {
          const text = await runChat(job.payload);
          result = { ok: true, text };
          log(`job ${job.id.slice(0, 8)}: ${job.payload.model} answered in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        } else throw new Error(`unsupported job type "${job.kind}" — update the Connector`);
        lastHello = 0; // re-check ComfyUI soon after a GPU job
      } catch (e) {
        result = { ok: false, error: String(e.message).slice(0, 300) };
        log(`job ${job.id.slice(0, 8)} failed: ${result.error}`);
      }
      await api(`/api/connector/jobs/${encodeURIComponent(job.id)}/result`, { method: "POST", body: result, timeoutMs: 60_000 });
    } catch (e) {
      if (e.fatal) throw e;
      log(`Connection problem (${e.message}) — retrying in ${Math.round(backoff / 1000)} s`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

async function status() {
  console.log(`Config:  ${existsSync(CONFIG) ? CONFIG : "(not paired)"}`);
  console.log(`Server:  ${SERVER}\nOllama:  ${OLLAMA}\nComfyUI: ${COMFY}\nName:    ${cfg.name ?? "-"}`);
  try {
    console.log(`Models:  ${(await ollamaModels()).join(", ") || "(none installed)"}`);
  } catch (e) {
    console.log(`Models:  can't reach Ollama (${e.message})`);
  }
  const { gpu, comfy: c } = await comfyStatus();
  if (!c.ok) return console.log(`Video:   ${c.error}`);
  console.log(`GPU:     ${gpu ? `${gpu.name}, ${Math.round(gpu.vramMb / 1024)} GB` : "no NVIDIA GPU found by ComfyUI"}`);
  for (const [id, t] of Object.entries(TEMPLATES)) {
    console.log(`  ${c.ready.includes(id) ? "ready  " : "missing"}  ${t.label}${c.missing[id] ? ` — needs ${c.missing[id].join(", ")}` : ""}`);
  }
}

process.on("SIGINT", () => {
  log("Stopped.");
  process.exit(0);
});

try {
  if (command === "pair") await pair();
  else if (command === "status") await status();
  else if (command === "unpair") {
    rmSync(CONFIG, { force: true });
    console.log("Forgotten on this computer. Also remove it under ClipWaltz → AI models → Your computers.");
  } else if (command === "run") await run();
  else console.log("Commands: pair | run | status | unpair");
} catch (e) {
  // exitCode, not process.exit(): exiting while a fetch socket is still closing trips a libuv assertion on Windows.
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
}
