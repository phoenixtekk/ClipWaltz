// Proof helper: one PNG per template at chosen times, for a quick look before rendering video.
// Usage: node scripts/proof/preview.mjs <outDir> [chromePath]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { templates } from "./motion.mjs";
import { SCENES } from "./storyboard.mjs";

const [out, exe] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: exe || process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
const W = 1920, H = 1080;
for (const s of SCENES) {
  for (const layer of [s.motion, s.overlay, s.split && { ...s.split.center, w: 600, h: 1000 }].filter(Boolean)) {
    const params = { W: layer.w ?? W, H: layer.h ?? H, dur: s.minDur ?? 5, ...layer.params };
    const p = await browser.newPage({ viewport: { width: params.W, height: params.H } });
    await p.setContent(templates[layer.template](params), { waitUntil: "load" });
    for (const t of [params.dur * 0.3, params.dur * 0.85]) {
      await p.evaluate((x) => window.render(x), t);
      await p.screenshot({ path: join(out, `${s.id}-${layer.template}-${t.toFixed(1)}.png`) });
    }
    await p.close();
  }
}
await browser.close();
console.log("ok");
