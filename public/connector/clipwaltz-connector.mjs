#!/usr/bin/env node
// ClipWaltz Connector — lets ClipWaltz use the AI models on YOUR computer (Ollama) to write your videos.
//
//   node clipwaltz-connector.mjs pair      connect this computer to your ClipWaltz account (shows a code to approve)
//   node clipwaltz-connector.mjs           run (after pairing): waits for AI jobs and answers them with your local Ollama
//   node clipwaltz-connector.mjs status    show the saved connection and the Ollama models found
//   node clipwaltz-connector.mjs unpair    forget the connection on this computer (also remove it in ClipWaltz → AI models)
//
// Options: --server https://www.clipwaltz.com   --ollama http://127.0.0.1:11434   --name "My PC"
//
// What it does, and doesn't: it only makes outbound HTTPS requests to ClipWaltz (no ports opened, works behind any
// router), only accepts "llm.chat" jobs, and only sends them to the Ollama address YOU set here, using a model that is
// installed on this computer. It never runs commands, opens files or reaches other addresses. Requires Node.js 18+.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, chmodSync } from "node:fs";
import { homedir, hostname, platform, arch } from "node:os";
import { join } from "node:path";

const VERSION = "0.1.0";
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

async function api(path, { method = "GET", body, timeoutMs = 30_000 } = {}) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "user-agent": `clipwaltz-connector/${VERSION}`,
      ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
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
      saveConfig({ server: SERVER, ollama: OLLAMA, token: r.data.token, connectorId: r.data.connectorId, name: r.data.name });
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
  const r = await api("/api/connector/hello", { method: "POST", body: { version: VERSION, platform: `${platform()}-${arch()}`, models, error } });
  if (r.status === 401) throw Object.assign(new Error(r.data?.error || "not connected"), { fatal: true });
  if (error) log(error);
  return r.data;
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
        if (job.kind !== "llm.chat") throw new Error(`unsupported job type "${job.kind}" — update the Connector`);
        const text = await runChat(job.payload);
        result = { ok: true, text };
        log(`job ${job.id.slice(0, 8)}: ${job.payload.model} answered in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
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
  console.log(`Server:  ${SERVER}\nOllama:  ${OLLAMA}\nName:    ${cfg.name ?? "-"}`);
  try {
    console.log(`Models:  ${(await ollamaModels()).join(", ") || "(none installed)"}`);
  } catch (e) {
    console.log(`Models:  can't reach Ollama (${e.message})`);
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
