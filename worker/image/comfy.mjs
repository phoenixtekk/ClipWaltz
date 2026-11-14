// Waltz Image renderer: text → picture on the ComfyUI box 192.168.166.183 (owner decision D1, 2026-11-14 — the box
// Social Publishing already renders on). Ported from SP `src/lib/image-gen.ts`: the style tails, the base negative, the
// Ollama prompt-writer (think:false, so a reasoning model answers instead of deliberating), the Flux-vs-SDXL sampler
// switch and the submit → poll /history → GET /view loop. Dropped in the port: SP's per-network art settings, the
// rotation decks and the IPAdapter merge — none of them exist in ClipWaltz.
//
// The picture never carries words: BASE_NEGATIVE asks the model for no text, and the compositor (compose.mjs) draws the
// headline afterwards. The output is scaled + centre-cropped to the preset's exact pixel size.
//
// Env: IMAGE_COMFYUI_URL (default http://192.168.166.183:8188), IMAGE_COMFYUI_CKPT (default flux1-schnell-fp8),
//      IMAGE_COMFYUI_STEPS, OLLAMA_URL + IMAGE_PROMPT_MODEL (prompt-writer; optional — the brief is used as-is without).
import { fitCover } from "./compose.mjs";
import { imageFormat, imageStyle } from "./presets.mjs";

export const COMFY_URL = (process.env.IMAGE_COMFYUI_URL || "http://192.168.166.183:8188").replace(/\/$/, "");
export const COMFY_CKPT = process.env.IMAGE_COMFYUI_CKPT || "flux1-schnell-fp8.safetensors";
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://192.168.166.182:11434").replace(/\/$/, "");
const PROMPT_MODEL = process.env.IMAGE_PROMPT_MODEL || "qwen3.8:27b";

const QUALITY_TAIL = "high quality, highly detailed, sharp focus, professional composition";
const BASE_NEGATIVE = "text, words, letters, watermark, logo, signature, blurry, lowres, low quality, jpeg artifacts, deformed, disfigured, extra limbs";

/**
 * Is the box able to render right now? SP learned (2026-08-31) that a listed checkpoint proves nothing: a crashed GPU
 * context keeps listing models and accepting prompts while executing none. `/system_stats` 500s in that state, and a
 * queue with work pending but nothing running is the other signature.
 */
export async function comfyImageStatus() {
  const stats = await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!stats) return { ok: false, reason: "The image server is not answering." };
  if (!stats.ok) return { ok: false, reason: `The image server reported HTTP ${stats.status} for its own status (its GPU may need a restart).` };
  const q = await fetch(`${COMFY_URL}/queue`, { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (q && (q.queue_running?.length ?? 0) === 0 && (q.queue_pending?.length ?? 0) > 0) {
    return { ok: false, reason: "The image server has work waiting and nothing running, so it is stuck." };
  }
  return { ok: true };
}

/** The AI Box turns a brief into one concise text-to-image prompt. Falls back to the brief itself. */
export async function writeImagePrompt(brief, styleKey) {
  const style = imageStyle(styleKey);
  const text = String(brief ?? "").trim().slice(0, 1500);
  const system =
    `You convert a brief for a social media image into ONE concise text-to-image prompt for ${style.medium}. ` +
    "Describe the subject, mood, lighting and composition vividly. Bright, well-lit, clear subject. " +
    "No text, words, letters, logos or brand names in the image. Leave calm space for a headline. " +
    "Return ONLY the prompt, one paragraph, under 60 words.";
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PROMPT_MODEL,
        stream: false,
        think: false,
        // Generous: a reasoning model that ignores `think:false` still has room to answer (global AI Box rule).
        options: { num_predict: 2000, temperature: 0.8 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const d = await res.json();
    const p = String(d?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (p) return p.slice(0, 1200);
  } catch {
    /* fall through */
  }
  return text;
}

function workflow({ positive, negative, seed, ckpt, steps, cfg, width, height, sampler, scheduler, prefix }) {
  return {
    "3": { class_type: "KSampler", inputs: { seed, steps, cfg, sampler_name: sampler, scheduler, denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } },
    "5": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: positive, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: negative, clip: ["4", 1] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: prefix, images: ["8", 0] } },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Render one image. Returns { png (exact preset size), seed, ckpt, prompt, model: { width, height } }.
 *
 * opts: { prompt, style, format, seed?, jobId?, isCancelled?: () => Promise<boolean>, onProgress?: (pct) => void,
 *         timeoutMs? }
 * Throws on failure (the generation worker marks the job failed, which refunds its credits).
 */
export async function renderComfyImage(opts) {
  const fmt = imageFormat(opts.format);
  const style = imageStyle(opts.style);
  const ckpt = COMFY_CKPT;
  const isFlux = /flux/i.test(ckpt);
  const steps = Number(process.env.IMAGE_COMFYUI_STEPS) || (isFlux ? 6 : 30);
  const seed = Number.isSafeInteger(opts.seed) && opts.seed >= 0 ? opts.seed : Math.floor(Math.random() * 2 ** 32);
  const positive = [String(opts.prompt ?? "").trim(), style.positive, QUALITY_TAIL].filter(Boolean).join(", ");
  const negative = `${BASE_NEGATIVE}, ${style.negative}`;
  const graph = workflow({
    positive, negative, seed, ckpt, steps,
    cfg: isFlux ? 1.0 : 6.5,
    width: fmt.gen.width, height: fmt.gen.height,
    sampler: isFlux ? "euler" : "dpmpp_2m",
    scheduler: isFlux ? "simple" : "karras",
    prefix: `clipwaltz/image-${String(opts.jobId ?? seed).replace(/[^\w-]/g, "").slice(0, 40)}`,
  });

  const submit = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: `clipwaltz-${seed}` }),
    signal: AbortSignal.timeout(20_000),
  });
  const sj = await submit.json().catch(() => ({}));
  if (!submit.ok || !sj.prompt_id) {
    const why = sj?.error?.message || sj?.error || `HTTP ${submit.status}`;
    throw new Error(`The image server refused the job: ${String(typeof why === "string" ? why : JSON.stringify(why)).slice(0, 200)}`);
  }
  const promptId = sj.prompt_id;
  const deadline = Date.now() + (opts.timeoutMs ?? 6 * 60_000);
  let polls = 0;
  while (Date.now() < deadline) {
    await sleep(1500);
    polls++;
    if (opts.isCancelled && polls % 2 === 0 && (await opts.isCancelled())) {
      await fetch(`${COMFY_URL}/queue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [promptId] }) }).catch(() => {});
      return null;
    }
    opts.onProgress?.(Math.min(85, 20 + polls * 4));
    const h = await fetch(`${COMFY_URL}/history/${promptId}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => ({}));
    const entry = h?.[promptId];
    if (entry?.status?.status_str === "error") {
      const msg = (entry.status.messages ?? []).find((m) => m[0] === "execution_error")?.[1]?.exception_message;
      throw new Error(`The image render failed on the server${msg ? `: ${String(msg).slice(0, 200)}` : "."}`);
    }
    const img = Object.values(entry?.outputs ?? {}).flatMap((o) => o.images ?? [])[0];
    if (!img) continue;
    const view = await fetch(
      `${COMFY_URL}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? "")}&type=${encodeURIComponent(img.type ?? "output")}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (!view.ok) throw new Error(`Couldn't fetch the finished image (HTTP ${view.status}).`);
    const raw = Buffer.from(await view.arrayBuffer());
    const png = await fitCover(raw, fmt.width, fmt.height);
    return { png, seed, ckpt, prompt: positive, model: { width: fmt.gen.width, height: fmt.gen.height } };
  }
  throw new Error("The image render timed out.");
}
