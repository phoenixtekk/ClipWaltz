// WaltzDeck import (phase 3, 06_ClipWaltz_WaltzDeck_Feature_Spec.md §6): an existing PowerPoint, a PDF or a web
// page → the brief and (for decks) one scene per slide. Pure-ish helpers — no DB; the deck worker
// (worker/deck/jobs.mjs) stores the results.
//   PPTX — slide order from presentation.xml; per slide the title / subtitle / body paragraphs, the speaker notes
//          and the largest picture (becomes a project photo and the scene's media). The owner's own words are kept
//          verbatim (trimmed to the scene limits) — no AI rewrite.
//   PDF  — text per page via poppler's pdftotext -bbox-layout (installed on linuxg1): the heading lines = headline,
//          each paragraph = a point. Scanned PDFs have no text and are refused with a clear message.
//   URL  — fetched with SSRF guards (public addresses only, size and time capped); title, description, headings and
//          body text feed the brief; og:image becomes a photo.
// The brief itself is summarised by the text model (summarizeBrief); every import works without it.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readFileSync } from "node:fs";

const clip = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "").slice(0, max).trim();
/** Cut at a word boundary (a slide bullet never ends mid-word). */
function cut(v, max) {
  const s = clip(v, 10000);
  if (s.length <= max) return s;
  const t = s.slice(0, max + 1);
  const i = t.lastIndexOf(" ");
  return (i > max * 0.6 ? t.slice(0, i) : s.slice(0, max)).replace(/[,;:\-–—]+$/, "") + "…";
}
const decodeXml = (s) =>
  String(s ?? "").replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : e === "apos" ? "'"
    : e[1] === "x" || e[1] === "X" ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(Number(e.slice(1))));

export const LIMITS = { headline: 90, sub: 140, bullets: 6, bullet: 90, voice: 400 };

/** Slide text → scene text + duration (presentation pace: read time for the words, 5–12 s). */
export function sceneFromSlide({ title, sub, body = [], notes }) {
  let headline = cut(title, LIMITS.headline);
  let lines = body.map((b) => clip(b, 400)).filter(Boolean);
  if (!headline && lines.length) headline = cut(lines.shift(), LIMITS.headline);
  let subline = cut(sub, LIMITS.sub);
  // A single line under the headline (a title slide's tagline, one long paragraph) reads better as the subline.
  if (!subline && lines.length === 1) subline = cut(lines.shift(), LIMITS.sub);
  const bullets = lines.slice(0, LIMITS.bullets).map((b) => cut(b, LIMITS.bullet));
  const words = `${headline} ${subline} ${bullets.join(" ")}`.split(/\s+/).filter(Boolean).length;
  const voice = clip(notes, LIMITS.voice);
  const voiceSec = voice ? voice.split(/\s+/).length / 2.8 + 0.4 : 0;
  return {
    text: { headline, sub: subline, bullets },
    voice,
    durationSec: Math.round(Math.max(5, Math.min(12, words / 2.5 + 2), Math.min(15, voiceSec)) * 10) / 10,
  };
}

// ── PPTX ─────────────────────────────────────────────────────────────────────────────────────────

const PIC_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;

function relsMap(xml) {
  const out = {};
  for (const m of String(xml ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) out[id] = decodeXml(target);
  }
  return out;
}
// "../media/image1.png" relative to "ppt/slides/" → "ppt/media/image1.png"
function resolvePath(base, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}
/** Paragraph texts of one shape's txBody (a:p → joined a:t runs, line breaks as spaces). */
const paragraphs = (xml) =>
  [...String(xml).matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p [^>]*>([\s\S]*?)<\/a:p>/g)]
    .map((m) => decodeXml([...(m[1] ?? m[2] ?? "").matchAll(/<a:t>([^<]*)<\/a:t>|<a:br\/>/g)].map((t) => t[1] ?? " ").join("")))
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/** Parse a .pptx buffer → { title, slides: [{ title, sub, body[], notes, image?: { name, bytes } }] }. */
export async function parsePptx(buf) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buf);
  // Zip-bomb guard: a 50 MB upload can declare (or secretly hold) gigabytes. Every entry is streamed with a hard cap
  // (JSZip's own size check only runs after the whole entry is inflated), plus a budget for the whole file.
  let budget = 300 << 20;
  const take = (f, cap, type) => new Promise((resolve, reject) => {
    const declared = f._data?.uncompressedSize;
    if (typeof declared === "number" && declared > cap) return reject(new Error("That presentation has a part that is too large to import."));
    const chunks = [];
    let n = 0, done = false;
    const h = f.internalStream("uint8array");
    h.on("data", (c) => {
      if (done) return;
      n += c.length;
      if (n > cap || n > budget) { done = true; h.pause(); reject(new Error("That presentation is too large to import once unpacked.")); return; }
      chunks.push(Buffer.from(c));
    }).on("error", (e) => { if (!done) { done = true; reject(e); } })
      .on("end", () => {
        if (done) return;
        done = true;
        budget -= n;
        const out = Buffer.concat(chunks);
        resolve(type === "string" ? out.toString("utf8") : out);
      }).resume();
  });
  const read = async (p) => (zip.file(p) ? take(zip.file(p), 20 << 20, "string") : null);
  const pres = await read("ppt/presentation.xml");
  if (!pres) throw new Error("That file isn't a PowerPoint presentation (.pptx).");
  const presRels = relsMap(await read("ppt/_rels/presentation.xml.rels"));
  const sz = /<p:sldSz[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(pres);
  const slideArea = sz ? Number(sz[1]) * Number(sz[2]) : 0;
  const order = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => presRels[m[1]]).filter(Boolean)
    .map((t) => resolvePath("ppt", t));
  const core = await read("docProps/core.xml");
  const docTitle = clip(decodeXml(/<dc:title>([^<]*)<\/dc:title>/.exec(core ?? "")?.[1] ?? ""), 120);
  const slides = [];
  for (const path of order.slice(0, 60)) {
    const xml = await read(path);
    if (!xml) continue;
    const dir = path.slice(0, path.lastIndexOf("/"));
    const rels = relsMap(await read(`${dir}/_rels/${path.slice(dir.length + 1)}.rels`));
    let title = "", sub = "";
    const body = [];
    for (const sp of xml.match(/<p:sp>[\s\S]*?<\/p:sp>|<p:sp [\s\S]*?<\/p:sp>/g) ?? []) {
      const ph = /<p:ph\b[^>]*>/.exec(sp)?.[0];
      const type = ph ? /\btype="(\w+)"/.exec(ph)?.[1] ?? "body" : "other";
      const paras = paragraphs(sp);
      if (!paras.length || ["sldNum", "dt", "ftr", "hdr"].includes(type)) continue;
      if ((type === "title" || type === "ctrTitle") && !title) title = paras.join(" ");
      else if (type === "subTitle" && !sub) sub = paras.join(" ");
      else body.push(...paras);
    }
    // Speaker notes: the notes slide's body placeholder.
    let notes = "";
    const notesTarget = Object.values(rels).find((t) => /notesSlide/i.test(t));
    if (notesTarget) {
      const nx = await read(resolvePath(dir, notesTarget));
      for (const sp of nx?.match(/<p:sp>[\s\S]*?<\/p:sp>|<p:sp [\s\S]*?<\/p:sp>/g) ?? []) {
        if (/<p:ph\b[^>]*type="body"/.test(sp)) notes = paragraphs(sp).join(" ");
      }
    }
    // The biggest picture (≥ 8 % of the slide — skips logos and icons).
    let image = null, best = 0;
    for (const pic of xml.match(/<p:pic>[\s\S]*?<\/p:pic>|<p:pic [\s\S]*?<\/p:pic>/g) ?? []) {
      const rid = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(pic)?.[1];
      const ext = /<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(pic);
      const area = ext ? Number(ext[1]) * Number(ext[2]) : 0;
      const target = rid && rels[rid] ? resolvePath(dir, rels[rid]) : null;
      if (!target || !PIC_EXT.test(target) || !zip.file(target)) continue;
      if (slideArea && area < slideArea * 0.08) continue;
      if (area > best) { best = area; image = target; }
    }
    slides.push({
      title, sub, body, notes,
      image: image ? { name: image.split("/").pop(), bytes: await take(zip.file(image), 25 << 20, "buffer") } : null,
    });
  }
  if (!slides.length) throw new Error("No slides found in that presentation.");
  return { title: docTitle || clip(slides[0].title, 120), slides };
}

// ── PDF ──────────────────────────────────────────────────────────────────────────────────────────

const BULLET = /^\s*(?:[•●▪■◦‣∙·*\-–—]|\d{1,2}[.)])\s+/;

/**
 * One page of `pdftotext -bbox-layout` XHTML → { title, body[] }. Title = the first line plus the lines right under
 * it at the same height (a wrapped heading); each remaining block (paragraph) is one point, split at bullet marks.
 */
export function bboxPageToSlide(pageXml) {
  const blocks = [];
  for (const b of String(pageXml).matchAll(/<block\b[^>]*>([\s\S]*?)<\/block>/g)) {
    const lines = [...b[1].matchAll(/<line\b[^>]*yMin="([\d.]+)"[^>]*yMax="([\d.]+)"[^>]*>([\s\S]*?)<\/line>/g)].map((m) => ({
      y: Number(m[1]), h: Number(m[2]) - Number(m[1]),
      text: decodeXml([...m[3].matchAll(/<word\b[^>]*>([^<]*)<\/word>/g)].map((w) => w[1]).join(" ")).replace(/\s+/g, " ").trim(),
    })).filter((l) => l.text && !/^\d{1,3}$/.test(l.text)); // drop bare page numbers
    if (lines.length) blocks.push(lines);
  }
  if (!blocks.length) return null;
  const flat = blocks.flat();
  const first = flat[0];
  let n = 1;
  while (n < Math.min(flat.length, 3) && Math.abs(flat[n].h - first.h) < first.h * 0.12 && flat[n].y - flat[n - 1].y < first.h * 1.8) n++;
  const title = flat.slice(0, n).map((l) => l.text).join(" ").replace(BULLET, "");
  const body = [];
  let seen = 0;
  for (const lines of blocks) {
    const rest = lines.filter(() => seen++ >= n);
    let cur = "";
    for (const l of rest) {
      if (BULLET.test(l.text) && cur) { body.push(cur); cur = ""; }
      cur = cur ? `${cur} ${l.text}` : l.text;
    }
    if (cur) body.push(cur);
  }
  return { title, body: body.map((b) => b.replace(BULLET, "")).filter(Boolean) };
}

/** Parse a PDF with poppler (pdfinfo + pdftotext -bbox-layout) → { title, slides, pages }. */
export async function parsePdf(file, run) {
  let pages = 0, docTitle = "";
  try {
    const { stdout } = await run("pdfinfo", [file], { maxBuffer: 1 << 20 });
    pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 0);
    docTitle = clip(/^Title:\s+(.+)$/m.exec(stdout)?.[1] ?? "", 120);
  } catch {
    throw new Error("That file isn't a readable PDF.");
  }
  if (!pages) throw new Error("That PDF has no pages.");
  const { stdout } = await run("pdftotext", ["-bbox-layout", "-l", String(Math.min(pages, 60)), "-enc", "UTF-8", file, "-"], { maxBuffer: 32 << 20 });
  const slides = [...stdout.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)].map((m) => bboxPageToSlide(m[1])).filter(Boolean)
    .map((s) => ({ ...s, sub: "", notes: "", image: null }));
  if (!slides.length) throw new Error("No text found in that PDF — is it a scan? (Scanned pages have no text to import.)");
  return { title: docTitle || clip(slides[0].title, 120), slides, pages };
}

// ── URL ──────────────────────────────────────────────────────────────────────────────────────────

/** True for loopback, private, link-local, CGNAT, multicast and reserved addresses (IPv4 + IPv6). */
export function isPrivateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const b = ipv6Bytes(ip);
  if (!b) return true; // unparseable → refuse
  // IPv4 inside IPv6 — mapped ::ffff:a.b.c.d, compatible ::a.b.c.d, NAT64 64:ff9b::/96 — is judged as that IPv4.
  // (URL() rewrites [::ffff:127.0.0.1] to ::ffff:7f00:1, so a string prefix check isn't enough — review 2026-09-29.)
  const zero10 = b.slice(0, 10).every((x) => x === 0);
  const nat64 = b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0);
  if ((zero10 && ((b[10] === 0xff && b[11] === 0xff) || (b[10] === 0 && b[11] === 0))) || nat64) {
    if (zero10 && b[10] === 0 && b.slice(12, 15).every((x) => x === 0) && b[15] <= 1) return true; // :: and ::1
    return isPrivateAddress(b.slice(12).join("."));
  }
  return (b[0] & 0xfe) === 0xfc /* fc00::/7 ULA */ || (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) /* fe80::/10 */ ||
    b[0] === 0xff /* multicast */ || (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) /* doc */;
}

/** An IPv6 address (incl. a trailing dotted IPv4 and "::") → 16 bytes, or null. */
function ipv6Bytes(ip) {
  let s = String(ip).toLowerCase().replace(/%.*$/, "");
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    if (isIP(v4[1]) !== 4) return null;
    const p = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 0xff]; });
}

async function assertPublicUrl(u) {
  let url;
  try { url = new URL(u); } catch { throw new Error("That doesn't look like a web address."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) web addresses can be imported.");
  if (url.username || url.password) throw new Error("Web addresses with a login can't be imported.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Only standard web ports (80/443) can be imported.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error("Couldn't find that website.");
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error("That address isn't a public website.");
  return url;
}

/**
 * GET a public URL: each redirect hop re-checked, 12 s per request, body capped at `maxBytes`. (A DNS rebind
 * between the check and the connect is possible in theory; the worker host has no secrets on its LAN side
 * reachable without credentials, and every hop is re-validated.)
 */
export async function fetchPublic(u, { maxBytes = 2 << 20, accept = "text/html" } = {}) {
  let url = await assertPublicUrl(u);
  for (let hop = 0; hop < 4; hop++) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, {
        redirect: "manual", signal: ctrl.signal,
        headers: { "user-agent": "ClipWaltz-WaltzDeck/1.0 (+https://www.clipwaltz.com)", accept },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        url = await assertPublicUrl(new URL(res.headers.get("location"), url).toString());
        continue;
      }
      if (!res.ok) throw new Error(`The website answered ${res.status}.`);
      const chunks = [];
      let n = 0;
      for await (const c of res.body) {
        n += c.length;
        if (n > maxBytes) { ctrl.abort(); break; }
        chunks.push(c);
      }
      return { url: url.toString(), type: res.headers.get("content-type") ?? "", bytes: Buffer.concat(chunks) };
    } catch (e) {
      if (e.name === "AbortError") throw new Error("The website took too long to answer.");
      throw e;
    } finally {
      clearTimeout(to);
    }
  }
  throw new Error("Too many redirects.");
}

const attr = (tag, name) => decodeXml(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(2).find((x) => x != null) ?? "");
const stripTags = (h) => decodeXml(h.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** HTML → { title, description, siteName, image, headings[], text } (the page's readable parts only). */
export function readPage(html, baseUrl) {
  const h = String(html).replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ");
  const metas = h.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = (key) => {
    const m = metas.find((t) => [attr(t, "property"), attr(t, "name")].some((v) => v.toLowerCase() === key));
    return m ? clip(attr(m, "content"), 500) : "";
  };
  const title = meta("og:title") || clip(stripTags(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1] ?? ""), 200);
  let image = meta("og:image") || meta("twitter:image");
  try { image = image ? new URL(image, baseUrl).toString() : ""; } catch { image = ""; }
  const body = h.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
  const headings = [...body.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => clip(stripTags(m[1]), 160)).filter(Boolean).slice(0, 20);
  const paras = [...body.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => stripTags(m[2])).filter((t) => t.length > 25);
  return {
    title, image,
    description: meta("og:description") || meta("description"),
    siteName: meta("og:site_name"),
    headings,
    text: clip(paras.join("\n"), 6000),
  };
}

// ── Brief ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Ask the text model for the brief fields. `chatJson` is planner.mjs's JSON chat call. Returns
 * { prompt, goal, audience, tone, offer, cta: {text,url} | null } with every field trimmed — or null when the
 * model fails (callers fall back to fallbackBrief).
 */
export async function summarizeBrief(chatJson, model, { source, title, url, digest }) {
  const prompt =
    `Summarise this ${source === "url" ? "web page" : "presentation"} into a brief for a short video or slide deck.\n` +
    `TITLE: "${clip(title, 200)}"${url ? `\nURL: ${url}` : ""}\nCONTENT:\n${clip(digest, 5000)}\n\n` +
    `Return JSON {"prompt":string (2-3 sentences: what it is, for whom, the key message),"goal":string,"audience":string,` +
    `"tone":string (2-3 words),"offer":string ("" unless the content states a concrete offer or price),` +
    `"cta":string ("" unless the content asks the reader to do something, e.g. "Book at example.com")}. ` +
    `Use ONLY facts in the content — never invent numbers, prices or claims.`;
  try {
    // Generous budget: qwen3-vl reasons before answering, and 3000 tokens ran out mid-thought (2026-09-29).
    const { data } = await chatJson(model, prompt, null, { temperature: 0.3, numPredict: 8000, numCtx: 16384, timeoutMs: 600000 });
    const brief = {
      prompt: clip(data.prompt, 2000), goal: clip(data.goal, 200), audience: clip(data.audience, 200),
      tone: clip(data.tone, 100), offer: clip(data.offer, 200),
      cta: clip(data.cta, 120) ? { text: clip(data.cta, 120), ...(url ? { url: clip(url, 300) } : {}) } : null,
    };
    return brief.prompt ? brief : null;
  } catch (e) {
    console.error(`[deck-import] brief summary failed: ${e.message}`);
    return null;
  }
}

export const fallbackBrief = ({ source, title, digest }) => ({
  prompt: clip(`${source === "url" ? "Based on the web page" : "Based on the presentation"} "${clip(title, 120)}": ${clip(digest, 600)}`, 2000),
});

// Diagnostic: `node worker/deck/importer.mjs <file.pptx|file.pdf|url>` prints what an import would create.
if (process.argv[1]?.endsWith("importer.mjs") && process.argv[2]) {
  const a = process.argv[2];
  if (/^https?:/i.test(a)) {
    const r = await fetchPublic(a);
    const p = readPage(r.bytes.toString("utf8"), r.url);
    console.log(JSON.stringify({ ...p, text: p.text.slice(0, 400) }, null, 2));
  } else if (/\.pdf$/i.test(a)) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const r = await parsePdf(a, promisify(execFile));
    console.log(JSON.stringify(r.slides.map((s) => sceneFromSlide(s)), null, 2));
  } else {
    const r = await parsePptx(readFileSync(a));
    console.log(r.title, JSON.stringify(r.slides.map((s) => ({ ...sceneFromSlide(s), image: s.image?.name ?? null })), null, 2));
  }
}
