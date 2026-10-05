// WaltzDeck animated scenes (Explainer): motion-graphics layouts drawn by Chromium from HTML, one frame at a time.
// Every page exposes `render(t)` (t = seconds) — each frame is a pure function of t, so the render (render-worker.mjs via
// text-layer.mjs renderMotion), the editor preview (a sandboxed iframe in src/components/deck/scene-frame.tsx) and the
// slide exports (export.mjs, one settled frame) all draw the same thing. No Node imports — the app bundles this.
//
// Variety (owner, 2026-10-05: "never similar videos unless asked"): a deck has a LOOK (6 art directions: background,
// palette, surfaces, shadows, particles) and a SEED; every scene's variant comes from hash(seed, scene id, layout) —
// motion style, arrangement, icons, entrance. A new plan or "Shuffle" picks a new seed, so the same storyboard renders
// differently; the same seed renders identically (preview = render = export).
//
// Scene text → layout:
//   mg-orbit    headline                              icons orbiting a hub (phone / laptop / orb)
//   mg-swarm    headline                              alerts piling onto a hub, a counter climbing
//   mg-words    headline (+ sub)                      big words with an entrance style (over media too)
//   mg-logo     headline = name, sub = tagline        name reveal (brand logo above, if any)
//   mg-chat     headline = chat name, bullets = "Name: message (Channel)", "Me: …" (over media too)
//   mg-fanout   headline, bullets = channels          one message branching out and back
//   mg-end      headline = name, sub, bullets[0] = web address / CTA (over media too)
//   mg-steps    headline, bullets = 2-4 steps         numbered steps
//   mg-features headline, bullets = 3-6 features      icon cards
//   mg-compare  headline, bullets "Before: …" / "After: …" (or "Without:" / "With:")   two sides
//   mg-browser  headline, sub, bullets = 2-4 items    a website / app screen being shown

export const MOTION_LAYOUTS = ["mg-orbit", "mg-swarm", "mg-words", "mg-logo", "mg-chat", "mg-fanout", "mg-end", "mg-steps", "mg-features", "mg-compare", "mg-browser"];
/** Layouts that sit over the scene's media when it has some (transparent page, a veil for legibility). */
export const OVER_MEDIA_LAYOUTS = ["mg-words", "mg-chat", "mg-end"];
export const isMotionLayout = (l) => MOTION_LAYOUTS.includes(l);
export const LOOKS = [
  { key: "neon", label: "Neon space" }, { key: "clean", label: "Clean light" }, { key: "bold", label: "Bold gradient" },
  { key: "paper", label: "Flat paper" }, { key: "grid", label: "Tech grid" }, { key: "sunset", label: "Warm sunset" },
];
const LOOK_KEYS = LOOKS.map((l) => l.key);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c : d);
const cssFont = (f, fallback) => `'${String(f || fallback).replace(/[^A-Za-z0-9 -]/g, "").slice(0, 40) || fallback}', sans-serif`;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
/** A logo the page may load: an inline image (render / export / editor preview). */
const okLogo = (u) => (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(u ?? "") ? u : null);

// ── Seeded choices ────────────────────────────────────────────────────────────────────────────────
function hash32(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, pick: (arr) => arr[Math.floor(next() * arr.length)], range: (lo, hi) => lo + next() * (hi - lo), shuffle: (arr) => { const c = [...arr]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; } };
}
/** A look for a deck: the chosen one, or (auto) one picked from the seed. */
export function resolveLook(look, seed = 0) { return LOOK_KEYS.includes(look) ? look : LOOK_KEYS[hash32(`look:${seed}`) % LOOK_KEYS.length]; }

// ── Icons (Lucide paths, ISC licence) ─────────────────────────────────────────────────────────────
const G = {
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.2"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  chart: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  dollar: '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  smartphone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  tablet: '<rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><line x1="12" x2="12.01" y1="18" y2="18"/>',
};
const ICON_KEYS = Object.keys(G).filter((k) => k !== "x" && k !== "check");
const svg = (k, size, color = "#fff") => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${G[k] ?? G.sparkles}</svg>`;
/** An icon for a word: channels, and common feature words. */
function iconFor(label, i) {
  const l = String(label).toLowerCase();
  // Devices first ("iPhone" must not match the handset icon).
  const map = [[/laptop|notebook|macbook/, "laptop"], [/iphone|smartphone|mobile|android|cell/, "smartphone"], [/tablet|ipad/, "tablet"],
    [/computer|desktop|\bpcs?\b|monitor|server|device|endpoint|workstation/, "monitor"], [/sms|text|phone|call/, "phone"], [/mail/, "mail"], [/team|slack|discord|channel/, "hash"], [/chat|whats|messag|telegram|signal/, "chat"],
    [/video|zoom|meet/, "video"], [/web|site|online|global|world/, "globe"], [/secur|safe|privac|protect/, "shield"], [/lock|login|password/, "lock"],
    [/fast|speed|instant|quick/, "zap"], [/time|hour|minute|schedul|remind/, "clock"], [/calendar|date|book|event/, "calendar"],
    [/price|cost|pay|money|budget|save/, "dollar"], [/report|analytic|insight|track|chart|data/, "chart"], [/cloud|sync|backup/, "cloud"],
    [/love|care|health|family/, "heart"], [/review|rating|favorite|quality/, "star"], [/setting|custom|control/, "sliders"],
    [/location|map|near|local/, "pin"], [/people|member|group|user|friend/, "users"], [/notif|alert/, "bell"], [/ai|smart|magic|auto/, "sparkles"]];
  for (const [re, k] of map) if (re.test(l)) return k;
  return ICON_KEYS[i % ICON_KEYS.length];
}
const TILE = [["#22c55e", "#15803d"], ["#3b82f6", "#1d4ed8"], ["#10b981", "#047857"], ["#f59e0b", "#b45309"], ["#8b5cf6", "#6d28d9"], ["#ef4444", "#b91c1c"],
  ["#ec4899", "#be185d"], ["#06b6d4", "#0e7490"], ["#6366f1", "#4338ca"], ["#14b8a6", "#0f766e"]];

// ── Looks ─────────────────────────────────────────────────────────────────────────────────────────
function look(key, brand, fontsCss, stars) {
  const p = hex(brand.primary, null), s = hex(brand.secondary, null);
  const base = {
    stars, fontsCss: /^https:\/\/fonts\.googleapis\.com\/css2\?[\w=&;:@.+%-]+$/.test(fontsCss) ? `<link rel="stylesheet" href="${esc(fontsCss)}">` : "",
    hFont: cssFont(brand.headingFont, "Montserrat"), bFont: cssFont(brand.bodyFont, "Inter"), hot: "#ef4444",
  };
  const L = {
    neon: { acc: p ?? "#22d3ee", acc2: "#60a5fa", ink: "#ffffff", sub: "#d8f4ff", bg: `radial-gradient(ellipse at 50% 45%, ${s ?? "#0b1a3a"} 0%, #030712 100%)`,
      surf: "#0b1224", surfInk: "#e8f6ff", bord: "#334155", fx: "glow", particles: "stars", colorTiles: true, dark: true },
    clean: { acc: p ?? "#2563eb", acc2: "#06b6d4", ink: "#0f172a", sub: "#334155", bg: "linear-gradient(160deg,#ffffff 0%,#eef4ff 55%,#f8fafc 100%)",
      surf: "#ffffff", surfInk: "#0f172a", bord: "#e2e8f0", fx: "soft", particles: "blobs", colorTiles: false, dark: false },
    bold: { acc: p ?? "#7c3aed", acc2: s && s !== "#120a24" ? s : "#ec4899", ink: "#ffffff", sub: "#fdf4ff", bg: "", // set below (needs acc)
      surf: "rgba(255,255,255,.14)", surfInk: "#ffffff", bord: "rgba(255,255,255,.35)", fx: "lift", particles: "shapes", colorTiles: false, dark: true },
    paper: { acc: p ?? "#e4572e", acc2: "#2a9d8f", ink: "#1f2937", sub: "#374151", bg: "#f5efe6",
      surf: "#fffaf2", surfInk: "#1f2937", bord: "#1f2937", fx: "hard", particles: "dots", colorTiles: false, dark: false },
    grid: { acc: p ?? "#a3e635", acc2: "#22d3ee", ink: "#ecfdf5", sub: "#bbf7d0", bg: "linear-gradient(180deg,#05060a 0%,#0a1210 100%)",
      surf: "#0c1110", surfInk: "#ecfdf5", bord: "#1f3b2c", fx: "glow", particles: "grid", colorTiles: false, dark: true },
    sunset: { acc: p ?? "#fbbf24", acc2: "#fb7185", ink: "#ffffff", sub: "#ffe4e6", bg: "linear-gradient(180deg,#1e1b4b 0%,#831843 58%,#f59e0b 130%)",
      surf: "rgba(30,27,75,.72)", surfInk: "#fff7ed", bord: "rgba(255,255,255,.25)", fx: "glow", particles: "bokeh", colorTiles: true, dark: true },
  }[key];
  if (key === "bold") L.bg = `linear-gradient(135deg, ${L.acc} 0%, ${L.acc2} 100%)`;
  // The accent as used ON a surface (on Bold the surfaces are tinted glass over the accent itself).
  L.onAcc = key === "bold" ? "#ffffff" : L.acc;
  return { key, ...base, ...L };
}
/** Shadow / glow for a surface or element in this look. */
const shadow = (L, k = 1) => L.fx === "glow" ? `0 0 ${6 * k}cqmin ${L.acc}66` : L.fx === "hard" ? `${0.7 * k}cqmin ${0.7 * k}cqmin 0 ${L.bord}`
  : L.fx === "lift" ? `0 ${1.5 * k}cqmin ${4 * k}cqmin rgba(0,0,0,.25)` : `0 ${1 * k}cqmin ${3.5 * k}cqmin rgba(15,23,42,.14)`;
const textFx = (L) => L.fx === "glow" ? `0 0 .25em ${L.acc}, 0 0 .06em ${L.acc}` : L.fx === "lift" ? "0 .06em .2em rgba(0,0,0,.35)" : "none";
/** An icon tile in this look (colourful on dark looks, accent-tinted on light ones). */
function tile(L, icon, i, size, id) {
  const [a, b] = L.colorTiles ? TILE[i % TILE.length] : [L.acc, L.acc2];
  const flat = L.fx === "hard";
  const bg = flat ? (i % 2 ? L.acc : L.acc2) : L.key === "bold" ? "rgba(255,255,255,.24)" : `linear-gradient(145deg,${a},${b})`;
  return `<div class="ic" id="${id}" style="width:${size}px;height:${size}px;border-radius:${size * (flat ? 0.18 : 0.26)}px;background:${bg};${flat ? `border:${Math.max(2, size * 0.04)}px solid ${L.bord};` : ""}box-shadow:${L.fx === "glow" ? `0 0 ${size * 0.5}px ${a}88` : shadow(L, 0.6)}">${svg(icon, size * 0.5)}</div>`;
}

/** Shared page shell: background + particles, easing helpers; `script` defines draw(t). */
function page({ W, H, L, seed, transparent, css = "", body = "", script = "" }) {
  return `<!doctype html><html><head><meta charset="utf-8">${L.fontsCss}<style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;background:${transparent ? "transparent" : L.key === "paper" ? L.bg : "#000"}}
*{box-sizing:border-box}
body{container-type:size;--acc:${L.acc};--acc2:${L.acc2};--ink:${L.ink};--sub:${L.sub};--surf:${L.surf};--bord:${L.bord}}
#bg{position:absolute;inset:0;background:${L.bg}}
#pt{position:absolute;inset:-6%;overflow:hidden}
.st{position:absolute;border-radius:50%}
.ic{position:absolute;left:0;top:0;display:flex;align-items:center;justify-content:center;will-change:transform}
.h{font-family:${L.hFont};font-weight:800;color:var(--ink);letter-spacing:-.01em;margin:0}
.hl{position:absolute;left:5%;right:5%;text-align:center;font-size:6.2cqmin;line-height:1.1;z-index:20;text-shadow:${textFx(L)}}
.surf{background:var(--surf);border:max(2px,.35cqmin) solid var(--bord);box-shadow:${shadow(L)};${L.key === "bold" || L.key === "sunset" ? "backdrop-filter:blur(8px);" : ""}}
${css}
</style></head><body>${transparent ? "" : '<div id="bg"></div><div id="pt"></div>'}${body}<script>
// One scope per page: the render reuses a browser page and setContent keeps the JS realm (top-level consts would collide).
(() => {
const W=${W},H=${H},S=Math.min(W,H);
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const ease=(x)=>{x=clamp(x);return 1-Math.pow(1-x,3)};
const easeIO=(x)=>{x=clamp(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2};
const back=(x)=>{x=clamp(x);const c=1.70158,c3=c+1;return 1+c3*Math.pow(x-1,3)+c*Math.pow(x-1,2)};
let seed=${seed % 2147483647};const rnd=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const $=(id)=>document.getElementById(id);
// Background particles for the look.
const P=[];const pt=$('pt');const kind=${JSON.stringify(L.particles)};
if(pt){
  const n=kind==='stars'?${L.stars}:kind==='grid'?0:kind==='blobs'?4:kind==='dots'?0:kind==='shapes'?14:18;
  for(let i=0;i<n;i++){const d=document.createElement('div');d.className='st';let s;
    if(kind==='stars'){s=(rnd()*2.2+0.6)*S/1080;d.style.background='#fff'}
    else if(kind==='blobs'){s=S*(0.35+rnd()*0.35);d.style.background=i%2?'${L.acc}':'${L.acc2}';d.style.opacity=.16;d.style.filter='blur('+S*0.06+'px)'}
    else if(kind==='shapes'){s=S*(0.03+rnd()*0.09);d.style.background='rgba(255,255,255,'+(0.08+rnd()*0.14)+')';d.style.borderRadius=['50%','22%','4%'][i%3]}
    else{s=S*(0.02+rnd()*0.08);d.style.background=i%3?'${L.acc}':'#fff';d.style.opacity=.18;d.style.filter='blur('+s*0.15+'px)'}
    Object.assign(d.style,{left:rnd()*100+'%',top:rnd()*100+'%',width:s+'px',height:s+'px'});pt.appendChild(d);P.push({d,s,p:rnd()*6.28,f:0.4+rnd()*1.4,b:0.25+rnd()*0.6,vx:(rnd()-.5)*0.04,vy:-(0.01+rnd()*0.04)})}
  if(kind==='dots'){pt.style.backgroundImage='radial-gradient(${L.bord}22 1.2px, transparent 1.3px)';pt.style.backgroundSize=(S*0.028)+'px '+(S*0.028)+'px'}
  if(kind==='grid'){pt.innerHTML='<div id="gf" style="position:absolute;left:-50%;right:-50%;top:55%;height:90%;transform:perspective('+S*0.9+'px) rotateX(62deg);transform-origin:50% 0;background-image:linear-gradient(${L.acc}55 1px,transparent 1px),linear-gradient(90deg,${L.acc}55 1px,transparent 1px);background-size:'+S*0.08+'px '+S*0.08+'px"></div><div style="position:absolute;inset:0;background:linear-gradient(180deg,transparent 40%,${L.acc}18 56%,transparent 75%)"></div>'}
}
function bgAt(t){
  if(kind==='stars'){for(const s of P)s.d.style.opacity=(s.b+0.35*Math.sin(s.p+t*s.f)).toFixed(3);if(pt)pt.style.transform='scale('+(1+t*0.012)+')'}
  else if(kind==='grid'){const g=$('gf');if(g)g.style.backgroundPosition='0 '+(t*S*0.06)+'px'}
  else for(const s of P)s.d.style.transform='translate('+(Math.sin(s.p+t*s.f*0.5)*S*0.02+s.vx*t*S)+'px,'+(s.vy*t*S+Math.cos(s.p+t*s.f*0.4)*S*0.015)+'px) rotate('+(t*s.f*20)+'deg)';
}
${script}
window.render=(t)=>{bgAt(t);draw(t)};
// Long headlines shrink to fit their box (one pass, before the first frame).
for(const el of document.querySelectorAll('[data-fit]')){let k=1,fs=parseFloat(getComputedStyle(el).fontSize);
  // Glyph overhang makes scrollHeight a few px over clientHeight even when it fits — allow a fraction of the size.
  const over=()=>{const f=parseFloat(el.style.fontSize||fs);return el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+f*0.25};
  while(k>0.4&&over()){k-=0.06;el.style.fontSize=(fs*k)+'px'}}
window.render(0);
// The editor preview runs this page in a scripts-only sandbox (no access either way): it drives frames by message.
let driven=false;
addEventListener("message",(e)=>{if(e.source===parent&&e.data&&typeof e.data.cwRender==="number"){driven=true;window.render(e.data.cwRender)}});
// Say "ready" until the editor answers with a frame (it may start listening after this page has loaded).
if(parent!==window){let n=0;const ping=()=>{if(driven||n++>40)return;parent.postMessage({cwReady:1},"*");setTimeout(ping,250)};ping()}
})();
</script></body></html>`;
}

/** The headline at the top or bottom (variant), fading in. */
const headline = (text, pos = "top") => (text.headline ? `<h1 class="h hl" id="hl" data-fit style="${pos === "top" ? "top:6%" : "bottom:7%"};max-height:16%">${esc(text.headline)}</h1>` : "");
const HL_JS = "const hl=$('hl');const hlAt=(t,d=0.4)=>{if(hl){const k=ease((t-d)/0.7);hl.style.opacity=k;hl.style.transform='translateY('+(1-k)*S*0.03+'px)'}};";

/** A device that holds a picture: phone, laptop screen or an orb. `inner` = HTML inside the screen. */
function device(kind, { x, y, w, L, id = "ph", inner = "", extra = "" }) {
  if (kind === "orb") {
    return `<div id="${id}" style="position:absolute;z-index:3;left:${x - w / 2}px;top:${y - w / 2}px;width:${w}px;height:${w}px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffffffcc,${L.acc} 45%,${L.acc2});box-shadow:${shadow(L, 1.4)};display:flex;align-items:center;justify-content:center">${extra}${inner}</div>`;
  }
  if (kind === "laptop") {
    const h = w * 0.62;
    return `<div id="${id}" style="position:absolute;z-index:3;left:${x - w / 2}px;top:${y - h / 2}px;width:${w}px;height:${h}px">
<div class="surf" style="position:absolute;left:6%;right:6%;top:0;bottom:12%;border-radius:2cqmin 2cqmin .6cqmin .6cqmin;overflow:hidden">${extra}<div style="position:absolute;inset:4%;border-radius:1cqmin;overflow:hidden;background:linear-gradient(170deg,${L.acc}40,${L.dark ? "#0a2540" : "#f1f5f9"})">${inner}</div></div>
<div style="position:absolute;left:0;right:0;bottom:4%;height:8%;border-radius:0 0 3cqmin 3cqmin;background:${L.bord};box-shadow:${shadow(L, 0.6)}"></div></div>`;
  }
  const h = w * 2;
  return `<div class="surf" id="${id}" style="position:absolute;z-index:3;left:${x - w / 2}px;top:${y - h / 2}px;width:${w}px;height:${h}px;border-radius:7%/3.5%">
<div style="position:absolute;top:1.2cqmin;left:50%;width:34%;height:2.2cqmin;transform:translateX(-50%);background:${L.bord};border-radius:99px;z-index:3"></div>${extra}
<div style="position:absolute;inset:1.2cqmin;border-radius:6%/3%;overflow:hidden;background:linear-gradient(170deg,${L.acc}38 0%,${L.dark ? "#0a2540" : "#f1f5f9"} 55%)">${inner}</div></div>`;
}

/** Chat lines from bullets: "Name: message (Channel)"; "Me:"/"You:" = sent by the user. */
export function parseChat(bullets) {
  return (bullets ?? []).map((b) => String(b ?? "").trim()).filter(Boolean).slice(0, 6).map((b) => {
    let rest = b, via = "";
    const m = rest.match(/\(([^()]{1,24})\)\s*$/);
    if (m) { via = m[1].trim(); rest = rest.slice(0, m.index).trim(); }
    // "Name: message" — never a time ("moves to 6:30 tonight"): no digit right before the colon, a space after it.
    const n = rest.match(/^([^:]{0,23}[^:\d]):\s+(.+)$/);
    const from = n ? n[1].trim() : "";
    const me = /^(me|you|i)$/i.test(from);
    return { from: me ? "" : from, text: n ? n[2] : rest, via, me };
  });
}
/** Before / after lines: "Before:"/"Without:" left, "After:"/"With:" right; otherwise the first half vs the rest. */
export function parseCompare(bullets) {
  const lines = (bullets ?? []).map((b) => String(b ?? "").trim()).filter(Boolean).slice(0, 8);
  const L = [], R = [];
  let labels = ["Before", "After"];
  for (const l of lines) {
    const m = l.match(/^(before|without|old way|then|after|with|new way|now)\s*:\s*(.+)$/i);
    if (!m) continue;
    const left = /^(before|without|old way|then)$/i.test(m[1]);
    (left ? L : R).push(m[2]);
    if (/^with/i.test(m[1])) labels = ["Without", "With"];
    else if (/way$/i.test(m[1])) labels = ["The old way", "The new way"];
    else if (/^(then|now)$/i.test(m[1])) labels = ["Then", "Now"];
  }
  if (!L.length && !R.length) { const h = Math.ceil(lines.length / 2); L.push(...lines.slice(0, h)); R.push(...lines.slice(h)); }
  return { labels, left: L.slice(0, 4), right: R.slice(0, 4) };
}

// ── Templates ─────────────────────────────────────────────────────────────────────────────────────
const TEMPLATES = {
  "mg-orbit"({ W, H, L, V, text, seed }) {
    const hub = V.pick(["phone", "laptop", "orb"]), wide = W >= H;
    const hlPos = V.pick(["top", "top", "bottom"]);
    const n = Math.round(V.range(6, 10)), size = Math.round(Math.min(W, H) * V.range(0.085, 0.115));
    const icons = V.shuffle(ICON_KEYS).slice(0, n);
    const dir = V.pick([1, -1]), speed = V.range(0.35, 0.7), tilt = V.range(0.08, 0.15), cy = H * (hlPos === "top" ? 0.55 : 0.45);
    const hw = hub === "phone" ? Math.min(W * 0.3, H * 0.28) : hub === "laptop" ? Math.min(W * 0.42, H * 0.6) : Math.min(W, H) * 0.26;
    const inner = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${svg(V.pick(["chat", "sparkles", "users", "globe"]), hw * 0.3, L.dark ? "#fff" : L.acc)}</div>`;
    return page({ W, H, L, seed, css: `#ring{position:absolute;left:${W / 2 - W * 0.38}px;top:${cy - H * tilt}px;width:${W * 0.76}px;height:${H * tilt * 2}px;border-radius:50%;border:2px ${V.pick(["solid", "dashed"])} ${L.acc}66}`,
      body: `<div id="ring"></div>${device(hub, { x: W / 2, y: cy, w: hw, L, inner: hub === "orb" ? "" : inner, extra: hub === "orb" ? svg("sparkles", hw * 0.4) : "" })}${icons.map((k, i) => tile(L, k, i, size, `o${i}`)).join("")}${headline(text, hlPos)}`,
      script: `${HL_JS}const n=${n},rx=W*${wide ? 0.38 : 0.4},ry=H*${tilt},cy=${cy},size=${size},dir=${dir},sp=${speed};const ph=$('ph');
function draw(t){const intro=ease(t/1.2);
  ph.style.transform='translateY('+(Math.sin(t*1.3)*S*0.01+(1-intro)*S*0.08)+'px) rotate('+(Math.sin(t*0.8)*2)+'deg)';ph.style.opacity=intro;
  for(let i=0;i<n;i++){const el=$('o'+i);const a=dir*t*sp+i*6.283/n;const z=Math.sin(a);
    const x=W/2+Math.cos(a)*rx*(0.6+0.4*intro);const y=cy+z*ry-H*0.02;const s=(0.72+0.38*(z+1)/2)*(0.4+0.6*ease((t-0.15*i/n)/1));
    el.style.transform='translate('+(x-size/2)+'px,'+(y-size/2)+'px) scale('+s+')';el.style.zIndex=z>0?5:1;
    el.style.filter=z>0?'none':'blur('+(2*(-z)).toFixed(2)+'px) brightness(.8)';el.style.opacity=ease(t/0.8)}
  hlAt(t,0.5)}` });
  },

  "mg-swarm"({ W, H, L, V, text, dur, seed }) {
    const hub = V.pick(["phone", "laptop", "orb"]), pattern = V.pick(["burst", "rain", "spiral"]), shape = V.pick(["50%", "28%", "99px"]);
    const color = V.pick([L.hot, L.hot, L.acc]), hlPos = V.pick(["top", "bottom"]);
    const hw = hub === "phone" ? Math.min(W * 0.3, H * 0.28) : hub === "laptop" ? Math.min(W * 0.42, H * 0.6) : Math.min(W, H) * 0.24;
    const cy = H * (hlPos === "top" ? 0.56 : 0.46), n = Math.round(V.range(34, 52)), icon = V.pick(["bell", "mail", "chat", "at"]);
    // What piles up: by default numbered alert badges; with lines ("laptops", "iPhones"…) the matching icons instead.
    const kinds = (text.bullets ?? []).map((b) => String(b ?? "").trim()).filter(Boolean).slice(0, 4).map((b, i) => iconFor(b, i));
    const icos = kinds.map((k) => svg(k, "60%")); // internal constant markup only (no user text)
    const tiles = kinds.map((_, i) => (L.colorTiles ? TILE[(i * 3) % TILE.length][0] : i % 2 ? L.acc : L.acc2));
    const inner = Array.from({ length: 6 }, (_, i) => `<div id="m${i}" style="position:absolute;left:8%;right:8%;top:${8 + i * 14}%;height:9%;border-radius:1.4cqmin;background:${L.dark ? "#ffffff1f" : "#0f172a14"}"></div>`).join("");
    return page({ W, H, L, seed, css: `.bd{position:absolute;left:0;top:0;border-radius:${shape};background:${color};color:#fff;font-family:${L.hFont};font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:${L.fx === "glow" ? `0 0 2cqmin ${color}99` : shadow(L, 0.4)};will-change:transform}
#cnt{position:absolute;left:auto;top:-3cqmin;right:-3cqmin;min-width:9cqmin;height:9cqmin;padding:0 1.5cqmin;font-size:4.5cqmin;z-index:9;border-radius:99px}`,
      body: device(hub, { x: W / 2, y: cy, w: hw, L, inner: hub === "orb" ? "" : inner, extra: `<div class="bd" id="cnt">0</div>${hub === "orb" ? svg(icon, hw * 0.4) : ""}` }) + `<div id="bz"></div>${headline(text, hlPos)}`,
      script: `${HL_JS}const n=${n},px=W/2,py=${cy},pw=${hw},D=${dur},pat=${JSON.stringify(pattern)},ICO=${JSON.stringify(icos)},TC=${JSON.stringify(tiles)},TOP=${hlPos === "top" ? 0.2 : 0.06},BOT=${hlPos === "top" ? 0.94 : 0.8};const bz=$('bz');const B=[];
for(let i=0;i<n;i++){const d=document.createElement('div');d.className='bd';const s=S*(0.035+rnd()*0.04);d.style.width=s+'px';d.style.height=s+'px';d.style.fontSize=(s*0.5)+'px';if(ICO.length){const k=i%ICO.length;d.innerHTML=ICO[k];d.style.background=TC[k];d.style.borderRadius='24%';d.style.width=d.style.height=(s*1.35)+'px'}else d.textContent=1+Math.floor(rnd()*9);bz.appendChild(d);
  const ang=rnd()*6.283;const rr=pw*0.65+rnd()*S*0.24;const r=Math.hypot(W,H)*0.6;let sx,sy;
  if(pat==='rain'){sx=px+(rnd()-.5)*W;sy=-S*0.2}else if(pat==='spiral'){const a=ang+3;sx=px+Math.cos(a)*r;sy=py+Math.sin(a)*r}else{const side=rnd()*6.283;sx=px+Math.cos(side)*r;sy=py+Math.sin(side)*r}
  B.push({d,s,sx,sy,tx:px+Math.cos(ang)*rr*(W>=H?1.25:0.9),ty:Math.max(H*TOP,Math.min(H*BOT,py+Math.sin(ang)*rr*(W>=H?0.95:1.3))),t0:0.2+i*Math.max(1,D-1.6)/n,ph:rnd()*6.28})}
const ph=$('ph'),cnt=$('cnt');
function draw(t){let arrived=0;
  for(const b of B){const k=(t-b.t0)/0.7;const e=back(k);const sw=pat==='spiral'?(1-clamp(k))*1.2:0;const x=b.sx+(b.tx-b.sx)*e+Math.sin(t*3+b.ph)*4*clamp(k)+Math.cos(t*4)*sw*S*0.1;const y=b.sy+(b.ty-b.sy)*e+Math.cos(t*2.6+b.ph)*4*clamp(k);
    b.d.style.transform='translate('+(x-b.s/2)+'px,'+(y-b.s/2)+'px) scale('+(k<0?0:0.6+0.4*clamp(k*1.5))+')';b.d.style.opacity=k<0?0:1;if(k>=1)arrived++}
  const c=Math.round(arrived*99/n*1.15);cnt.textContent=c>=99?'99+':c;
  const sh=clamp((t-D*0.45)/(D*0.5));ph.style.transform='translate('+(Math.sin(t*41)*sh*S*0.005)+'px,'+(Math.cos(t*37)*sh*S*0.004)+'px) rotate('+(Math.sin(t*29)*sh*1.2)+'deg)';
  for(let i=0;i<6;i++){const m=$('m'+i);if(m)m.style.opacity=clamp((t-0.3-i*0.35)/0.3)}
  hlAt(t,0.4)}` });
  },

  "mg-words"({ W, H, L, V, text, over, seed }) {
    const words = String(text.headline ?? "").split(/\s+/).filter(Boolean).slice(0, 8);
    const style = V.pick(["punch", "rise", "type", "flip", "slide"]), deco = V.pick(["line", "box", "corners", "none"]), align = V.pick(["center", "center", "left"]);
    const fs = (W >= H ? 15 : 13) * V.range(0.85, 1.05);
    return page({ W, H, L, seed, transparent: over, css: `#wrap{position:absolute;left:${align === "left" ? 8 : 6}%;right:6%;top:30%;height:30%;display:flex;flex-wrap:wrap;align-content:center;justify-content:${align === "left" ? "flex-start" : "center"};column-gap:.28em;font-size:${fs}cqmin}
.w{font-family:${L.hFont};font-weight:900;color:${over ? "#fff" : "var(--ink)"};line-height:1.05;text-shadow:${over ? "0 .05em .25em rgba(0,0,0,.6)" : textFx(L)};display:inline-block;will-change:transform}
#ln{position:absolute;top:63%;left:${align === "left" ? "8%" : "50%"};height:0.8cqmin;border-radius:99px;background:linear-gradient(90deg,${L.acc},${L.acc2});box-shadow:${L.fx === "glow" ? `0 0 3cqmin ${L.acc}` : "none"}}
#bx{position:absolute;left:4%;right:4%;top:27%;height:36%;border-radius:2cqmin;background:${L.acc}26;border:.4cqmin solid ${L.acc}}
.cn{position:absolute;width:6cqmin;height:6cqmin;border:.8cqmin solid ${L.acc}}
#sub{position:absolute;left:8%;right:8%;top:67%;text-align:${align};font-family:${L.bFont};font-weight:500;font-size:4.2cqmin;color:${over ? "#f1f5f9" : "var(--sub)"}}
#veil{position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(3,7,18,.35), rgba(3,7,18,.78))}`,
      body: `${over ? '<div id="veil"></div>' : ""}${deco === "box" ? '<div id="bx"></div>' : ""}${deco === "corners" ? '<div class="cn" id="c0" style="left:5%;top:26%;border-right:0;border-bottom:0"></div><div class="cn" id="c1" style="right:5%;top:58%;border-left:0;border-top:0"></div>' : ""}<div id="wrap" data-fit>${words.map((w, i) => `<span class="w" id="w${i}">${esc(w)}</span>`).join("")}</div>${deco === "line" ? '<div id="ln"></div>' : ""}${text.sub ? `<div id="sub">${esc(text.sub)}</div>` : ""}`,
      script: `const n=${words.length},st=${JSON.stringify(style)},al=${JSON.stringify(align)};const ln=$('ln'),veil=$('veil'),sub=$('sub'),bx=$('bx');
function draw(t){if(veil)veil.style.opacity=ease(t/0.4);
  for(let i=0;i<n;i++){const k=(t-0.25-i*0.3)/0.35;const el=$('w'+i);const o=clamp(k*2);el.style.opacity=o;
    if(st==='punch'){el.style.transform='scale('+(k<0?2.2:1+1.2*(1-back(k)))+')';el.style.filter='blur('+(Math.max(0,1-clamp(k))*8)+'px)'}
    else if(st==='rise'){el.style.transform='translateY('+((1-ease(k))*S*0.12)+'px)'}
    else if(st==='type'){el.style.opacity=k>0?1:0;el.style.transform='none'}
    else if(st==='flip'){el.style.transform='perspective('+S+'px) rotateX('+((1-back(k))*90)+'deg)'}
    else {el.style.transform='translateX('+((1-ease(k))*-S*0.25)+'px)'}}
  const l=ease((t-0.25-n*0.3)/0.6);
  if(ln){ln.style.width=(W*0.55*l)+'px';ln.style.transform=al==='left'?'none':'translateX(-50%)';ln.style.opacity=l}
  if(bx){bx.style.opacity=ease(t/0.5);bx.style.transform='scaleX('+(0.6+0.4*ease(t/0.6))+')'}
  for(const c of [$('c0'),$('c1')])if(c){c.style.opacity=ease(t/0.5)}
  if(sub){const k=ease((t-0.45-n*0.3)/0.6);sub.style.opacity=k;sub.style.transform='translateY('+(1-k)*S*0.03+'px)'}}` });
  },

  "mg-logo"({ W, H, L, V, text, brand, seed }) {
    const letters = [...String(text.headline ?? "")].slice(0, 24);
    const style = V.pick(["shock", "split", "wipe", "zoom", "type"]);
    const logo = okLogo(brand.logoDataUrl);
    return page({ W, H, L, seed, css: `#lg{position:absolute;left:5%;right:5%;top:${logo ? 40 : 30}%;height:22%;display:flex;justify-content:center;align-items:center;font-size:${W >= H ? 20 : 17}cqmin;white-space:pre}
.l{font-family:${L.hFont};font-weight:900;color:var(--ink);display:inline-block;text-shadow:${textFx(L)}}
#tg{position:absolute;left:6%;right:6%;top:${logo ? 66 : 60}%;text-align:center;font-family:${L.bFont};font-weight:500;font-size:4.4cqmin;color:var(--sub);letter-spacing:.06em;text-transform:uppercase}
.rg{position:absolute;left:50%;top:44%;border-radius:50%;border:0.6cqmin solid ${L.acc};${L.fx === "glow" ? `box-shadow:0 0 4cqmin ${L.acc}, inset 0 0 4cqmin ${L.acc}` : ""}}
#flash{position:absolute;inset:0;background:radial-gradient(circle at 50% 44%, ${L.dark ? "#ffffff" : L.acc + "55"} 0%, ${L.acc}55 18%, transparent 55%)}
#sweep{position:absolute;top:0;bottom:0;width:18%;background:linear-gradient(90deg,transparent,#ffffff55,transparent);transform:skewX(-20deg);mix-blend-mode:${L.dark ? "screen" : "normal"}}
#mask{position:absolute;left:0;top:30%;height:30%;background:${L.acc};z-index:5}
#logo{position:absolute;left:50%;top:${W >= H ? 14 : 22}%;height:20%;max-width:50%;object-fit:contain;transform:translateX(-50%)}`,
      body: `${style === "shock" ? '<div id="flash"></div><div class="rg" id="r0"></div><div class="rg" id="r1"></div>' : ""}${logo ? `<img id="logo" src="${logo}" alt="">` : ""}<div id="lg" data-fit>${letters.map((c, i) => `<span class="l" id="l${i}">${esc(c)}</span>`).join("")}</div>${style === "wipe" ? '<div id="mask"></div>' : ""}<div id="sweep"></div>${text.sub ? `<div id="tg">${esc(text.sub)}</div>` : ""}`,
      script: `const n=${letters.length},st=${JSON.stringify(style)};
function draw(t){
  if(st==='shock'){for(const [i,d] of [[0,0],[1,0.18]]){const k=ease((t-0.1-d)/1.1);const r=$('r'+i);const s=S*(0.1+1.3*k);r.style.width=s+'px';r.style.height=s+'px';r.style.transform='translate(-50%,-50%)';r.style.opacity=(1-k)*(t>0.1+d?1:0)}
    $('flash').style.opacity=Math.max(0,1-Math.abs(t-0.35)/0.45)*0.9+0.15}
  const lg=$('logo');if(lg){const k=ease((t-0.2)/0.6);lg.style.opacity=k;lg.style.transform='translateX(-50%) scale('+(0.7+0.3*back((t-0.2)/0.6))+')'}
  for(let i=0;i<n;i++){const el=$('l'+i);let k=(t-0.3-i*0.07)/0.5;
    if(st==='split'){const side=i<n/2?-1:1;k=(t-0.3)/0.8;el.style.opacity=clamp(k*1.5);el.style.transform='translateX('+(side*(1-easeIO(k))*W*0.3)+'px)'}
    else if(st==='zoom'){k=(t-0.2)/0.9;el.style.opacity=clamp(k*1.5);el.style.transform='scale('+(1+2*(1-ease(k)))+')';el.style.filter='blur('+(Math.max(0,1-clamp(k))*14)+'px)'}
    else if(st==='type'){el.style.opacity=t>0.3+i*0.09?1:0;el.style.transform='none'}
    else if(st==='wipe'){el.style.opacity=t>0.8?1:0;el.style.transform='none'}
    else{el.style.opacity=clamp(k*1.6);el.style.transform='translateY('+((1-back(k))*S*0.06)+'px) scale('+(0.6+0.4*back(k))+')';el.style.filter='blur('+(Math.max(0,1-clamp(k))*10)+'px)'}}
  const mk=$('mask');if(mk){const a=easeIO((t-0.2)/0.6),b=easeIO((t-0.8)/0.6);mk.style.left=(b*100)+'%';mk.style.width=((a-b)*100)+'%'}
  const sw=$('sweep');const sk=easeIO((t-1.0)/0.9);sw.style.left=(-W*0.2+W*1.4*sk)+'px';sw.style.opacity=sk>0&&sk<1?1:0;
  const tg=$('tg');if(tg){const k2=ease((t-1.1)/0.7);tg.style.opacity=k2;tg.style.transform='translateY('+(1-k2)*S*0.03+'px)'}}` });
  },

  "mg-chat"({ W, H, L, V, text, dur, over, seed }) {
    const msgs = parseChat(text.bullets);
    const wide = W >= H;
    const phh = H * (wide ? 0.86 : 0.7), pw = phh * 0.49;
    const side = over && wide ? 0.72 : wide ? V.pick([0.3, 0.5, 0.7]) : 0.5;
    const x = W * side, y = H / 2 + (wide ? 0 : -H * 0.02);
    const u = phh / 100, sharp = V.pick([false, false, true]);
    const r = sharp ? u * 0.6 : u * 2;
    const bubIn = L.dark ? "#16304d" : "#f1f5f9", bubInk = L.dark ? "#e8f6ff" : "#0f172a";
    const items = msgs.map((m, i) => `<div class="row ${m.me ? "me" : ""}" id="c${i}"><div class="bub">${m.from ? `<b>${esc(m.from)}</b>` : ""}${esc(m.text)}${m.via ? `<span class="tag" style="background:${TILE[ICON_KEYS.indexOf(iconFor(m.via, i)) % TILE.length][0]}">${esc(m.via)}</span>` : ""}</div></div>`).join("");
    // Wide, no media: a headline beside the phone (the other half of the frame).
    const side2 = !over && wide && text.headline && side !== 0.5;
    return page({ W, H, L, seed, transparent: over, css: `.top{position:absolute;left:0;right:0;top:0;height:${u * 11}px;background:${L.dark ? "#0b2a45" : "#ffffff"};border-bottom:1px solid ${L.dark ? "#ffffff1a" : "#e2e8f0"};display:flex;align-items:flex-end;padding:0 ${u * 3}px ${u * 1.6}px;gap:${u * 2}px;font-family:${L.hFont};font-weight:700;color:${bubInk};font-size:${u * 2.6}px;white-space:nowrap;overflow:hidden}
.av{flex:none;width:${u * 4.4}px;height:${u * 4.4}px;border-radius:50%;background:linear-gradient(145deg,${L.acc},${L.acc2});display:flex;align-items:center;justify-content:center}
.list{position:absolute;left:0;right:0;top:${u * 12}px;bottom:${u * 9}px;display:flex;flex-direction:column;justify-content:flex-end;gap:${u * 1.5}px;padding:0 ${u * 2.6}px;overflow:hidden}
.row{display:flex}.row.me{justify-content:flex-end}
.bub{max-width:80%;font-family:${L.bFont};font-size:${u * 2.15}px;line-height:1.3;color:${bubInk};background:${bubIn};border:1px solid ${L.dark ? "#ffffff1c" : "#e2e8f0"};padding:${u * 1.2}px ${u * 1.6}px ${u * 1.9}px;border-radius:${r}px ${r}px ${r}px ${u * 0.5}px;position:relative;transform-origin:left bottom}
.me .bub{background:linear-gradient(145deg,${L.acc},${L.acc2});color:#fff;border-radius:${r}px ${r}px ${u * 0.5}px ${r}px;transform-origin:right bottom}
.bub b{display:block;font-size:${u * 1.7}px;color:${L.acc};margin-bottom:${u * 0.3}px;font-family:${L.hFont}}
.me .bub b{color:#fff}
.tag{position:absolute;right:${u * 1.2}px;bottom:-${u * 1}px;font-family:${L.hFont};font-weight:800;font-size:${u * 1.35}px;color:#fff;padding:${u * 0.3}px ${u * 0.9}px;border-radius:99px}
.inp{position:absolute;left:${u * 2.6}px;right:${u * 2.6}px;bottom:${u * 2.4}px;height:${u * 5}px;border-radius:99px;background:${L.dark ? "#ffffff14" : "#f1f5f9"};border:1px solid ${L.dark ? "#ffffff22" : "#e2e8f0"};display:flex;align-items:center;justify-content:flex-end;padding:0 ${u * 0.6}px}
.sendb{width:${u * 4}px;height:${u * 4}px;border-radius:50%;background:${L.acc};display:flex;align-items:center;justify-content:center}
#side{position:absolute;top:30%;height:40%;${side < 0.5 ? "left:52%;right:6%" : "left:6%;right:52%"};display:flex;align-items:center;font-size:7cqmin;line-height:1.1;text-align:${side < 0.5 ? "left" : "right"};text-shadow:${textFx(L)}}
#veil{position:absolute;inset:0;background:${wide ? `linear-gradient(90deg, rgba(3,7,18,0) 30%, rgba(3,7,18,.75) 60%)` : "rgba(3,7,18,.55)"}}`,
      body: `${over ? '<div id="veil"></div>' : ""}${side2 ? `<h1 class="h" id="side" data-fit>${esc(text.headline)}</h1>` : ""}${device("phone", { x, y, w: pw, L, inner: `<div class="top"><div class="av">${svg("users", u * 2.6)}</div>${esc(text.headline || "Group")}</div><div class="list">${items}</div><div class="inp"><div class="sendb">${svg("send", u * 2.2)}</div></div>` })}`,
      script: `const n=${msgs.length};const gap=${(Math.max(1.5, dur) - 1.0) / Math.max(1, msgs.length)};const ph=$('ph'),veil=$('veil'),sd=$('side');
function draw(t){const k0=ease(t/0.6);ph.style.opacity=k0;ph.style.transform='translateY('+((1-k0)*S*0.05+Math.sin(t*1.1)*S*0.006)+'px)';if(veil)veil.style.opacity=ease(t/0.5);
  if(sd){const k=ease((t-0.3)/0.7);sd.style.opacity=k;sd.style.transform='translateY('+(1-k)*S*0.03+'px)'}
  for(let i=0;i<n;i++){const k=(t-0.5-i*gap)/0.4;const r=$('c'+i);r.style.display=k<0?'none':'flex';
    const b=r.firstChild;b.style.transform='scale('+back(k)+')';b.style.opacity=clamp(k*2)}}` });
  },

  "mg-fanout"({ W, H, L, V, text, seed }) {
    const labels = (text.bullets ?? []).map((b) => String(b ?? "").trim()).filter(Boolean).slice(0, 6);
    const n = labels.length, wide = W >= H, arr = V.pick(wide ? ["sides", "radial", "tree"] : ["sides", "radial", "tree"]);
    const hlPos = arr === "tree" ? "top" : V.pick(["top", "bottom"]);
    const cx = W / 2, cy = arr === "tree" ? H * 0.36 : H * (hlPos === "top" ? 0.58 : 0.46);
    const pts = labels.map((_, i) => {
      if (arr === "radial") { const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + 0.3; const rx = W * (wide ? 0.32 : 0.36), ry = H * (wide ? 0.27 : 0.22); return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }; }
      if (arr === "tree") { const fx = n === 1 ? 0.5 : i / (n - 1); return { x: W * (0.12 + 0.76 * fx), y: H * 0.74 }; }
      const sd = i % 2 ? 1 : -1, row = Math.floor(i / 2), rows = Math.ceil(n / 2), fy = rows === 1 ? 0 : (row / (rows - 1)) * 2 - 1;
      return wide ? { x: cx + sd * W * 0.33, y: cy + fy * H * 0.22 } : { x: cx + sd * W * 0.3, y: cy + fy * H * 0.24 };
    });
    const size = Math.round(Math.min(W, H) * 0.12), hub = Math.min(W, H) * 0.2, hubIcon = V.pick(["send", "sparkles", "zap", "globe"]);
    const curve = (p) => arr === "tree" ? `M${cx} ${cy} C ${cx} ${(cy + p.y) / 2} ${p.x} ${(cy + p.y) / 2} ${p.x} ${p.y}` : `M${cx} ${cy} C ${(cx + p.x) / 2} ${cy} ${(cx + p.x) / 2} ${p.y} ${p.x} ${p.y}`;
    return page({ W, H, L, seed, css: `#hub{position:absolute;left:${cx - hub / 2}px;top:${cy - hub / 2}px;width:${hub}px;height:${hub}px;border-radius:${L.fx === "hard" ? "22%" : "50%"};background:radial-gradient(circle at 35% 30%,#ffffffcc,${L.acc} 45%,${L.acc2});box-shadow:${shadow(L, 1.3)};display:flex;align-items:center;justify-content:center;z-index:4}
svg#paths{position:absolute;inset:0}
.lb{position:absolute;font-family:${L.hFont};font-weight:700;font-size:3.2cqmin;color:var(--ink);text-align:center;width:30cqmin;margin-left:-15cqmin}
.dot{position:absolute;left:0;top:0;width:2.2cqmin;height:2.2cqmin;margin:-1.1cqmin;border-radius:50%;background:${L.dark ? "#fff" : L.onAcc};box-shadow:0 0 2cqmin ${L.acc}}`,
      body: `<svg id="paths" viewBox="0 0 ${W} ${H}">${pts.map((p, i) => `<path id="p${i}" d="${curve(p)}" stroke="${L.acc}" stroke-width="${Math.max(2, Math.min(W, H) * 0.004)}" fill="none" stroke-linecap="round"${V.next() < 0.3 ? ' stroke-dasharray="1 0"' : ""}/>`).join("")}</svg>
<div id="hub">${svg(hubIcon, hub * 0.45)}</div>${pts.map((p, i) => tile(L, iconFor(labels[i], i), i, size, `i${i}`) + `<div class="lb" id="t${i}" style="left:${p.x}px;top:${p.y + size * 0.62}px">${esc(labels[i])}</div>`).join("")}
${pts.map((_, i) => `<div class="dot" id="d${i}"></div><div class="dot" id="e${i}"></div>`).join("")}${headline(text, hlPos)}`,
      script: `${HL_JS}const PT=${JSON.stringify(pts)},n=${n},size=${size};const LN=[];for(let i=0;i<n;i++){const p=$('p'+i);const len=p.getTotalLength();LN.push(len);p.style.strokeDasharray=len;}
function draw(t){$('hub').style.transform='scale('+(back(t/0.6)*(1+0.04*Math.sin(t*4)))+')';hlAt(t,0.3);
  for(let i=0;i<n;i++){const st=0.6+i*0.18;const k1=easeIO((t-st)/0.7);const p=$('p'+i);p.style.strokeDashoffset=LN[i]*(1-k1);
    const k2=back((t-st-0.55)/0.45);$('i'+i).style.transform='translate('+(PT[i].x-size/2)+'px,'+(PT[i].y-size/2)+'px) scale('+Math.max(0,k2)+')';
    $('t'+i).style.opacity=ease((t-st-0.7)/0.4);
    const d=$('d'+i);const pd=(t-st)/0.7;if(pd>0&&pd<1){const q=p.getPointAtLength(LN[i]*easeIO(pd));d.style.transform='translate('+q.x+'px,'+q.y+'px)';d.style.opacity=1}else d.style.opacity=0;
    const e=$('e'+i);const pe=((t-st-1.6)%1.4)/0.9;if(t>st+1.6&&pe<1){const q=p.getPointAtLength(LN[i]*(1-easeIO(pe)));e.style.transform='translate('+q.x+'px,'+q.y+'px)';e.style.opacity=1}else e.style.opacity=0}}` });
  },

  "mg-end"({ W, H, L, V, text, brand, over, seed }) {
    const url = (text.bullets ?? []).map((b) => String(b ?? "").trim()).find(Boolean) ?? "";
    const logo = okLogo(brand.logoDataUrl);
    const arr = over ? "center" : V.pick(["center", "left", "card"]);
    const ink = over ? "#fff" : "var(--ink)", sub = over ? "#e2e8f0" : "var(--sub)";
    const box = arr === "left" ? "left:8%;right:30%;text-align:left;justify-content:flex-start" : "left:5%;right:5%;text-align:center;justify-content:center";
    return page({ W, H, L, seed, transparent: over, css: `#veil{position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(3,7,18,.3), rgba(3,7,18,.82))}
#card{position:absolute;left:12%;right:12%;top:18%;bottom:18%;border-radius:3cqmin}
#bar{position:absolute;left:5%;top:25%;width:1.2cqmin;height:50%;border-radius:99px;background:linear-gradient(${L.acc},${L.acc2})}
#nm{position:absolute;${box};top:${logo ? 36 : 28}%;height:20%;display:flex;align-items:center;font-family:${L.hFont};font-weight:900;font-size:${W >= H ? 16 : 13}cqmin;line-height:1.05;color:${ink};text-shadow:${over ? "0 .05em .25em rgba(0,0,0,.6)" : textFx(L)}}
#tg{position:absolute;${box};display:block;top:${logo ? 59 : 53}%;font-family:${L.bFont};font-weight:500;font-size:4.2cqmin;color:${sub};letter-spacing:.03em}
#url{position:absolute;${arr === "left" ? "left:8%" : "left:50%"};top:${logo ? 71 : 67}%;max-width:86%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:${L.hFont};font-weight:800;font-size:4cqmin;color:${L.dark || over ? "#04121f" : "#fff"};background:${L.acc};padding:1.4cqmin 4cqmin;border-radius:${L.fx === "hard" ? "1cqmin" : "99px"};box-shadow:${shadow(L, 0.7)}}
#logo{position:absolute;${arr === "left" ? "left:8%" : "left:50%"};top:${W >= H ? 12 : 18}%;height:18%;max-width:50%;object-fit:contain}`,
      body: `${over ? '<div id="veil"></div>' : ""}${arr === "card" ? '<div class="surf" id="card"></div>' : ""}${arr === "left" ? '<div id="bar"></div>' : ""}${logo ? `<img id="logo" src="${logo}" alt="">` : ""}${text.headline ? `<div id="nm" data-fit>${esc(text.headline)}</div>` : ""}${text.sub ? `<div id="tg">${esc(text.sub)}</div>` : ""}${url ? `<div id="url">${esc(url)}</div>` : ""}`,
      script: `const C=${arr === "left" ? "''" : "'translateX(-50%) '"};function draw(t){const v=$('veil');if(v)v.style.opacity=ease(t/0.6);
  const cd=$('card');if(cd){const k=ease(t/0.6);cd.style.opacity=k;cd.style.transform='scale('+(0.92+0.08*k)+')'}
  const br=$('bar');if(br){br.style.transform='scaleY('+ease(t/0.6)+')'}
  const lg=$('logo');if(lg){lg.style.opacity=ease(t/0.6);lg.style.transform=C+'scale('+(0.85+0.15*back(t/0.6))+')'}
  const nm=$('nm');if(nm){const a=ease((t-0.2)/0.7);nm.style.opacity=a;nm.style.transform='scale('+(0.9+0.1*back((t-0.2)/0.7))+')';nm.style.filter='blur('+((1-a)*8)+'px)'}
  const tg=$('tg');if(tg){const b=ease((t-0.7)/0.6);tg.style.opacity=b;tg.style.transform='translateY('+(1-b)*S*0.03+'px)'}
  const u=$('url');if(u){u.style.opacity=clamp((t-1.1)/0.3);u.style.transform=C+'scale('+Math.max(0,back((t-1.1)/0.5))+')'}}` });
  },

  "mg-steps"({ W, H, L, V, text, dur, seed }) {
    const steps = (text.bullets ?? []).map((b) => String(b ?? "").trim()).filter(Boolean).slice(0, 4);
    const n = steps.length, wide = W >= H, arr = wide ? V.pick(["row", "row", "stairs", "column"]) : V.pick(["column", "column", "stairs"]);
    const pos = steps.map((_, i) => {
      if (arr === "row") return { x: W * (0.12 + (0.76 * (i + 0.5)) / n), y: H * 0.58 };
      if (arr === "stairs") return { x: W * (0.14 + (0.72 * (i + 0.5)) / n), y: H * (0.78 - (0.36 * i) / Math.max(1, n - 1)) };
      return { x: W * 0.5, y: H * (0.28 + (0.6 * (i + 0.5)) / n) };
    });
    const bw = arr === "column" ? Math.min(W * 0.82, H * 0.95) : (W * 0.74) / n, bh = arr === "column" ? (H * 0.56) / n : H * 0.3;
    const numStyle = V.pick(["circle", "square", "big"]);
    return page({ W, H, L, seed, css: `.sp{position:absolute;display:flex;align-items:center;gap:2cqmin;border-radius:${L.fx === "hard" ? "1cqmin" : "2.4cqmin"};padding:1.6cqmin 2.4cqmin;${arr === "column" ? "" : "flex-direction:column;text-align:center;justify-content:center"}}
.nb{flex:none;display:flex;align-items:center;justify-content:center;font-family:${L.hFont};font-weight:900;color:#fff;background:linear-gradient(145deg,${L.acc},${L.acc2});${numStyle === "circle" ? "border-radius:50%;width:8cqmin;height:8cqmin;font-size:4.2cqmin" : numStyle === "square" ? "border-radius:1.4cqmin;width:7.5cqmin;height:7.5cqmin;font-size:4cqmin" : "border-radius:1cqmin;min-width:10cqmin;height:10cqmin;font-size:6cqmin"}}
.sx{font-family:${L.bFont};font-weight:700;font-size:${arr === "column" ? 4.2 : 3.9}cqmin;line-height:1.25;overflow-wrap:anywhere}
svg#lk{position:absolute;inset:0}`,
      body: `<svg id="lk" viewBox="0 0 ${W} ${H}">${pos.slice(1).map((p, i) => `<line id="k${i}" x1="${pos[i].x}" y1="${pos[i].y}" x2="${p.x}" y2="${p.y}" stroke="${L.acc}" stroke-width="${Math.max(2, Math.min(W, H) * 0.005)}" stroke-linecap="round" stroke-dasharray="${Math.hypot(p.x - pos[i].x, p.y - pos[i].y)}"/>`).join("")}</svg>` +
        steps.map((s, i) => `<div class="sp surf" id="s${i}" style="left:${pos[i].x - bw / 2}px;top:${pos[i].y - bh / 2}px;width:${bw * 0.92}px;min-height:${bh * 0.8}px"><div class="nb">${i + 1}</div><div class="sx" style="color:${L.surfInk}">${esc(s)}</div></div>`).join("") + headline(text, "top"),
      script: `${HL_JS}const n=${n},gap=${Math.max(0.45, (Math.max(2, dur) - 1.4) / n)};
function draw(t){hlAt(t,0.2);
  for(let i=0;i<n;i++){const k=(t-0.5-i*gap)/0.5;const el=$('s'+i);el.style.opacity=clamp(k*2);el.style.transform='translateY('+((1-back(k))*S*0.06)+'px) scale('+(0.85+0.15*back(k))+')'}
  for(let i=0;i<n-1;i++){const l=$('k'+i);const len=parseFloat(l.getAttribute('stroke-dasharray'));l.style.strokeDashoffset=len*(1-easeIO((t-0.8-i*gap)/gap))}}` });
  },

  "mg-features"({ W, H, L, V, text, dur, seed }) {
    const items = (text.bullets ?? []).map((b) => String(b ?? "").trim()).filter(Boolean).slice(0, 6);
    const n = items.length, wide = W >= H;
    const cols = wide ? (n <= 3 ? n : n === 4 ? 2 : 3) : n <= 2 ? 1 : 2, rows = Math.ceil(n / cols);
    const style = V.pick(["cards", "cards", "row"]), entrance = V.pick(["pop", "rise", "flip"]);
    const gw = W * 0.84, gh = H * (wide ? 0.62 : 0.66), cw = gw / cols, ch = gh / rows;
    const x0 = (W - gw) / 2, y0 = H * (wide ? 0.27 : 0.24);
    const ic = Math.round(Math.min(cw, ch) * 0.34);
    return page({ W, H, L, seed, css: `.fc{position:absolute;display:flex;flex-direction:${style === "row" ? "row" : "column"};align-items:center;justify-content:center;gap:2cqmin;border-radius:${L.fx === "hard" ? "1cqmin" : "2.6cqmin"};padding:2cqmin;text-align:center}
.fc .ic{position:relative}
.ft{font-family:${L.hFont};font-weight:700;font-size:4.2cqmin;line-height:1.2;color:${L.surfInk};overflow-wrap:anywhere}`,
      body: items.map((s, i) => { const c = i % cols, r = Math.floor(i / cols);
        return `<div class="fc surf" id="f${i}" style="left:${x0 + c * cw + cw * 0.05}px;top:${y0 + r * ch + ch * 0.06}px;width:${cw * 0.9}px;height:${ch * 0.88}px">${tile(L, iconFor(s, i), i, ic, `fi${i}`)}<div class="ft">${esc(s)}</div></div>`; }).join("") + headline(text, "top"),
      script: `${HL_JS}const n=${n},en=${JSON.stringify(entrance)},gap=${Math.min(0.35, (Math.max(2, dur) - 1.2) / n)};
function draw(t){hlAt(t,0.2);
  for(let i=0;i<n;i++){const k=(t-0.5-i*gap)/0.5;const el=$('f'+i);el.style.opacity=clamp(k*2);
    el.style.transform=en==='pop'?'scale('+(0.6+0.4*back(k))+')':en==='rise'?'translateY('+((1-ease(k))*S*0.08)+'px)':'perspective('+S+'px) rotateY('+((1-back(k))*80)+'deg)'}}` });
  },

  "mg-compare"({ W, H, L, V, text, seed }) {
    const c = parseCompare(text.bullets);
    const wide = W >= H, divider = V.pick(["wipe", "slide", "fade"]);
    const panel = (side, i) => {
      const good = side === 1, list = good ? c.right : c.left;
      const box = wide ? `left:${good ? 52 : 6}%;width:42%;top:24%;height:66%` : `left:7%;right:7%;top:${good ? 59 : 22}%;height:34%`;
      return `<div class="cp surf" id="pn${i}" style="${box};${good ? `border-color:${L.onAcc}` : "filter:saturate(.35)"}"><div class="cl" style="color:${good ? L.onAcc : L.surfInk};opacity:${good ? 1 : 0.7}">${esc(c.labels[i])}</div>${list.map((t, k) => `<div class="ci" id="ci${i}_${k}">${svg(good ? "check" : "x", Math.round(Math.min(W, H) * 0.05), good ? L.onAcc : L.hot)}<span>${esc(t)}</span></div>`).join("")}</div>`;
    };
    return page({ W, H, L, seed, css: `.cp{position:absolute;border-radius:${L.fx === "hard" ? "1cqmin" : "2.6cqmin"};padding:3.4cqmin;display:flex;flex-direction:column;justify-content:center;gap:2.4cqmin;overflow:hidden}
.cl{font-family:${L.hFont};font-weight:900;font-size:5.4cqmin;text-transform:uppercase;letter-spacing:.06em}
.ci{display:flex;align-items:flex-start;gap:1.6cqmin;font-family:${L.bFont};font-weight:600;font-size:${wide ? 4.2 : 4.6}cqmin;line-height:1.25;color:${L.surfInk}}
.ci svg{flex:none;margin-top:.2cqmin}`,
      body: panel(0, 0) + panel(1, 1) + headline(text, "top"),
      script: `${HL_JS}const dv=${JSON.stringify(divider)},NL=${c.left.length},NR=${c.right.length};
function draw(t){hlAt(t,0.2);
  for(const [i,d] of [[0,0.3],[1,1.2]]){const k=ease((t-d)/0.6);const p=$('pn'+i);p.style.opacity=k;
    p.style.transform=dv==='slide'?'translateX('+((1-k)*(i?1:-1)*S*0.15)+'px)':dv==='wipe'?'none':'scale('+(0.95+0.05*k)+')';
    if(dv==='wipe')p.style.clipPath='inset(0 '+((1-k)*100)+'% 0 0)';
    const N=i?NR:NL;for(let j=0;j<N;j++){const e=$('ci'+i+'_'+j);const q=ease((t-d-0.3-j*0.18)/0.4);e.style.opacity=q;e.style.transform='translateX('+(1-q)*S*0.03+'px)'}}}` });
  },

  "mg-browser"({ W, H, L, V, text, dur, seed }) {
    const items = (text.bullets ?? []).map((b) => String(b ?? "").trim()).filter(Boolean).slice(0, 4);
    const wide = W >= H, frame = V.pick(["browser", "app"]), cursor = V.next() < 0.7;
    const bw = W * (wide ? 0.8 : 0.88), bh = H * (wide ? 0.78 : 0.62), x = (W - bw) / 2, y = H * (wide ? 0.13 : 0.2);
    return page({ W, H, L, seed, css: `#win{position:absolute;left:${x}px;top:${y}px;width:${bw}px;height:${bh}px;border-radius:${frame === "app" ? 3 : 1.6}cqmin;overflow:hidden}
#bar{position:absolute;left:0;right:0;top:0;height:7%;display:flex;align-items:center;gap:1cqmin;padding:0 2cqmin;background:${L.dark ? "#ffffff10" : "#0f172a0a"};border-bottom:1px solid var(--bord)}
.dt{width:1.4cqmin;height:1.4cqmin;border-radius:50%}
#addr{margin-left:2cqmin;flex:1;height:55%;border-radius:99px;background:${L.dark ? "#ffffff14" : "#ffffff"};border:1px solid var(--bord)}
#hero{position:absolute;left:6%;right:40%;top:16%;font-family:${L.hFont};font-weight:900;font-size:${wide ? 5.6 : 6}cqmin;line-height:1.08;color:${L.surfInk}}
#hs{position:absolute;left:6%;right:40%;top:${wide ? 42 : 40}%;font-family:${L.bFont};font-size:3cqmin;line-height:1.3;color:${L.surfInk};opacity:.8}
#btn{position:absolute;left:6%;top:${wide ? 58 : 56}%;padding:1.4cqmin 3.4cqmin;border-radius:${L.fx === "hard" ? "1cqmin" : "99px"};background:${L.acc};font-family:${L.hFont};font-weight:800;font-size:2.8cqmin;color:#fff}
#art{position:absolute;right:5%;top:15%;width:31%;height:46%;border-radius:2cqmin;background:linear-gradient(145deg,${L.acc},${L.acc2});display:flex;align-items:center;justify-content:center}
.cd{position:absolute;bottom:5%;height:24%;border-radius:1.6cqmin;padding:1.6cqmin;display:flex;flex-direction:column;gap:1cqmin;font-family:${L.bFont};font-weight:600;font-size:2.6cqmin;color:${L.surfInk};background:${L.dark ? "#ffffff0d" : "#f8fafc"};border:1px solid var(--bord)}
#cur{position:absolute;left:0;top:0;width:3.4cqmin;height:3.4cqmin;z-index:9}`,
      body: `<div class="surf" id="win"><div id="bar"><div class="dt" style="background:#ef4444"></div><div class="dt" style="background:#f59e0b"></div><div class="dt" style="background:#22c55e"></div>${frame === "browser" ? '<div id="addr"></div>' : ""}</div>
${text.headline ? `<div id="hero" data-fit style="max-height:26%">${esc(text.headline)}</div>` : ""}${text.sub ? `<div id="hs">${esc(text.sub)}</div>` : ""}<div id="btn">${esc(V.pick(["Get started", "Try it", "Learn more", "Start now"]))}</div>
<div id="art">${svg(V.pick(["sparkles", "chart", "users", "zap", "globe"]), Math.min(bw, bh) * 0.16)}</div>
${items.map((s, i) => `<div class="cd" id="cd${i}" style="left:${6 + i * (88 / Math.max(1, items.length))}%;width:${88 / Math.max(1, items.length) - 2}%">${svg(iconFor(s, i), Math.round(Math.min(W, H) * 0.035), L.acc)}<span>${esc(s)}</span></div>`).join("")}</div>
${cursor ? `<svg id="cur" viewBox="0 0 24 24" fill="${L.dark ? "#fff" : "#0f172a"}" stroke="${L.dark ? "#0f172a" : "#fff"}" stroke-width="1.5"><path d="M4 2l16 9-7 2-3 7z"/></svg>` : ""}`,
      script: `const n=${items.length},bx=${x},by=${y},bw=${bw},bh=${bh},D=${dur};const win=$('win'),cur=$('cur'),btn=$('btn');
function draw(t){const k=ease(t/0.7);win.style.opacity=k;win.style.transform='translateY('+(1-k)*S*0.06+'px) scale('+(0.94+0.06*k)+')';
  for(const [id,d] of [['hero',0.4],['hs',0.6],['btn',0.8],['art',0.5]]){const e=$(id);if(e){const q=ease((t-d)/0.6);e.style.opacity=q;e.style.transform='translateY('+(1-q)*S*0.03+'px)'}}
  for(let i=0;i<n;i++){const e=$('cd'+i);const q=back((t-1+i*-0.0-i*0.2)/0.5);e.style.opacity=clamp((t-1-i*0.2)*3);e.style.transform='translateY('+(1-q)*S*0.05+'px)'}
  if(cur){const a=easeIO((t-1.2)/Math.max(0.8,D*0.35));const sx=bx+bw*0.8,sy=by+bh*0.9,tx=bx+bw*0.06+S*0.08,ty=by+bh*(${wide ? 0.58 : 0.56})+S*0.03;
    cur.style.transform='translate('+(sx+(tx-sx)*a)+'px,'+(sy+(ty-sy)*a)+'px)';cur.style.opacity=clamp((t-1)*3);
    const press=Math.max(0,1-Math.abs(t-(1.2+Math.max(0.8,D*0.35)+0.15))/0.15);if(btn)btn.style.filter='brightness('+(1+press*0.4)+')';if(btn&&press>0)btn.style.transform='scale('+(1-press*0.06)+')'}}` });
  },
};

/**
 * The HTML page for one animated scene at W×H. `over` = the scene has media: over-media layouts become a transparent
 * overlay. `dur` = the scene length (s). `look` = a LOOKS key or "auto"; `seed` = the deck's seed; `variant` = something
 * unique to the scene (its id) — together they pick this scene's variant. `stars` lowers the starfield for small previews.
 */
export function motionHtml({ layout, text = {}, W, H, brand = {}, dur = 4, over = false, stars = 200, fontsCss = "", look: lookName = "auto", seed = 0, variant = "" }) {
  const tpl = TEMPLATES[layout] ?? TEMPLATES["mg-words"];
  const s = Math.round(num(seed, 0));
  const lookKey = resolveLook(lookName, s);
  const vseed = hash32(`${s}:${variant}:${layout}`);
  const t = { headline: String(text?.headline ?? ""), sub: String(text?.sub ?? ""), bullets: Array.isArray(text?.bullets) ? text.bullets : [] };
  return tpl({ W: Math.round(W), H: Math.round(H), L: look(lookKey, brand ?? {}, fontsCss, Math.max(0, Math.round(num(stars, 200)))), V: rng(vseed), seed: vseed,
    text: t, brand: brand ?? {}, dur: Math.max(1, num(dur, 4)), over: !!over && OVER_MEDIA_LAYOUTS.includes(layout) });
}

/** Whether the page draws its own background (false = transparent overlay over the media). */
export const motionOpaque = (layout, hasMedia) => !(hasMedia && OVER_MEDIA_LAYOUTS.includes(layout));
/** A moment where every element of the layout has arrived (slide exports, the editor's still preview). */
export const settledAt = (dur) => Math.max(2.4, Math.min(num(dur, 4) * 0.85, 6));
