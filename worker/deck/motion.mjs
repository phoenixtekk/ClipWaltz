// WaltzDeck animated scenes ("Explainer" look, owner-approved TxtYa proof 2026-10-04): motion-graphics layouts drawn by
// Chromium from HTML, one frame at a time. Every page exposes `render(t)` (t = seconds) — each frame is a pure function
// of t, so the render (worker/render-worker.mjs via text-layer.mjs renderMotion), the editor preview (an iframe in
// src/components/deck/scene-frame.tsx) and the slide exports (export.mjs, one settled frame) all draw the same thing.
// Shared look: dark space, twinkling stars, the brand's main colour as the glow. No Node imports — the app bundles this.
//
// Scene text → template:
//   mg-orbit   headline                         app icons orbiting a glowing phone
//   mg-swarm   headline                         notification badges piling onto a phone, counter to 99+
//   mg-words   headline (+ sub)                 words punch in one by one, a glow line sweeps under (over media too)
//   mg-logo    headline = name, sub = tagline   shockwave + light sweep, letters assemble (brand logo above, if any)
//   mg-chat    headline = chat name, bullets = "Name: message (Channel)", "Me: …" for the sender's own
//   mg-fanout  headline, bullets = channels     one message branching out to each channel and back
//   mg-end     headline = name, sub, bullets[0] = web address / CTA pill (over media too)

export const MOTION_LAYOUTS = ["mg-orbit", "mg-swarm", "mg-words", "mg-logo", "mg-chat", "mg-fanout", "mg-end"];
/** Layouts that sit over the scene's media when it has some (transparent page, a dark veil for legibility). */
export const OVER_MEDIA_LAYOUTS = ["mg-words", "mg-chat", "mg-end"];
export const isMotionLayout = (l) => MOTION_LAYOUTS.includes(l);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c : d);
const cssFont = (f, fallback) => `'${String(f || fallback).replace(/[^A-Za-z0-9 -]/g, "").slice(0, 40) || fallback}', sans-serif`;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
/** A logo the page may load: an inline image (render / export) or the app's own brand-logo route (editor preview). */
const okLogo = (u) => (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(u ?? "") || /^\/api\/projects\/[\w-]+\/brand-logo(\?[\w=&.-]*)?$/.test(u ?? "") ? u : null);

// Lucide icon paths (ISC licence), stroked white.
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
};
const svg = (k, size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${G[k] ?? G.send}</svg>`;
const ICONS = [
  ["chat", "#22c55e", "#15803d"], ["mail", "#3b82f6", "#1d4ed8"], ["phone", "#10b981", "#047857"], ["at", "#f59e0b", "#b45309"],
  ["users", "#8b5cf6", "#6d28d9"], ["bell", "#ef4444", "#b91c1c"], ["hash", "#ec4899", "#be185d"], ["send", "#06b6d4", "#0e7490"], ["video", "#6366f1", "#4338ca"],
  ["globe", "#14b8a6", "#0f766e"],
];
const iconBox = (i, size, id) => {
  const [k, a, b] = ICONS[i % ICONS.length];
  return `<div class="ic" id="${id}" style="width:${size}px;height:${size}px;border-radius:${size * 0.24}px;background:linear-gradient(145deg,${a},${b});box-shadow:0 0 ${size * 0.5}px ${a}88, inset 0 ${size * 0.04}px 0 #ffffff44">${svg(k, size * 0.5)}</div>`;
};
/** An icon for a channel label: SMS/text → phone, email → mail, team/slack/teams → hash, chat/WhatsApp → chat. */
function channelIcon(label, i) {
  const l = String(label).toLowerCase();
  const k = /sms|text|phone|call/.test(l) ? 2 : /mail/.test(l) ? 1 : /team|slack|discord|channel/.test(l) ? 6 : /chat|whats|messag|telegram|signal/.test(l) ? 0
    : /video|zoom|meet/.test(l) ? 8 : /web|site|online/.test(l) ? 9 : [0, 1, 2, 6, 3, 4][i % 6];
  return k;
}

/** The look: glow = the brand's main colour (cyan by default), the space tinted by its background colour. */
function look(brand = {}, stars = 200, fontsCss = "") {
  const glow = hex(brand.primary, "#22d3ee");
  return {
    stars,
    // The editor preview loads the brand fonts from Google Fonts (the render box has them installed).
    fontsCss: /^https:\/\/fonts\.googleapis\.com\/css2\?[\w=&;:@.+%-]+$/.test(fontsCss) ? `<link rel="stylesheet" href="${esc(fontsCss)}">` : "",
    glow, bg0: "#030712", bg1: hex(brand.secondary, "#0b1a3a"), hot: "#ef4444",
    hFont: cssFont(brand.headingFont, "Montserrat"), bFont: cssFont(brand.bodyFont, "Inter"),
  };
}

/** Shared page shell: background, starfield, easing helpers; `script` defines draw(t). */
function page({ W, H, L, transparent, css = "", body = "", script = "" }) {
  return `<!doctype html><html><head><meta charset="utf-8">${L.fontsCss}<style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;background:${transparent ? "transparent" : L.bg0}}
*{box-sizing:border-box}
#bg{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%, ${L.bg1} 0%, ${L.bg0} 100%)}
#bg:after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%, ${L.glow}1f 0%, transparent 60%)}
#stars{position:absolute;inset:-5%}
.st{position:absolute;border-radius:50%;background:#fff}
.ic{position:absolute;left:0;top:0;display:flex;align-items:center;justify-content:center;will-change:transform}
.phone{position:absolute;z-index:3;border-radius:7%/3.5%;background:#0b1224;border:max(2px,0.8cqmin) solid #334155;box-shadow:0 0 9cqmin ${L.glow}66}
.screen{position:absolute;inset:1.2cqmin;border-radius:6%/3%;overflow:hidden;background:linear-gradient(170deg,${L.glow}38 0%,#0a2540 45%,#081a33 100%)}
.notch{position:absolute;top:1.2cqmin;left:50%;width:34%;height:2.2cqmin;transform:translateX(-50%);background:#0b1224;border-radius:99px;z-index:3}
.h{font-family:${L.hFont};font-weight:800;color:#fff;letter-spacing:-.01em;margin:0}
.hl{position:absolute;left:5%;right:5%;top:6%;text-align:center;font-size:6.2cqmin;line-height:1.1;z-index:20;text-shadow:0 0 3cqmin ${L.glow}aa,0 0 1cqmin #000}
body{container-type:size}
${css}
</style></head><body>${transparent ? "" : '<div id="bg"></div><div id="stars"></div>'}${body}<script>
// One scope per page: the render reuses a browser page and setContent keeps the JS realm (top-level consts would collide).
(() => {
const W=${W},H=${H},S=Math.min(W,H);
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const ease=(x)=>{x=clamp(x);return 1-Math.pow(1-x,3)};
const easeIO=(x)=>{x=clamp(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2};
const back=(x)=>{x=clamp(x);const c=1.70158,c3=c+1;return 1+c3*Math.pow(x-1,3)+c*Math.pow(x-1,2)};
let seed=7;const rnd=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const stars=[];const sf=document.getElementById('stars');
if(sf){for(let i=0;i<${L.stars};i++){const d=document.createElement('div');d.className='st';const s=(rnd()*2.2+0.6)*S/1080;
  Object.assign(d.style,{left:rnd()*100+'%',top:rnd()*100+'%',width:s+'px',height:s+'px'});sf.appendChild(d);stars.push({d,p:rnd()*6.28,f:0.6+rnd()*1.8,b:0.25+rnd()*0.6})}}
function starsAt(t){for(const s of stars)s.d.style.opacity=(s.b+0.35*Math.sin(s.p+t*s.f)).toFixed(3);if(sf)sf.style.transform='scale('+(1+t*0.012)+')'}
const $=(id)=>document.getElementById(id);
${script}
window.render=(t)=>{starsAt(t);draw(t)};
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

const phoneBox = ({ w, h, x, y, id = "ph", screen = "", extra = "" }) =>
  `<div class="phone" id="${id}" style="width:${w}px;height:${h}px;left:${x - w / 2}px;top:${y - h / 2}px"><div class="notch"></div>${extra}<div class="screen">${screen}</div></div>`;

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

const TEMPLATES = {
  "mg-orbit"({ W, H, L, text }) {
    const pw = Math.min(W * 0.3, H * 0.28), ph = pw * 2, cy = H * 0.54, n = 9, size = Math.round(Math.min(W, H) * 0.105);
    return page({ W, H, L, css: `#ring{position:absolute;left:${W / 2 - W * 0.38}px;top:${cy - H * 0.11}px;width:${W * 0.76}px;height:${H * 0.22}px;border-radius:50%;border:2px solid ${L.glow}55;box-shadow:0 0 2cqmin ${L.glow}55}`,
      body: `<div id="ring"></div>${phoneBox({ w: pw, h: ph, x: W / 2, y: cy, screen: `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${svg("chat", pw * 0.35)}</div>` })}${Array.from({ length: n }, (_, i) => iconBox(i, size, `o${i}`)).join("")}${text.headline ? `<h1 class="h hl" id="hl" data-fit style="max-height:16%">${esc(text.headline)}</h1>` : ""}`,
      script: `const n=${n},rx=W*0.38,ry=H*0.11,cy=${cy},size=${size};const ph=$('ph'),hl=$('hl');
function draw(t){const intro=ease(t/1.2);
  ph.style.transform='translateY('+(Math.sin(t*1.3)*S*0.01+(1-intro)*S*0.08)+'px) rotate('+(Math.sin(t*0.8)*2)+'deg)';ph.style.opacity=intro;
  for(let i=0;i<n;i++){const el=$('o'+i);const a=t*0.55+i*6.283/n;const z=Math.sin(a);
    const x=W/2+Math.cos(a)*rx*(0.6+0.4*intro);const y=cy+z*ry-H*0.02;const s=(0.72+0.38*(z+1)/2)*(0.4+0.6*ease((t-0.15*i/n)/1));
    el.style.transform='translate('+(x-size/2)+'px,'+(y-size/2)+'px) scale('+s+')';el.style.zIndex=z>0?5:1;
    el.style.filter=z>0?'none':'blur('+(2*(-z)).toFixed(2)+'px) brightness(.75)';el.style.opacity=ease(t/0.8)}
  if(hl){hl.style.opacity=ease((t-0.5)/0.8);hl.style.transform='translateY('+(1-ease((t-0.5)/0.8))*S*0.03+'px)'}}` });
  },

  "mg-swarm"({ W, H, L, text, dur }) {
    const pw = Math.min(W * 0.3, H * 0.28), ph = pw * 2, cy = H * 0.56, n = 46;
    return page({ W, H, L, css: `.bd{position:absolute;left:0;top:0;border-radius:99px;background:radial-gradient(circle at 35% 30%,#ff7a7a,${L.hot} 55%,#991b1b);color:#fff;font-family:${L.hFont};font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 0 2cqmin #ef444499;will-change:transform}
#cnt{position:absolute;left:auto;top:-3cqmin;right:-3cqmin;min-width:9cqmin;height:9cqmin;padding:0 1.5cqmin;font-size:4.5cqmin;z-index:9}
.msg{position:absolute;left:8%;right:8%;height:7%;border-radius:1.4cqmin;background:#ffffff1f;border:1px solid #ffffff22}
.hl{text-shadow:0 0 3cqmin #ef444488,0 0 1cqmin #000}`,
      body: phoneBox({ w: pw, h: ph, x: W / 2, y: cy, extra: '<div class="bd" id="cnt">0</div>', screen: Array.from({ length: 8 }, (_, i) => `<div class="msg" id="m${i}" style="top:${8 + i * 11}%"></div>`).join("") }) +
        `<div id="bz"></div>${text.headline ? `<h1 class="h hl" id="hl" data-fit style="max-height:16%">${esc(text.headline)}</h1>` : ""}`,
      script: `const n=${n},px=W/2,py=${cy},pw=${pw},D=${dur};const bz=$('bz');const B=[];
for(let i=0;i<n;i++){const d=document.createElement('div');d.className='bd';const s=S*(0.035+rnd()*0.04);d.style.width=s+'px';d.style.height=s+'px';d.style.fontSize=(s*0.5)+'px';d.textContent=1+Math.floor(rnd()*9);bz.appendChild(d);
  const side=rnd()*6.283;const r=Math.hypot(W,H)*0.6;const ang=rnd()*6.283;const rr=pw*0.6+rnd()*S*0.26;
  B.push({d,s,sx:px+Math.cos(side)*r,sy:py+Math.sin(side)*r,tx:px+Math.cos(ang)*rr*(W>=H?1.25:0.9),ty:py+Math.sin(ang)*rr*(W>=H?0.95:1.3),t0:0.2+i*Math.max(1,D-1.6)/n,ph:rnd()*6.28})}
const ph=$('ph'),cnt=$('cnt'),hl=$('hl');
function draw(t){let arrived=0;
  for(const b of B){const k=(t-b.t0)/0.7;const e=back(k);const x=b.sx+(b.tx-b.sx)*e+Math.sin(t*3+b.ph)*4*clamp(k);const y=b.sy+(b.ty-b.sy)*e+Math.cos(t*2.6+b.ph)*4*clamp(k);
    b.d.style.transform='translate('+(x-b.s/2)+'px,'+(y-b.s/2)+'px) scale('+(k<0?0:0.6+0.4*clamp(k*1.5))+')';b.d.style.opacity=k<0?0:1;if(k>=1)arrived++}
  const c=Math.round(arrived*99/n*1.15);cnt.textContent=c>=99?'99+':c;
  const shake=clamp((t-D*0.45)/(D*0.5));ph.style.transform='translate('+(Math.sin(t*41)*shake*S*0.005)+'px,'+(Math.cos(t*37)*shake*S*0.004)+'px) rotate('+(Math.sin(t*29)*shake*1.2)+'deg)';
  for(let i=0;i<8;i++)$('m'+i).style.opacity=clamp((t-0.3-i*0.35)/0.3);
  if(hl)hl.style.opacity=ease((t-0.4)/0.7)}` });
  },

  "mg-words"({ W, H, L, text, dur, over }) {
    const words = String(text.headline ?? "").split(/\s+/).filter(Boolean).slice(0, 8);
    return page({ W, H, L, transparent: over, css: `#wrap{position:absolute;left:6%;right:6%;top:30%;height:30%;display:flex;flex-wrap:wrap;align-content:center;justify-content:center;column-gap:.28em;font-size:${W >= H ? 15 : 13}cqmin}
.w{font-family:${L.hFont};font-weight:900;color:#fff;line-height:1.05;text-shadow:0 0 .27em ${L.glow},0 0 .08em ${L.glow};display:inline-block;will-change:transform}
#ln{position:absolute;top:63%;left:50%;height:0.7cqmin;border-radius:99px;background:linear-gradient(90deg,transparent,${L.glow},#fff,${L.glow},transparent);box-shadow:0 0 3cqmin ${L.glow}}
#sub{position:absolute;left:8%;right:8%;top:67%;text-align:center;font-family:${L.bFont};font-weight:500;font-size:4.2cqmin;color:#e6f7ff;text-shadow:0 0 1cqmin #000}
#veil{position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(3,7,18,.35), rgba(3,7,18,.75))}`,
      body: `${over ? '<div id="veil"></div>' : ""}<div id="wrap" data-fit>${words.map((w, i) => `<span class="w" id="w${i}">${esc(w)}</span>`).join("")}</div><div id="ln"></div>${text.sub ? `<div id="sub">${esc(text.sub)}</div>` : ""}`,
      script: `const n=${words.length},D=${dur};const ln=$('ln'),veil=$('veil'),sub=$('sub');
function draw(t){if(veil)veil.style.opacity=ease(t/0.4);
  for(let i=0;i<n;i++){const k=(t-0.25-i*0.3)/0.35;const el=$('w'+i);el.style.opacity=clamp(k*2);el.style.transform='scale('+(k<0?2.2:1+1.2*(1-back(k)))+')';el.style.filter='blur('+(Math.max(0,1-clamp(k))*8)+'px)'}
  const l=ease((t-0.25-n*0.3)/0.6);ln.style.width=(W*0.55*l)+'px';ln.style.transform='translateX(-50%)';ln.style.opacity=l;
  if(sub){const k=ease((t-0.45-n*0.3)/0.6);sub.style.opacity=k;sub.style.transform='translateY('+(1-k)*S*0.03+'px)'}}` });
  },

  "mg-logo"({ W, H, L, text, brand }) {
    const letters = [...String(text.headline ?? "")].slice(0, 24);
    const logo = okLogo(brand.logoDataUrl);
    return page({ W, H, L, css: `#lg{position:absolute;left:5%;right:5%;top:${logo ? 40 : 30}%;height:22%;display:flex;justify-content:center;align-items:center;font-size:${W >= H ? 20 : 17}cqmin;white-space:pre}
.l{font-family:${L.hFont};font-weight:900;color:#fff;display:inline-block;text-shadow:0 0 .25em ${L.glow},0 0 .07em #fff}
#tg{position:absolute;left:6%;right:6%;top:${logo ? 66 : 60}%;text-align:center;font-family:${L.bFont};font-weight:500;font-size:4.4cqmin;color:#d8f4ff;letter-spacing:.06em;text-transform:uppercase}
.rg{position:absolute;left:50%;top:44%;border-radius:50%;border:0.6cqmin solid ${L.glow};box-shadow:0 0 4cqmin ${L.glow}, inset 0 0 4cqmin ${L.glow}}
#flash{position:absolute;inset:0;background:radial-gradient(circle at 50% 44%, #ffffff 0%, ${L.glow}88 18%, transparent 55%)}
#sweep{position:absolute;top:0;bottom:0;width:18%;background:linear-gradient(90deg,transparent,#ffffff55,transparent);transform:skewX(-20deg);mix-blend-mode:screen}
#logo{position:absolute;left:50%;top:${W >= H ? 14 : 22}%;height:20%;max-width:50%;object-fit:contain;transform:translateX(-50%);filter:drop-shadow(0 0 2cqmin ${L.glow})}`,
      body: `<div id="flash"></div><div class="rg" id="r0"></div><div class="rg" id="r1"></div>${logo ? `<img id="logo" src="${logo}" alt="">` : ""}<div id="lg" data-fit>${letters.map((c, i) => `<span class="l" id="l${i}">${esc(c)}</span>`).join("")}</div><div id="sweep"></div>${text.sub ? `<div id="tg">${esc(text.sub)}</div>` : ""}`,
      script: `const n=${letters.length};
function draw(t){
  for(const [i,d] of [[0,0],[1,0.18]]){const k=ease((t-0.1-d)/1.1);const r=$('r'+i);const s=S*(0.1+1.3*k);
    r.style.width=s+'px';r.style.height=s+'px';r.style.transform='translate(-50%,-50%)';r.style.opacity=(1-k)*(t>0.1+d?1:0)}
  $('flash').style.opacity=Math.max(0,1-Math.abs(t-0.35)/0.45)*0.9+0.18;
  const lg=$('logo');if(lg){const k=ease((t-0.2)/0.6);lg.style.opacity=k;lg.style.transform='translateX(-50%) scale('+(0.7+0.3*back((t-0.2)/0.6))+')'}
  for(let i=0;i<n;i++){const k=(t-0.3-i*0.07)/0.5;const el=$('l'+i);el.style.opacity=clamp(k*1.6);
    el.style.transform='translateY('+((1-back(k))*S*0.06)+'px) scale('+(0.6+0.4*back(k))+')';el.style.filter='blur('+(Math.max(0,1-clamp(k))*10)+'px)'}
  const sw=$('sweep');const sk=easeIO((t-1.0)/0.9);sw.style.left=(-W*0.2+W*1.4*sk)+'px';sw.style.opacity=sk>0&&sk<1?1:0;
  const tg=$('tg');if(tg){const k2=ease((t-1.1)/0.7);tg.style.opacity=k2;tg.style.transform='translateY('+(1-k2)*S*0.03+'px)'}}` });
  },

  "mg-chat"({ W, H, L, text, dur, over }) {
    const msgs = parseChat(text.bullets);
    const wide = W >= H;
    const phh = H * (wide ? 0.86 : 0.7), pw = phh * 0.49;
    const x = over && wide ? W * 0.72 : W / 2, y = H / 2 + (wide ? 0 : -H * 0.02);
    const u = phh / 100;
    const items = msgs.map((m, i) => `<div class="row ${m.me ? "me" : ""}" id="c${i}"><div class="bub">${m.from ? `<b>${esc(m.from)}</b>` : ""}${esc(m.text)}${m.via ? `<span class="tag" style="background:${ICONS[channelIcon(m.via, i)][1]}">${esc(m.via)}</span>` : ""}</div></div>`).join("");
    return page({ W, H, L, transparent: over, css: `.top{position:absolute;left:0;right:0;top:0;height:${u * 11}px;background:#0b2a45;border-bottom:1px solid #ffffff1a;display:flex;align-items:flex-end;padding:0 ${u * 3}px ${u * 1.6}px;gap:${u * 2}px;font-family:${L.hFont};font-weight:700;color:#fff;font-size:${u * 2.6}px;white-space:nowrap;overflow:hidden}
.av{flex:none;width:${u * 4.4}px;height:${u * 4.4}px;border-radius:50%;background:linear-gradient(145deg,${L.glow},#60a5fa);display:flex;align-items:center;justify-content:center}
.list{position:absolute;left:0;right:0;top:${u * 12}px;bottom:${u * 9}px;display:flex;flex-direction:column;justify-content:flex-end;gap:${u * 1.5}px;padding:0 ${u * 2.6}px;overflow:hidden}
.row{display:flex}.row.me{justify-content:flex-end}
.bub{max-width:80%;font-family:${L.bFont};font-size:${u * 2.15}px;line-height:1.3;color:#e8f6ff;background:#16304d;border:1px solid #ffffff1c;padding:${u * 1.2}px ${u * 1.6}px ${u * 1.9}px;border-radius:${u * 2}px ${u * 2}px ${u * 2}px ${u * 0.5}px;position:relative;transform-origin:left bottom}
.me .bub{background:linear-gradient(145deg,${L.glow},#2563eb);color:#fff;border-radius:${u * 2}px ${u * 2}px ${u * 0.5}px ${u * 2}px;transform-origin:right bottom;box-shadow:0 0 ${u * 3}px ${L.glow}55}
.bub b{display:block;font-size:${u * 1.7}px;color:${L.glow};margin-bottom:${u * 0.3}px;font-family:${L.hFont}}
.me .bub b{color:#fff}
.tag{position:absolute;right:${u * 1.2}px;bottom:-${u * 1}px;font-family:${L.hFont};font-weight:800;font-size:${u * 1.35}px;color:#fff;padding:${u * 0.3}px ${u * 0.9}px;border-radius:99px;box-shadow:0 0 ${u * 1.2}px #0008}
.inp{position:absolute;left:${u * 2.6}px;right:${u * 2.6}px;bottom:${u * 2.4}px;height:${u * 5}px;border-radius:99px;background:#ffffff14;border:1px solid #ffffff22;display:flex;align-items:center;justify-content:flex-end;padding:0 ${u * 0.6}px}
.sendb{width:${u * 4}px;height:${u * 4}px;border-radius:50%;background:${L.glow};display:flex;align-items:center;justify-content:center}
#veil{position:absolute;inset:0;background:${wide ? `linear-gradient(90deg, rgba(3,7,18,0) 30%, rgba(3,7,18,.75) 60%)` : "rgba(3,7,18,.55)"}}`,
      body: `${over ? '<div id="veil"></div>' : ""}${phoneBox({ w: pw, h: phh, x, y, screen: `<div class="top"><div class="av">${svg("users", u * 2.6)}</div>${esc(text.headline || "Group")}</div><div class="list">${items}</div><div class="inp"><div class="sendb">${svg("send", u * 2.2)}</div></div>` })}`,
      script: `const n=${msgs.length};const gap=${(Math.max(1.5, dur) - 1.0) / Math.max(1, msgs.length)};const ph=$('ph'),veil=$('veil');
function draw(t){const k0=ease(t/0.6);ph.style.opacity=k0;ph.style.transform='translateY('+((1-k0)*S*0.05+Math.sin(t*1.1)*S*0.006)+'px)';if(veil)veil.style.opacity=ease(t/0.5);
  for(let i=0;i<n;i++){const k=(t-0.5-i*gap)/0.4;const r=$('c'+i);r.style.display=k<0?'none':'flex';
    const b=r.firstChild;b.style.transform='scale('+back(k)+')';b.style.opacity=clamp(k*2)}}` });
  },

  "mg-fanout"({ W, H, L, text }) {
    const labels = (text.bullets ?? []).map((b) => String(b ?? "").trim()).filter(Boolean).slice(0, 6);
    if (!labels.length) labels.push("SMS", "Chat apps", "Email", "Team chat");
    const n = labels.length, wide = W >= H;
    const cx = W / 2, cy = H * (wide ? 0.58 : 0.56);
    // Targets alternate left / right of the hub, spread top to bottom.
    const pts = labels.map((_, i) => {
      const side = i % 2 ? 1 : -1, row = Math.floor(i / 2), rows = Math.ceil(n / 2);
      const fy = rows === 1 ? 0 : (row / (rows - 1)) * 2 - 1;
      return wide
        ? { x: cx + side * W * (0.33 - (rows > 2 && row === 1 ? 0.05 : 0)), y: cy + fy * H * 0.22 }
        : { x: cx + side * W * 0.3, y: cy + fy * H * 0.24 };
    });
    const size = Math.round(Math.min(W, H) * 0.12), hub = Math.min(W, H) * 0.2;
    return page({ W, H, L, css: `#hub{position:absolute;left:${cx - hub / 2}px;top:${cy - hub / 2}px;width:${hub}px;height:${hub}px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffffffcc,${L.glow} 45%,${L.glow}aa);box-shadow:0 0 8cqmin ${L.glow};display:flex;align-items:center;justify-content:center;z-index:4}
svg#paths{position:absolute;inset:0}
.lb{position:absolute;font-family:${L.hFont};font-weight:700;font-size:3.2cqmin;color:#dff7ff;text-align:center;width:30cqmin;margin-left:-15cqmin;text-shadow:0 0 1cqmin #000}
.dot{position:absolute;left:0;top:0;width:2.2cqmin;height:2.2cqmin;margin:-1.1cqmin;border-radius:50%;background:#fff;box-shadow:0 0 2cqmin ${L.glow},0 0 4cqmin ${L.glow}}`,
      body: `<svg id="paths" viewBox="0 0 ${W} ${H}">${pts.map((p, i) => `<path id="p${i}" d="M${cx} ${cy} C ${(cx + p.x) / 2} ${cy} ${(cx + p.x) / 2} ${p.y} ${p.x} ${p.y}" stroke="${L.glow}" stroke-width="${Math.max(2, Math.min(W, H) * 0.004)}" fill="none" stroke-linecap="round" style="filter:drop-shadow(0 0 6px ${L.glow})"/>`).join("")}</svg>
<div id="hub">${svg("send", hub * 0.45)}</div>${pts.map((p, i) => iconBox(channelIcon(labels[i], i), size, `i${i}`) + `<div class="lb" id="t${i}" style="left:${p.x}px;top:${p.y + size * 0.62}px">${esc(labels[i])}</div>`).join("")}
${pts.map((_, i) => `<div class="dot" id="d${i}"></div><div class="dot" id="e${i}"></div>`).join("")}${text.headline ? `<h1 class="h hl" id="hl" data-fit style="max-height:16%">${esc(text.headline)}</h1>` : ""}`,
      script: `const P=${JSON.stringify(pts)},n=${n},size=${size};const L=[];for(let i=0;i<n;i++){const p=$('p'+i);const len=p.getTotalLength();L.push(len);p.style.strokeDasharray=len;}
function draw(t){$('hub').style.transform='scale('+(back(t/0.6)*(1+0.04*Math.sin(t*4)))+')';
  const hl=$('hl');if(hl)hl.style.opacity=ease((t-0.3)/0.6);
  for(let i=0;i<n;i++){const st=0.6+i*0.18;const k1=easeIO((t-st)/0.7);const p=$('p'+i);p.style.strokeDashoffset=L[i]*(1-k1);
    const k2=back((t-st-0.55)/0.45);$('i'+i).style.transform='translate('+(P[i].x-size/2)+'px,'+(P[i].y-size/2)+'px) scale('+Math.max(0,k2)+')';
    $('t'+i).style.opacity=ease((t-st-0.7)/0.4);
    const d=$('d'+i);const pd=(t-st)/0.7;if(pd>0&&pd<1){const q=p.getPointAtLength(L[i]*easeIO(pd));d.style.transform='translate('+q.x+'px,'+q.y+'px)';d.style.opacity=1}else d.style.opacity=0;
    const e=$('e'+i);const pe=((t-st-1.6)%1.4)/0.9;if(t>st+1.6&&pe<1){const q=p.getPointAtLength(L[i]*(1-easeIO(pe)));e.style.transform='translate('+q.x+'px,'+q.y+'px)';e.style.opacity=1}else e.style.opacity=0}}` });
  },

  "mg-end"({ W, H, L, text, brand, over }) {
    const url = (text.bullets ?? []).map((b) => String(b ?? "").trim()).find(Boolean) ?? "";
    const logo = okLogo(brand.logoDataUrl);
    return page({ W, H, L, transparent: over, css: `#veil{position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(3,7,18,.3), rgba(3,7,18,.82))}
#nm{position:absolute;left:5%;right:5%;top:${logo ? 36 : 28}%;height:20%;display:flex;align-items:center;justify-content:center;text-align:center;font-family:${L.hFont};font-weight:900;font-size:${W >= H ? 16 : 13}cqmin;line-height:1.05;color:#fff;text-shadow:0 0 .3em ${L.glow},0 0 .08em #fff}
#tg{position:absolute;left:6%;right:6%;top:${logo ? 59 : 53}%;text-align:center;font-family:${L.bFont};font-weight:500;font-size:4.2cqmin;color:#d4f3ff;letter-spacing:.04em}
#url{position:absolute;left:50%;top:${logo ? 71 : 67}%;max-width:86%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transform:translateX(-50%);font-family:${L.hFont};font-weight:800;font-size:4cqmin;color:#04121f;background:${L.glow};padding:1.4cqmin 4cqmin;border-radius:99px;box-shadow:0 0 4cqmin ${L.glow}}
#logo{position:absolute;left:50%;top:${W >= H ? 12 : 18}%;height:18%;max-width:50%;object-fit:contain;transform:translateX(-50%);filter:drop-shadow(0 0 2cqmin ${L.glow})}`,
      body: `${over ? '<div id="veil"></div>' : ""}${logo ? `<img id="logo" src="${logo}" alt="">` : ""}${text.headline ? `<div id="nm" data-fit>${esc(text.headline)}</div>` : ""}${text.sub ? `<div id="tg">${esc(text.sub)}</div>` : ""}${url ? `<div id="url">${esc(url)}</div>` : ""}`,
      script: `function draw(t){const v=$('veil');if(v)v.style.opacity=ease(t/0.6);
  const lg=$('logo');if(lg){lg.style.opacity=ease(t/0.6);lg.style.transform='translateX(-50%) scale('+(0.85+0.15*back(t/0.6))+')'}
  const nm=$('nm');if(nm){const a=ease((t-0.2)/0.7);nm.style.opacity=a;nm.style.transform='scale('+(0.9+0.1*back((t-0.2)/0.7))+')';nm.style.filter='blur('+((1-a)*8)+'px)'}
  const tg=$('tg');if(tg){const b=ease((t-0.7)/0.6);tg.style.opacity=b;tg.style.transform='translateY('+(1-b)*S*0.03+'px)'}
  const u=$('url');if(u){u.style.opacity=clamp((t-1.1)/0.3);u.style.transform='translateX(-50%) scale('+Math.max(0,back((t-1.1)/0.5))+')'}}` });
  },
};

/**
 * The HTML page for one animated scene at W×H. `over` = the scene has media: over-media layouts become a transparent
 * overlay (the render composites them on the clip). `dur` = the scene length (s) — some animations pace to it.
 * `stars` lowers the starfield count for the many small previews in the editor.
 */
export function motionHtml({ layout, text = {}, W, H, brand = {}, dur = 4, over = false, stars = 200, fontsCss = "" }) {
  const tpl = TEMPLATES[layout] ?? TEMPLATES["mg-words"];
  const t = { headline: String(text?.headline ?? ""), sub: String(text?.sub ?? ""), bullets: Array.isArray(text?.bullets) ? text.bullets : [] };
  return tpl({ W: Math.round(W), H: Math.round(H), L: look(brand ?? {}, Math.max(0, Math.round(num(stars, 200))), fontsCss), text: t, brand: brand ?? {},
    dur: Math.max(1, num(dur, 4)), over: !!over && OVER_MEDIA_LAYOUTS.includes(layout) });
}

/** Whether the page draws its own background (false = transparent overlay over the media). */
export const motionOpaque = (layout, hasMedia) => !(hasMedia && OVER_MEDIA_LAYOUTS.includes(layout));
/** A moment where every element of the layout has arrived (slide exports, the editor's still preview). */
export const settledAt = (dur) => Math.max(2.4, Math.min(num(dur, 4) * 0.85, 6));
