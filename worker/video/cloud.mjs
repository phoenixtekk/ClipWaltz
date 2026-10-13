// Cloud video adapters for Waltz AI (Phase C1). One shape for every vendor:
//   submitCloud(model, apiKey, job) → taskId · pollCloud(model, apiKey, taskId) → { state, url?, error? }
//   cancelCloud(model, apiKey, taskId) · downloadOutput(url) → Buffer · testVideoKey(provider, apiKey)
// Request/response fields follow each vendor's own docs (checked 2026-10-13):
//   Kling   https://kling.ai/document-api/api/video/3-0-omni/{text,image}-to-video  (Bearer API key, api-singapore)
//   Runway  https://docs.dev.runwayml.com/api  (+ @runwayml/sdk types)  X-Runway-Version: 2024-11-06
//   MiniMax https://platform.minimax.io/docs/api-reference/video-generation-v2-{create,query}.md
// Base URLs can be overridden (VIDEO_BASE_KLING / _RUNWAY / _MINIMAX) only to test against a local mock.

const BASE = {
  kling: process.env.VIDEO_BASE_KLING || "https://api-singapore.klingai.com",
  runway: process.env.VIDEO_BASE_RUNWAY || "https://api.dev.runwayml.com",
  minimax: process.env.VIDEO_BASE_MINIMAX || "https://api.minimax.io",
};
const MAX_OUTPUT_BYTES = 500 * 1024 * 1024;
const RUNWAY_RATIO = { "16:9": "1280:720", "9:16": "720:1280", "1:1": "960:960" };
const FALLBACK_PROMPT = "Natural, smooth camera and subject motion.";

/** Key-free error text (vendor errors can echo request details). */
export function videoErrorText(e, apiKey) {
  let msg = String(e?.message ?? e ?? "unknown error");
  if (apiKey && apiKey.length >= 8) msg = msg.split(apiKey).join("•••");
  return msg.slice(0, 400);
}

async function call(provider, apiKey, method, path, body) {
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  if (provider === "runway") headers["x-runway-version"] = "2024-11-06";
  const res = await fetch(`${BASE[provider]}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, ok: res.ok, json, text };
}

const fail = (provider, r) =>
  new Error(`${provider} ${r.status}: ${(r.json?.message || r.json?.error || r.json?.failure || r.text || "").toString().slice(0, 300)}`);

/**
 * job = { task: "text_to_video" | "image_to_video", prompt, image: { b64, mime } | null, aspect, durationSec, seed }
 */
export async function submitCloud(model, apiKey, job) {
  const prompt = (job.prompt || "").trim() || FALLBACK_PROMPT;
  const t2v = job.task === "text_to_video";

  if (model.provider === "kling") {
    const contents = [{ type: "prompt", text: prompt.slice(0, 2500) }];
    // Kling: "URL or Base64" — raw base64 assumed (format not specified; verify on the first real-key test).
    if (!t2v) contents.push({ type: "first_frame", url: job.image.b64 });
    const r = await call("kling", apiKey, "POST", t2v ? "/text-to-video/kling-3.0" : "/image-to-video/kling-3.0", {
      contents,
      settings: { resolution: "720p", duration: job.durationSec, audio: "off", multi_shot: false, ...(t2v ? { aspect_ratio: job.aspect } : {}) },
      options: { watermark_info: { enabled: false } },
    });
    if (!r.ok || r.json?.code !== 0 || !r.json?.data?.id) throw fail("Kling", r);
    return String(r.json.data.id);
  }

  if (model.provider === "runway") {
    const runwayModel = model.id === "runway-gen4_turbo" ? "gen4_turbo" : "gen4.5";
    const body = {
      model: runwayModel,
      promptText: prompt.slice(0, 1000),
      ratio: RUNWAY_RATIO[job.aspect] ?? "1280:720",
      duration: job.durationSec,
      ...(Number.isSafeInteger(job.seed) && job.seed >= 0 && job.seed <= 4294967295 ? { seed: job.seed } : {}),
      ...(t2v ? {} : { promptImage: `data:${job.image.mime};base64,${job.image.b64}` }),
    };
    const r = await call("runway", apiKey, "POST", t2v ? "/v1/text_to_video" : "/v1/image_to_video", body);
    if (!r.ok || !r.json?.id) throw fail("Runway", r);
    return String(r.json.id);
  }

  if (model.provider === "minimax") {
    const content = [{ type: "text", text: prompt.slice(0, 7000) }];
    if (!t2v) content.push({ type: "image_url", url: `data:${job.image.mime};base64,${job.image.b64}`, role: "first_frame" });
    const r = await call("minimax", apiKey, "POST", "/v2/video_generation", {
      model: "MiniMax-H3-Max",
      content,
      resolution: model.id.endsWith("768p") ? "768P" : "480P",
      duration: job.durationSec,
      ...(t2v ? { ratio: job.aspect } : {}),
    });
    if (!r.ok || !r.json?.task_id) throw fail("MiniMax", r);
    return String(r.json.task_id);
  }
  throw new Error(`unknown video provider ${model.provider}`);
}

/** → { state: "running" | "done" | "failed", url?, error? } */
export async function pollCloud(model, apiKey, taskId) {
  if (model.provider === "kling") {
    const r = await call("kling", apiKey, "GET", `/tasks?task_ids=${encodeURIComponent(taskId)}`);
    if (!r.ok || r.json?.code !== 0) return { state: "running", transient: fail("Kling", r).message };
    const t = Array.isArray(r.json.data) ? r.json.data.find((x) => String(x.id) === taskId) ?? r.json.data[0] : null;
    if (!t) return { state: "running" };
    if (t.status === "succeeded") {
      const v = (t.outputs ?? []).find((o) => o.type === "video");
      return v?.url ? { state: "done", url: v.url } : { state: "failed", error: "Kling finished without a video" };
    }
    if (t.status === "failed") return { state: "failed", error: t.message || "Kling failed" };
    return { state: "running" };
  }
  if (model.provider === "runway") {
    const r = await call("runway", apiKey, "GET", `/v1/tasks/${encodeURIComponent(taskId)}`);
    if (!r.ok) return r.status === 404 ? { state: "failed", error: "Runway task not found" } : { state: "running", transient: fail("Runway", r).message };
    const t = r.json;
    if (t.status === "SUCCEEDED") return t.output?.[0] ? { state: "done", url: t.output[0] } : { state: "failed", error: "Runway finished without a video" };
    if (t.status === "FAILED") return { state: "failed", error: t.failure || t.failureCode || "Runway failed" };
    if (t.status === "CANCELLED") return { state: "failed", error: "cancelled at Runway" };
    return { state: "running" };
  }
  if (model.provider === "minimax") {
    const r = await call("minimax", apiKey, "GET", `/v2/query/video_generation/${encodeURIComponent(taskId)}`);
    if (!r.ok) return { state: "running", transient: fail("MiniMax", r).message };
    const t = r.json?.task;
    if (t?.status === "succeeded") return t.content?.url ? { state: "done", url: t.content.url } : { state: "failed", error: "MiniMax finished without a video" };
    if (t?.status === "failed" || t?.status === "cancelled") return { state: "failed", error: t.error?.message || `MiniMax ${t.status}` };
    return { state: "running" };
  }
  throw new Error(`unknown video provider ${model.provider}`);
}

/** Best effort: only Runway documents a cancel (DELETE /v1/tasks/{id}). */
export async function cancelCloud(model, apiKey, taskId) {
  if (model.provider === "runway") await call("runway", apiKey, "DELETE", `/v1/tasks/${encodeURIComponent(taskId)}`).catch(() => {});
}

export async function downloadOutput(url) {
  if (!/^https?:\/\//.test(url)) throw new Error("bad output URL");
  const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_OUTPUT_BYTES) throw new Error("output too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_OUTPUT_BYTES) throw new Error("output too large");
  return buf;
}

/**
 * Free key check (no video is made): ask for a task that doesn't exist. 401/403 = the vendor rejected the key;
 * anything else means the key was accepted.
 */
export async function testVideoKey(provider, apiKey) {
  const path = { kling: "/tasks?task_ids=0", runway: "/v1/tasks/00000000-0000-4000-8000-000000000000", minimax: "/v2/query/video_generation/0" }[provider];
  if (!path) throw new Error("unknown provider");
  const r = await call(provider, apiKey, "GET", path);
  if (r.status === 401 || r.status === 403) throw new Error(`the key was rejected (${r.status})`);
  return true;
}
