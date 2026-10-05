// Proof (2026-10-04): generate Wan 2.2 TI2V-5B text-to-video clips straight through the AISERVER wrapper,
// bypassing the app, to see how far the GPU node gets on Invideo-style hero shots.
// Usage: AISERVER_API_TOKEN=… node scripts/proof/wan.mjs <shots.json> <outDir>
// shots.json: [{ id, prompt, negative?, width?, height?, seconds?, steps?, seed? }]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const URL = (process.env.AISERVER_API_URL ?? "http://192.168.166.158:8189").replace(/\/$/, "");
const H = { authorization: `Bearer ${process.env.AISERVER_API_TOKEN ?? ""}` };
const [shotsFile, out] = process.argv.slice(2);
if (!shotsFile || !out) throw new Error("usage: wan.mjs <shots.json> <outDir>");
mkdirSync(out, { recursive: true });
const shots = JSON.parse(readFileSync(shotsFile, "utf8"));
const frames = (s) => 4 * Math.round((Math.min(12, Math.max(1, s)) * 24 - 1) / 4) + 1;
const NEG = "text, letters, words, watermark, logo, blurry, low quality, distorted, deformed hands, extra fingers, jpeg artifacts";

async function one(s) {
  const file = join(out, `${s.id}.mp4`);
  if (existsSync(file) && !process.env.FORCE) return { id: s.id, skipped: true };
  const t0 = Date.now();
  const res = await fetch(`${URL}/jobs`, {
    method: "POST", headers: { ...H, "content-type": "application/json" },
    body: JSON.stringify({ workflow: "wan-text-to-video-v1", inputs: {
      prompt: s.prompt, width: s.width ?? 1280, height: s.height ?? 704, length: frames(s.seconds ?? 5),
      seed: s.seed ?? Math.floor(Math.random() * 2 ** 32), negative_prompt: s.negative ?? NEG, steps: s.steps ?? null,
    } }),
  });
  if (!res.ok) throw new Error(`${s.id}: /jobs ${res.status} ${(await res.text()).slice(0, 300)}`);
  const id = (await res.json()).job_id;
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await (await fetch(`${URL}/jobs/${id}`, { headers: H })).json();
    if (st.status === "failed") throw new Error(`${s.id}: ${st.error}`);
    if (st.status === "completed") {
      const o = st.outputs[0];
      const dl = await fetch(`${URL}/outputs/${o.subfolder ? `${o.subfolder}/` : ""}${o.filename}`, { headers: H });
      writeFileSync(file, Buffer.from(await dl.arrayBuffer()));
      const r = { id: s.id, sec: Math.round((Date.now() - t0) / 1000) };
      console.log(JSON.stringify(r));
      return r;
    }
  }
}

const results = await Promise.allSettled(shots.map(one));
for (const r of results) if (r.status === "rejected") console.log("FAILED", r.reason.message);
