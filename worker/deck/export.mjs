// WaltzDeck slide exports (phase 3, 06_ClipWaltz_WaltzDeck_Feature_Spec.md §6): the storyboard as a PDF or an
// editable PowerPoint, built from the SAME HTML templates as the video (worker/deck/text-layer.mjs) so a slide
// looks like its scene. Runs in the render worker on the AI box (headless Chromium + ffmpeg).
//   PDF  — each scene printed by Chromium as one page (real, selectable text; media still underneath), merged.
//   PPTX — each scene's picture layer (media still + panels, scrims, bullets dots, logo — text hidden) as the slide
//          background, then one EDITABLE text box per text run, placed where Chromium drew it (same font, size,
//          colour, alignment). The scene's narration line becomes the speaker notes.
// Slide geometry: the long side is 1280 CSS px = 13.33 in (PowerPoint's 16:9 widescreen); text is laid out at
// that size and the templates scale everything from the width, so proportions match the video exactly.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sceneHtml } from "./text-layer.mjs";
import { isMotionLayout, motionHtml, settledAt } from "./motion.mjs";
import { vfFrame } from "./frame.mjs";
import { cardRect, mediaArea, normBackdrop } from "./backdrop.mjs";

const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const LONG = 1280; // layout px on the long side (96 px = 1 in)
const WM_SCALE = 0.154; // keep in sync with render-worker.mjs

const hasText = (sc) => sc.text_mode !== "none" && !!(sc.text?.headline || sc.text?.sub || sc.text?.bullets?.length);
const vfRotate = (deg) => (deg === 90 ? "transpose=clock," : deg === 180 ? "hflip,vflip," : deg === 270 ? "transpose=cclock," : "");
const mimeOf = (ext) => (ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");

/** "rgb(243, 238, 255)" / "rgba(…)" → "F3EEFF" (pptxgenjs colour). */
function hexOf(css) {
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(css ?? "");
  return m ? [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("").toUpperCase() : "FFFFFF";
}
/** First family of a computed font-family list: "'Montserrat', sans-serif" → "Montserrat". */
const familyOf = (css) => String(css ?? "").split(",")[0].replace(/["']/g, "").trim() || "Arial";

/**
 * Build one export. `io` comes from the render worker: { sql, download(key, file), uploadFile(key, file, type),
 * ffmpeg(args), probe(file), dims(aspect), watermarkPath }. Returns { key, bytes, slides }. With `outFile`
 * (diagnostic), writes there instead of uploading.
 */
export async function buildDeckExport({ projectId, format, watermark, exportId }, dir, io, { outFile } = {}) {
  const { sql } = io;
  const [project] = await sql`select * from projects where id = ${projectId}`;
  if (!project || project.kind !== "deck") throw new Error("not a WaltzDeck project");
  const scenes = await sql`select * from deck_scenes where project_id = ${projectId} order by order_index asc`;
  if (!scenes.length) throw new Error("no storyboard scenes — plan the video first");
  const ids = [...new Set(scenes.map((s) => s.asset_id).filter(Boolean))];
  const assets = ids.length
    ? await sql`select * from assets where id in ${sql(ids)} and project_id = ${projectId} and upload_state = 'uploaded'
        and (source_format is null or conversion_state = 'ready')`
    : [];
  const byId = new Map(assets.map((a) => [a.id, a]));

  // Brand kit (same mapping as loadRenderInputs in render-worker.mjs) + logo as a data URL.
  let brand = {};
  if (project.brand_kit_id) {
    const [bk] = await sql`select * from brand_kits where id = ${project.brand_kit_id}`;
    if (bk) {
      const colors = Array.isArray(bk.colors_json) ? bk.colors_json : [];
      const fonts = bk.fonts_json ?? {};
      brand = { primary: colors[0], secondary: colors[1], headingFont: fonts.heading, bodyFont: fonts.body, logoKey: bk.logo_key };
    }
  }
  if (brand.logoKey) {
    try {
      const ext = brand.logoKey.split(".").pop().toLowerCase();
      const lf = join(dir, `brand-logo.${ext}`);
      await io.download(brand.logoKey, lf);
      brand.logoDataUrl = `data:${mimeOf(ext)};base64,${readFileSync(lf).toString("base64")}`;
    } catch (e) {
      console.warn(`[deck-export] brand logo unavailable: ${e.message}`);
    }
  }
  // Backdrops (worker/deck/backdrop.mjs): the scene's own, else the deck default, else the brand gradient. AI images
  // as data URLs, downloaded once.
  const deckState = project.deck ?? {};
  const aiImages = new Map();
  const backdropOf = async (sc) => {
    const b = normBackdrop(sc.background) ?? normBackdrop(deckState.brief?.backdrop) ?? { style: "brand", intensity: "balanced", seed: 0 };
    if (b.style !== "ai") return b;
    const img = (deckState.backdrops ?? []).find((x) => x.id === b.imageId);
    if (!img) return { style: "brand", intensity: b.intensity, seed: b.seed };
    if (!aiImages.has(img.id)) {
      try {
        const f = join(dir, `backdrop-${img.id}.jpg`);
        await io.download(img.key, f);
        aiImages.set(img.id, `data:image/jpeg;base64,${readFileSync(f).toString("base64")}`);
      } catch (e) {
        console.warn(`[deck-export] AI backdrop ${img.id} unavailable: ${e.message}`);
        aiImages.set(img.id, null);
      }
    }
    const url = aiImages.get(img.id);
    return url ? { ...b, imageUrl: url, tone: img.tone, grid: img.grid } : { style: "brand", intensity: b.intensity, seed: b.seed };
  };
  const wmDataUrl = watermark && existsSync(io.watermarkPath)
    ? `data:image/png;base64,${readFileSync(io.watermarkPath).toString("base64")}` : null;

  // Geometry: stills at the video size (sharp on a projector), layout at LONG px on the long side.
  const [VW, VH] = io.dims(project.aspect);
  const k = LONG / Math.max(VW, VH);
  const W = Math.round(VW * k), H = Math.round(VH * k);
  const short = Math.min(W, H);
  const safeBottom = wmDataUrl ? Math.round(short * 0.03 * 2 + short * WM_SCALE * (278 / 438)) : 0;

  // One still per scene with media: the photo, or the video frame in the middle of the scene's window.
  const srcs = new Map();
  const stills = [];
  for (const [i, sc] of scenes.entries()) {
    const a = sc.asset_id ? byId.get(sc.asset_id) : null;
    if (!a) { stills.push(null); continue; }
    try {
      if (!srcs.has(a.id)) {
        const ext = a.converted_key ? "mp4" : (a.original_name?.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "") || "bin";
        const f = join(dir, `src-${srcs.size}.${ext}`);
        await io.download(a.converted_key ?? a.storage_key, f);
        srcs.set(a.id, { file: f, dur: a.kind === "video" ? (await io.probe(f)) || Number(a.duration_sec) || 0 : 0 });
      }
      const src = srcs.get(a.id);
      // Zoomed out below fill: the whole picture (fit, uncropped) becomes a card on the backdrop.
      const card = Number(sc.frame?.zoom) < 1;
      const out = join(dir, `still-${i}.${card ? "png" : "jpg"}`);
      const vf = card
        ? `${vfRotate(a.rotation)}scale=${VW}:${VH}:force_original_aspect_ratio=decrease,setsar=1`
        : `${vfRotate(a.rotation)}${vfFrame(sc.frame, VW, VH)}scale=${VW}:${VH}:force_original_aspect_ratio=increase,crop=${VW}:${VH},setsar=1`;
      if (a.kind === "video") {
        const d = Math.max(0.1, Number(sc.duration_sec) || 3);
        const at = sc.in_sec != null ? Number(sc.in_sec) + d / 2 : src.dur * 0.4;
        const t = Math.max(0, Math.min(Math.max(0, src.dur - 0.1), at));
        await io.ffmpeg(["-ss", t.toFixed(2), "-i", src.file, "-frames:v", "1", "-vf", vf, "-q:v", "3", out]);
      } else {
        await io.ffmpeg(["-i", src.file, "-frames:v", "1", "-vf", vf, "-q:v", "3", out]);
      }
      const buf = readFileSync(out);
      stills.push(card
        ? { dataUrl: `data:image/png;base64,${buf.toString("base64")}`, rect: cardRect(VW / VH, buf.readUInt32BE(16) / buf.readUInt32BE(20), Number(sc.frame.zoom), mediaArea(sc.layout, VW >= VH)) }
        : `data:image/jpeg;base64,${buf.toString("base64")}`);
    } catch (e) {
      console.warn(`[deck-export] scene ${i + 1}: no still (${e.message}) — slide uses the brand background`);
      stills.push(null);
    }
  }

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"] });
  try {
    // 1.5× device pixels: PPTX backgrounds at 1920 px wide (PDF text stays vector either way).
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5 });
    const page = await ctx.newPage();
    const slides = [];
    for (const [i, sc] of scenes.entries()) {
      const still = stills[i];
      if (isMotionLayout(sc.layout)) {
        // Animated scene: one frame where everything has arrived, the scene's photo / video frame under an overlay
        // layout. A picture slide (no editable text boxes) — the words are part of the artwork.
        const dur = Number(sc.duration_sec) || 4;
        const media = typeof still === "string" ? still : still?.dataUrl ?? null;
        await page.setContent(motionHtml({ layout: sc.layout, text: hasText(sc) ? sc.text : {}, W, H, brand, dur, over: !!media }), { waitUntil: "load" });
        await page.evaluate(async ({ t, media }) => {
          await document.fonts.ready;
          if (media && getComputedStyle(document.body).backgroundColor === "rgba(0, 0, 0, 0)") {
            const img = document.createElement("img");
            img.src = media;
            Object.assign(img.style, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover" });
            document.body.prepend(img);
            await img.decode().catch(() => {});
          }
          window.render(t);
        }, { t: settledAt(dur), media });
        if (format === "pdf") slides.push({ pdf: await page.pdf({ width: `${W}px`, height: `${H}px`, printBackground: true, pageRanges: "1", margin: { top: "0", right: "0", bottom: "0", left: "0" } }) });
        else slides.push({ bg: await page.screenshot({ type: "jpeg", quality: 88 }), runs: [], notes: String(sc.voice ?? "").trim() });
        continue;
      }
      const card = !still;
      const mediaCard = still && typeof still === "object" ? still : null;
      await page.setContent(sceneHtml({
        layout: sc.layout, text: hasText(sc) ? sc.text : {}, W, H, brand, card, safeBottom, still: true, bgDataUrl: mediaCard ? null : still, wmDataUrl,
        backdrop: card || mediaCard ? await backdropOf(sc) : null, mediaCard,
      }), { waitUntil: "load" });
      await page.evaluate(async () => { await document.fonts.ready; window.__doFit(); });
      if (format === "pdf") {
        slides.push({ pdf: await page.pdf({ width: `${W}px`, height: `${H}px`, printBackground: true, pageRanges: "1", margin: { top: "0", right: "0", bottom: "0", left: "0" } }) });
      } else {
        const runs = await page.evaluate(() => window.__measure());
        await page.addStyleTag({ content: ".h,.s,li>span{color:transparent !important;text-shadow:none !important}" });
        const bg = await page.screenshot({ type: "jpeg", quality: 88 });
        slides.push({ bg, runs, notes: String(sc.voice ?? "").trim() });
      }
    }
    await ctx.close();

    const file = outFile ?? join(dir, `deck.${format}`);
    if (format === "pdf") {
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.create();
      doc.setTitle(project.title || "WaltzDeck");
      doc.setCreator("ClipWaltz WaltzDeck");
      for (const s of slides) {
        const one = await PDFDocument.load(s.pdf);
        const [p] = await doc.copyPages(one, [0]);
        doc.addPage(p);
      }
      writeFileSync(file, await doc.save());
    } else {
      writeFileSync(file, await buildPptx(slides, { W, H, title: project.title }));
    }
    if (outFile) return { key: null, file, slides: slides.length };
    const key = `exports/${projectId}/deck-${exportId}.${format}`;
    await io.uploadFile(key, file, format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    return { key, file, slides: slides.length };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Slides → .pptx bytes. Coordinates: CSS px ÷ 96 = inches; font px × 0.75 = pt. */
async function buildPptx(slides, { W, H, title }) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WALTZDECK", width: W / 96, height: H / 96 });
  pptx.layout = "WALTZDECK";
  pptx.title = title || "WaltzDeck";
  pptx.company = "Made with ClipWaltz";
  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.background = { data: `image/jpeg;base64,${s.bg.toString("base64")}` };
    for (const r of s.runs) {
      // PowerPoint's text engine measures a little wider than Chromium; a few % of slack keeps the same line breaks.
      const slack = Math.min(r.w * 0.06, W - r.w);
      const x = r.align === "center" ? r.x - slack / 2 : r.align === "right" ? r.x - slack : r.x;
      // Chromium's own line breaks (worker/deck/text-layer.mjs __measure), one paragraph run per line.
      const lines = r.lines?.length ? r.lines : [r.text];
      const runs = lines.map((t, li) => ({ text: t, options: li < lines.length - 1 ? { breakLine: true } : {} }));
      slide.addText(runs, {
        x: Math.max(0, x) / 96, y: r.y / 96, w: (r.w + slack) / 96, h: Math.max(r.h, r.lineHeight) / 96,
        fontFace: familyOf(r.font), fontSize: Math.round(r.size * 0.75 * 10) / 10, bold: r.weight >= 600,
        color: hexOf(r.color), align: r.align, valign: "top", margin: 0, wrap: true, fit: "none",
        lineSpacing: Math.round(r.lineHeight * 0.75 * 10) / 10,
      });
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  return pptx.write({ outputType: "nodebuffer" });
}
