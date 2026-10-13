// Outside AI models for writing & planning (FEATURES "AI models"). The built-in model is the self-hosted Ollama box
// (planner.mjs); an admin can also turn on Claude, ChatGPT, DeepSeek and Gemini — with ClipWaltz's own key
// ("platform") and/or a key each user brings ("own") — per plan. This module is shared by the generation worker
// (runs deck jobs through the user's chosen model) and the app (the admin/user "Test" buttons), so it is plain JS.
//
// API facts (checked against vendor docs 2026-10-13):
// - Claude: official Anthropic SDK, streamed; thinking can't be turned off on current models, so no temperature;
//   `fallbacks: "default"` (beta server-side-fallback-2026-07-01) re-runs a declined request on another Claude model.
// - OpenAI: Chat Completions with `max_completion_tokens` (reasoning models reject `max_tokens` and custom
//   temperature) and JSON mode `response_format: { type: "json_object" }`.
// - DeepSeek: OpenAI-compatible at https://api.deepseek.com, `max_tokens` (default 8K), JSON mode, images on
//   deepseek-flash as image_url data URIs.
// - Gemini: OpenAI-compatible at https://generativelanguage.googleapis.com/v1beta/openai/, images as data URIs;
//   its docs list neither a token-limit parameter nor json_object, so neither is sent (the reply's JSON is extracted).
import { createDecipheriv, createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const LLM_PROVIDERS = {
  anthropic: { label: "Claude", vendor: "Anthropic", model: "claude-opus-5-5", keyHint: "sk-ant-…" },
  openai: { label: "ChatGPT", vendor: "OpenAI", model: "gpt-6-astra", keyHint: "sk-…" },
  deepseek: { label: "DeepSeek", vendor: "DeepSeek", model: "deepseek-flash", baseURL: "https://api.deepseek.com", keyHint: "sk-…" },
  gemini: { label: "Gemini", vendor: "Google", model: "gemini-3.8-flash", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", keyHint: "AIza…" },
};
export const LLM_IDS = Object.keys(LLM_PROVIDERS);
export const TIERS = ["free", "plus", "pro"];
/** app_settings key holding the admin's per-provider settings. */
export const LLM_SETTINGS_KEY = "llm_providers";
/** Jobs per user per day (UTC) on ClipWaltz's own key, unless the admin sets another number. */
export const DEFAULT_DAILY_LIMIT = 30;
/** Claude models that accept the server-side refusal fallback. */
const CLAUDE_FALLBACK = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

// Same format as src/lib/cloud/crypto.ts ("enc1:<iv>:<tag>:<ct>", AES-256-GCM, key = sha256(TOKEN_ENC_KEY)).
export function decryptSecret(stored) {
  if (!stored) return null;
  if (!stored.startsWith("enc1:")) return stored; // dev without TOKEN_ENC_KEY stores plaintext
  const k = process.env.TOKEN_ENC_KEY;
  if (!k) throw new Error("TOKEN_ENC_KEY is not set — can't read a stored AI key");
  const [iv, tag, data] = stored.slice(5).split(":");
  const d = createDecipheriv("aes-256-gcm", createHash("sha256").update(k).digest(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

const mimeOf = (b64) => (b64.startsWith("iVBOR") ? "image/png" : b64.startsWith("UklGR") ? "image/webp" : "image/jpeg");

/**
 * One prompt (+ optional base64 images) → the model's reply text. `target` = { provider, apiKey, model }.
 * Throws on any API error, refusal or empty reply; the caller decides whether to fall back.
 */
export async function llmText(target, prompt, images = [], { maxTokens = 8000, timeoutMs = 300000, temperature = 0.3 } = {}) {
  const meta = LLM_PROVIDERS[target.provider];
  if (!meta) throw new Error(`Unknown AI provider "${target.provider}"`);
  if (!target.apiKey) throw new Error(`No API key for ${meta.label}`);
  const model = target.model || meta.model;

  if (target.provider === "anthropic") {
    const client = new Anthropic({ apiKey: target.apiKey, timeout: timeoutMs, maxRetries: 2 });
    const content = [
      ...images.map((data) => ({ type: "image", source: { type: "base64", media_type: mimeOf(data), data } })),
      { type: "text", text: prompt },
    ];
    const params = {
      model,
      max_tokens: Math.max(16000, maxTokens), // room for thinking + the JSON reply
      messages: [{ role: "user", content }],
      ...(/^claude-(fable|mythos|opus|sonnet|haiku)-5/.test(model) ? { output_config: { effort: "medium" } } : {}),
      ...(CLAUDE_FALLBACK.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    };
    const msg = await client.beta.messages.stream(params).finalMessage();
    if (msg.stop_reason === "refusal") throw new Error(`${meta.label} declined this request`);
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!text.trim()) throw new Error(`${meta.label} returned an empty reply (stop: ${msg.stop_reason})`);
    return text;
  }

  const client = new OpenAI({ apiKey: target.apiKey, baseURL: meta.baseURL, timeout: timeoutMs, maxRetries: 2 });
  const content = images.length
    ? [{ type: "text", text: prompt }, ...images.map((data) => ({ type: "image_url", image_url: { url: `data:${mimeOf(data)};base64,${data}` } }))]
    : prompt;
  const body = { model, messages: [{ role: "user", content }] };
  if (target.provider === "openai") Object.assign(body, { max_completion_tokens: Math.max(16000, maxTokens), response_format: { type: "json_object" } });
  if (target.provider === "deepseek") Object.assign(body, { max_tokens: maxTokens, temperature, response_format: { type: "json_object" } });
  const r = await client.chat.completions.create(body);
  const text = r.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error(`${meta.label} returned an empty reply (finish: ${r.choices?.[0]?.finish_reason ?? "?"})`);
  return text;
}

/** A tiny real call to check a key + model work. Returns the measured round trip in ms. */
export async function testLlm(target) {
  const t0 = Date.now();
  const text = await llmText(target, 'Reply with exactly this JSON object and nothing else: {"ok": true}', [], { maxTokens: 4000, timeoutMs: 60000 });
  if (!/"ok"\s*:\s*true/.test(text)) throw new Error(`Unexpected reply: ${text.slice(0, 120)}`);
  return Date.now() - t0;
}

/** Readable, key-free error text (vendor SDK errors can echo request details). Pass the key to strip it exactly. */
export function llmErrorText(e, apiKey) {
  const status = e?.status ? `${e.status} ` : "";
  let msg = `${status}${String(e?.error?.error?.message || e?.error?.message || e?.message || e || "unknown error")}`;
  if (apiKey && apiKey.length >= 8) msg = msg.split(apiKey).join("•••");
  return msg.replace(/(sk-|sk-ant-|AIza)[A-Za-z0-9_\-]{6,}/g, "$1•••").slice(0, 300);
}

// Effective plan — mirrors src/lib/tier.ts getEffectiveTier (latest subscription wins if active/trialing and not
// expired; an inactive one = free; no row = user.plan). Keep the two in sync.
async function tierOf(sql, userId) {
  const [s] = await sql`select tier, status, current_period_end from subscriptions where user_id = ${userId} order by updated_at desc limit 1`;
  if (s) {
    const active = s.status === "active" || s.status === "trialing";
    const notExpired = !s.current_period_end || new Date(s.current_period_end).getTime() > Date.now();
    return active && notExpired ? s.tier || "free" : "free";
  }
  const [u] = await sql`select plan from "user" where id = ${userId}`;
  return u?.plan || "free";
}

/**
 * The outside model a user's AI writing should use, or null for the built-in model. Checked at job time, so an admin
 * turning a provider off (or a plan change) takes effect on the next job. Returns
 * { provider, apiKey, model, visionModel, source, keyId }.
 */
export async function resolveLlm(sql, userId) {
  if (!userId) return null;
  const [pref] = await sql`select writing_provider, source from ai_prefs where user_id = ${userId}`;
  const provider = pref?.writing_provider;
  if (!provider || !LLM_PROVIDERS[provider]) return null;
  const [row] = await sql`select value from app_settings where key = ${LLM_SETTINGS_KEY}`;
  const cfg = row?.value?.[provider];
  if (!cfg?.enabled || !(cfg.plans ?? []).includes(await tierOf(sql, userId))) return null;
  const meta = LLM_PROVIDERS[provider];
  if (pref.source === "own") {
    if (!cfg.allowOwnKey) return null;
    const [k] = await sql`select id, key_enc, model from user_ai_keys where user_id = ${userId} and provider = ${provider}`;
    if (!k) return null;
    const model = k.model || cfg.model || meta.model;
    return { provider, apiKey: decryptSecret(k.key_enc), model, visionModel: k.model || cfg.visionModel || model, source: "own", keyId: k.id };
  }
  if (!cfg.platformKeyEnc) return null;
  // Daily cap on jobs a user may run on ClipWaltz's key (admin setting); over it, the built-in model takes over.
  const limit = Number(cfg.dailyLimit) > 0 ? Number(cfg.dailyLimit) : DEFAULT_DAILY_LIMIT;
  const day = new Date().toISOString().slice(0, 10);
  const counted = await sql`update ai_prefs
    set platform_jobs = case when platform_day = ${day} then platform_jobs + 1 else 1 end, platform_day = ${day}
    where user_id = ${userId} and (platform_day is distinct from ${day} or platform_jobs < ${limit})
    returning platform_jobs`;
  if (!counted.length) {
    console.log(`[llm] ${userId} reached today's ${limit}-job limit on ClipWaltz's ${meta.label} key — built-in model`);
    return null;
  }
  const model = cfg.model || meta.model;
  return { provider, apiKey: decryptSecret(cfg.platformKeyEnc), model, visionModel: cfg.visionModel || model, source: "platform" };
}

/** Remember the last failure / success so the user (own key) or admin (platform key) can see it. */
export async function noteLlmResult(sql, target, error) {
  try {
    if (target.source === "own" && target.keyId) {
      if (error) await sql`update user_ai_keys set last_error = ${error}, last_error_at = now(), updated_at = now() where id = ${target.keyId}`;
      else await sql`update user_ai_keys set last_used_at = now() where id = ${target.keyId}`;
    } else if (target.source === "platform") {
      const v = { [target.provider]: error ? { lastError: error, at: new Date().toISOString() } : { lastOkAt: new Date().toISOString() } };
      await sql`insert into app_settings (key, value) values ('llm_provider_status', ${sql.json(v)})
                on conflict (key) do update set value = app_settings.value || ${sql.json(v)}, updated_at = now()`;
    }
  } catch (e) {
    console.warn("[llm] could not record result:", e.message);
  }
}
