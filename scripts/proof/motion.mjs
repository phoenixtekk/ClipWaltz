// Proof (2026-10-04): frame-exact motion-graphics templates for an Invideo-style explainer.
// Each template is an HTML page with a `render(t)` function (t = seconds); the renderer steps t frame by frame,
// screenshots, and pipes the frames into ffmpeg. No CSS animations: every frame is a pure function of t, so
// renders are deterministic and frame-accurate. One shared look ("style bible": navy space, cyan glow) so
// every shot reads as the same film.
import { spawn } from "node:child_process";

export const STYLE = {
  bg0: "#030712", bg1: "#0b1a3a", glow: "#22d3ee", glow2: "#60a5fa", hot: "#ef4444", ink: "#ffffff",
  font: "'Montserrat', 'Segoe UI', sans-serif", body: "'Inter', 'Segoe UI', sans-serif",
};

// Glyphs: Lucide icon paths (ISC licence), stroked white.
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
};
const svg = (k, size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${G[k]}</svg>`;
const ICONS = [
  ["chat", "#22c55e", "#15803d"], ["mail", "#3b82f6", "#1d4ed8"], ["phone", "#10b981", "#047857"], ["at", "#f59e0b", "#b45309"],
  ["users", "#8b5cf6", "#6d28d9"], ["bell", "#ef4444", "#b91c1c"], ["hash", "#ec4899", "#be185d"], ["send", "#06b6d4", "#0e7490"], ["video", "#6366f1", "#4338ca"],
];
const icon = (i, size) => {
  const [k, a, b] = ICONS[i % ICONS.length];
  return `<div class="ic" style="width:${size}px;height:${size}px;border-radius:${size * 0.24}px;background:linear-gradient(145deg,${a},${b});box-shadow:0 0 ${size * 0.5}px ${a}88, inset 0 ${size * 0.04}px 0 #ffffff44">${svg(k, size * 0.5)}</div>`;
};

/** Shared page shell: background, starfield, helpers (ease, rng, clamp) available to every template script. */
function page({ W, H, transparent = false, css = "", body = "", script = "" }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;background:${transparent ? "transparent" : STYLE.bg0}}
*{box-sizing:border-box}
#bg{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%, ${STYLE.bg1} 0%, #071029 45%, ${STYLE.bg0} 100%)}
#stars{position:absolute;inset:-5%}
.st{position:absolute;border-radius:50%;background:#fff}
.ic{position:absolute;display:flex;align-items:center;justify-content:center;will-change:transform}
.phone{position:absolute;z-index:3;border-radius:${H * 0.05}px;background:#0b1224;border:${H * 0.008}px solid #334155;box-shadow:0 0 ${H * 0.09}px ${STYLE.glow}66, inset 0 0 0 ${H * 0.004}px #0f172a}
.screen{position:absolute;inset:${H * 0.012}px;border-radius:${H * 0.04}px;overflow:hidden;background:linear-gradient(170deg,#0e3a5c 0%,#0a2540 40%,#081a33 100%)}
.notch{position:absolute;top:${H * 0.012}px;left:50%;width:34%;height:${H * 0.022}px;transform:translateX(-50%);background:#0b1224;border-radius:99px;z-index:3}
.h{font-family:${STYLE.font};font-weight:800;color:#fff;letter-spacing:-.01em;margin:0}
${css}
</style></head><body>${transparent ? "" : '<div id="bg"></div><div id="stars"></div>'}${body}<script>
const W=${W},H=${H};
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const ease=(x)=>{x=clamp(x);return 1-Math.pow(1-x,3)};          // out-cubic
const easeIO=(x)=>{x=clamp(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2};
const back=(x)=>{x=clamp(x);const c=1.70158,c3=c+1;return 1+c3*Math.pow(x-1,3)+c*Math.pow(x-1,2)}; // out-back (overshoot)
let seed=7;const rnd=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const stars=[];const sf=document.getElementById('stars');
if(sf){for(let i=0;i<220;i++){const d=document.createElement('div');d.className='st';const s=rnd()*2.2+0.6;
  Object.assign(d.style,{left:rnd()*100+'%',top:rnd()*100+'%',width:s+'px',height:s+'px'});sf.appendChild(d);stars.push({d,p:rnd()*6.28,f:0.6+rnd()*1.8,b:0.25+rnd()*0.6})}}
function starsAt(t){for(const s of stars)s.d.style.opacity=(s.b+0.35*Math.sin(s.p+t*s.f)).toFixed(3);if(sf)sf.style.transform='scale('+(1+t*0.012)+')'}
${script}
window.render=(t)=>{starsAt(t);draw(t)};
</script></body></html>`;
}

function phoneMarkup(W, H, { w, h, x, y, id = "ph", screen = "" }) {
  return `<div class="phone" id="${id}" style="width:${w}px;height:${h}px;left:${x - w / 2}px;top:${y - h / 2}px"><div class="notch"></div><div class="screen">${screen}</div></div>`;
}

export const templates = {
  /** Just the shared background: navy space, twinkling stars, a slow drift. */
  starfield({ W, H }) {
    return page({ W, H, script: "function draw(t){}" });
  },

  /** App icons orbiting a glowing phone on an tilted ellipse (depth = scale + blur), headline fades in. */
  iconOrbit({ W, H, dur, headline = "" }) {
    const ph = { w: H * 0.3, h: H * 0.6, x: W / 2, y: H * 0.52 };
    const n = 9, size = Math.round(H * 0.105);
    const icons = Array.from({ length: n }, (_, i) => icon(i, size).replace('class="ic"', `class="ic" id="o${i}"`)).join("");
    return page({ W, H, css: `#hl{position:absolute;left:0;right:0;top:${H * 0.07}px;text-align:center;font-size:${H * 0.062}px;text-shadow:0 0 ${H * 0.03}px ${STYLE.glow}aa}
#halo{position:absolute;left:${W / 2 - H * 0.45}px;top:${ph.y - H * 0.45}px;width:${H * 0.9}px;height:${H * 0.9}px;border-radius:50%;background:radial-gradient(circle, ${STYLE.glow}44 0%, transparent 62%)}
#ring{position:absolute;left:${W / 2 - W * 0.33}px;top:${ph.y - H * 0.12}px;width:${W * 0.66}px;height:${H * 0.24}px;border-radius:50%;border:2px solid ${STYLE.glow}55;box-shadow:0 0 ${H * 0.02}px ${STYLE.glow}55}`,
      body: `<div id="halo"></div><div id="ring"></div>${phoneMarkup(W, H, { ...ph, screen: `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${svg("chat", H * 0.1)}</div>` })}${icons}<h1 class="h" id="hl">${headline}</h1>`,
      script: `const n=${n},rx=W*0.33,ry=H*0.12,cy=${ph.y},size=${size};const ph=document.getElementById('ph');const hl=document.getElementById('hl');
function draw(t){
  const intro=ease(t/1.2);
  ph.style.transform='translateY('+(Math.sin(t*1.3)*H*0.01+(1-intro)*H*0.08)+'px) rotate('+(Math.sin(t*0.8)*2)+'deg)';ph.style.opacity=intro;
  for(let i=0;i<n;i++){const el=document.getElementById('o'+i);const a=t*0.55+i*6.283/n;
    const z=Math.sin(a);const x=W/2+Math.cos(a)*rx*(0.6+0.4*intro);const y=cy+z*ry-H*0.02;const s=(0.72+0.38*(z+1)/2)*(0.4+0.6*ease((t-0.15*i/n)/1));
    el.style.transform='translate('+(x-size/2)+'px,'+(y-size/2)+'px) scale('+s+')';el.style.zIndex=z>0?5:1;
    el.style.filter=z>0?'none':'blur('+(2*(-z)).toFixed(2)+'px) brightness(.75)';el.style.opacity=ease(t/0.8)}
  hl.style.opacity=ease((t-0.5)/0.8);hl.style.transform='translateY('+(1-ease((t-0.5)/0.8))*H*0.03+'px)';
}` });
  },

  /** Red notification badges stream in from the edges and pile up around a phone; counter climbs to 99+. */
  notificationSwarm({ W, H, dur, headline = "" }) {
    const ph = { w: H * 0.3, h: H * 0.6, x: W / 2, y: H * 0.54 };
    const n = 46;
    return page({ W, H, css: `.bd{position:absolute;border-radius:99px;background:radial-gradient(circle at 35% 30%,#ff7a7a,${STYLE.hot} 55%,#991b1b);color:#fff;font-family:${STYLE.font};font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 0 ${H * 0.02}px #ef444499;will-change:transform}
#hl{position:absolute;z-index:20;left:0;right:0;top:${H * 0.06}px;text-align:center;font-size:${H * 0.062}px;text-shadow:0 0 ${H * 0.03}px #ef444488,0 0 ${H * 0.01}px #000}
#cnt{position:absolute;right:-${H * 0.03}px;top:-${H * 0.03}px;min-width:${H * 0.09}px;height:${H * 0.09}px;padding:0 ${H * 0.015}px;font-size:${H * 0.045}px;z-index:9}
.msg{position:absolute;left:8%;right:8%;height:${H * 0.05}px;border-radius:${H * 0.014}px;background:#ffffff1f;border:1px solid #ffffff22}`,
      body: phoneMarkup(W, H, { ...ph, screen: Array.from({ length: 8 }, (_, i) => `<div class="msg" id="m${i}" style="top:${8 + i * 11}%"></div>`).join("") })
        .replace('<div class="notch"></div>', `<div class="notch"></div><div class="bd" id="cnt">0</div>`) + `<div id="bz"></div><h1 class="h" id="hl">${headline}</h1>`,
      script: `const n=${n},px=${ph.x},py=${ph.y},pw=${ph.w},phh=${ph.h};const bz=document.getElementById('bz');const B=[];
for(let i=0;i<n;i++){const d=document.createElement('div');d.className='bd';const s=H*(0.035+rnd()*0.04);d.style.width=s+'px';d.style.height=s+'px';d.style.fontSize=(s*0.5)+'px';d.textContent=1+Math.floor(rnd()*9);bz.appendChild(d);
  const side=rnd()*6.283;const r=Math.hypot(W,H)*0.6;const ang=rnd()*6.283;const rr=pw*0.6+rnd()*H*0.26;
  B.push({d,s,sx:px+Math.cos(side)*r,sy:py+Math.sin(side)*r,tx:px+Math.cos(ang)*rr*1.25,ty:py+Math.sin(ang)*rr*0.95,t0:0.2+i*(${dur}-1.6)/n,ph:rnd()*6.28})}
const ph=document.getElementById('ph'),cnt=document.getElementById('cnt'),hl=document.getElementById('hl');
function draw(t){
  let arrived=0;
  for(const b of B){const k=(t-b.t0)/0.7;const e=back(k);const x=b.sx+(b.tx-b.sx)*e+Math.sin(t*3+b.ph)*4*clamp(k);const y=b.sy+(b.ty-b.sy)*e+Math.cos(t*2.6+b.ph)*4*clamp(k);
    b.d.style.transform='translate('+(x-b.s/2)+'px,'+(y-b.s/2)+'px) scale('+(k<0?0:0.6+0.4*clamp(k*1.5))+')';b.d.style.opacity=k<0?0:1;if(k>=1)arrived++}
  const c=Math.round(arrived*99/n*1.15);cnt.textContent=c>=99?'99+':c;
  const shake=clamp((t-${dur * 0.45})/${dur * 0.5});ph.style.transform='translate('+(Math.sin(t*41)*shake*5)+'px,'+(Math.cos(t*37)*shake*4)+'px) rotate('+(Math.sin(t*29)*shake*1.2)+'deg)';
  for(let i=0;i<8;i++){const m=document.getElementById('m'+i);m.style.opacity=clamp((t-0.3-i*0.35)/0.3)}
  hl.style.opacity=ease((t-0.4)/0.7);
}` });
  },

  /** Transparent overlay: words punch in one by one, a glowing line sweeps beneath. Meant to sit over a Wan clip. */
  kineticText({ W, H, dur, words = ["Why", "force", "it?"] }) {
    return page({ W, H, transparent: true, css: `#wrap{position:absolute;left:0;right:0;top:50%;transform:translateY(-55%);display:flex;justify-content:center;gap:${H * 0.035}px}
.w{font-family:${STYLE.font};font-weight:900;font-size:${H * 0.15}px;color:#fff;text-shadow:0 0 ${H * 0.04}px ${STYLE.glow},0 0 ${H * 0.012}px ${STYLE.glow};display:inline-block;will-change:transform}
#ln{position:absolute;top:${H * 0.62}px;left:50%;height:${H * 0.007}px;border-radius:99px;background:linear-gradient(90deg,transparent,${STYLE.glow},#fff,${STYLE.glow},transparent);box-shadow:0 0 ${H * 0.03}px ${STYLE.glow}}
#veil{position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(3,7,18,.35), rgba(3,7,18,.75))}`,
      body: `<div id="veil"></div><div id="wrap">${words.map((w, i) => `<span class="w" id="w${i}">${w}</span>`).join("")}</div><div id="ln"></div>`,
      script: `const n=${words.length};const ln=document.getElementById('ln');const veil=document.getElementById('veil');
function draw(t){veil.style.opacity=ease(t/0.4);
  for(let i=0;i<n;i++){const k=(t-0.25-i*0.32)/0.35;const el=document.getElementById('w'+i);el.style.opacity=clamp(k*2);el.style.transform='scale('+(k<0?2.2:1+1.2*(1-back(k)))+')';el.style.filter='blur('+(Math.max(0,1-clamp(k))*8)+'px)'}
  const l=ease((t-0.25-n*0.32)/0.6);ln.style.width=(W*0.55*l)+'px';ln.style.transform='translateX(-50%)';ln.style.opacity=l;
  const out=clamp((t-${dur}+0.35)/0.35);document.getElementById('wrap').style.opacity=1-out;
}` });
  },

  /** Logo reveal: shockwave ring + light sweep, letters assemble with glow, tagline rises. */
  logoReveal({ W, H, dur, name = "TxtYa", tagline = "" }) {
    const letters = [...name];
    return page({ W, H, css: `#lg{position:absolute;left:0;right:0;top:50%;transform:translateY(-62%);display:flex;justify-content:center}
.l{font-family:${STYLE.font};font-weight:900;font-size:${H * 0.2}px;color:#fff;display:inline-block;text-shadow:0 0 ${H * 0.05}px ${STYLE.glow},0 0 ${H * 0.015}px ${STYLE.glow2}}
#tg{position:absolute;left:0;right:0;top:${H * 0.62}px;text-align:center;font-family:${STYLE.body};font-weight:500;font-size:${H * 0.045}px;color:#cdefff;letter-spacing:.06em}
.rg{position:absolute;left:50%;top:44%;border-radius:50%;border:${H * 0.006}px solid ${STYLE.glow};box-shadow:0 0 ${H * 0.04}px ${STYLE.glow}, inset 0 0 ${H * 0.04}px ${STYLE.glow}}
#flash{position:absolute;inset:0;background:radial-gradient(circle at 50% 44%, #ffffff 0%, ${STYLE.glow}88 18%, transparent 55%)}
#sweep{position:absolute;top:0;bottom:0;width:${W * 0.18}px;background:linear-gradient(90deg,transparent,#ffffff55,transparent);transform:skewX(-20deg);mix-blend-mode:screen}`,
      body: `<div id="flash"></div><div class="rg" id="r0"></div><div class="rg" id="r1"></div><div id="lg">${letters.map((c, i) => `<span class="l" id="l${i}">${c}</span>`).join("")}</div><div id="sweep"></div><div id="tg">${tagline}</div>`,
      script: `const n=${letters.length};
function draw(t){
  for(const [i,d] of [[0,0],[1,0.18]]){const k=ease((t-0.1-d)/1.1);const r=document.getElementById('r'+i);const s=H*(0.1+1.3*k);
    r.style.width=s+'px';r.style.height=s+'px';r.style.transform='translate(-50%,-50%)';r.style.opacity=(1-k)*(t>0.1+d?1:0)}
  const f=document.getElementById('flash');f.style.opacity=Math.max(0,1-Math.abs(t-0.35)/0.45)*0.9+0.18;
  for(let i=0;i<n;i++){const k=(t-0.3-i*0.07)/0.5;const el=document.getElementById('l'+i);el.style.opacity=clamp(k*1.6);
    el.style.transform='translateY('+((1-back(k))*H*0.06)+'px) scale('+(0.6+0.4*back(k))+')';el.style.filter='blur('+(Math.max(0,1-clamp(k))*10)+'px)'}
  const sw=document.getElementById('sweep');const sk=easeIO((t-1.0)/0.9);sw.style.left=(-W*0.2+W*1.4*sk)+'px';sw.style.opacity=sk>0&&sk<1?1:0;
  const tg=document.getElementById('tg');const k2=ease((t-1.1)/0.7);tg.style.opacity=k2;tg.style.transform='translateY('+(1-k2)*H*0.03+'px)';
}` });
  },

  /** A phone chat UI where messages pop in one at a time, each tagged with the channel it arrived on. */
  chatUI({ W, H, dur, msgs, bare = false, title = "Team Group" }) {
    const pw = Math.min(W * 0.82, H * 0.47), phh = pw * 2.05;
    const sc = phh / H;
    const ph = { w: pw, h: phh, x: W / 2, y: H / 2 + (bare ? 0 : H * 0.02) };
    const u = phh / 100;
    const items = msgs.map((m, i) => `<div class="row ${m.me ? "me" : ""}" id="c${i}"><div class="bub">${m.from ? `<b>${m.from}</b>` : ""}${m.text}<span class="tag" style="background:${m.color}">${m.via}</span></div></div>`).join("");
    return page({ W, H, transparent: false, css: `.top{position:absolute;left:0;right:0;top:0;height:${u * 11}px;background:#0b2a45;border-bottom:1px solid #ffffff1a;display:flex;align-items:flex-end;padding:0 ${u * 3}px ${u * 1.6}px;gap:${u * 2}px;font-family:${STYLE.font};font-weight:700;color:#fff;font-size:${u * 2.6}px}
.av{width:${u * 4.4}px;height:${u * 4.4}px;border-radius:50%;background:linear-gradient(145deg,${STYLE.glow},${STYLE.glow2});display:flex;align-items:center;justify-content:center}
.list{position:absolute;left:0;right:0;top:${u * 12}px;bottom:${u * 9}px;display:flex;flex-direction:column;justify-content:flex-end;gap:${u * 1.3}px;padding:0 ${u * 2.6}px}
.row{display:flex}.row.me{justify-content:flex-end}
.bub{max-width:78%;font-family:${STYLE.body};font-size:${u * 2.15}px;line-height:1.3;color:#e8f6ff;background:#16304d;border:1px solid #ffffff1c;padding:${u * 1.2}px ${u * 1.6}px ${u * 1.9}px;border-radius:${u * 2}px ${u * 2}px ${u * 2}px ${u * 0.5}px;position:relative;transform-origin:left bottom}
.me .bub{background:linear-gradient(145deg,#0891b2,#2563eb);color:#fff;border-radius:${u * 2}px ${u * 2}px ${u * 0.5}px ${u * 2}px;transform-origin:right bottom;box-shadow:0 0 ${u * 3}px ${STYLE.glow}55}
.bub b{display:block;font-size:${u * 1.7}px;color:${STYLE.glow};margin-bottom:${u * 0.3}px;font-family:${STYLE.font}}
.tag{position:absolute;right:${u * 1.2}px;bottom:-${u * 1}px;font-family:${STYLE.font};font-weight:800;font-size:${u * 1.35}px;color:#fff;padding:${u * 0.3}px ${u * 0.9}px;border-radius:99px;box-shadow:0 0 ${u * 1.2}px #0008}
.inp{position:absolute;left:${u * 2.6}px;right:${u * 2.6}px;bottom:${u * 2.4}px;height:${u * 5}px;border-radius:99px;background:#ffffff14;border:1px solid #ffffff22;display:flex;align-items:center;justify-content:flex-end;padding:0 ${u * 0.6}px}
.sendb{width:${u * 4}px;height:${u * 4}px;border-radius:50%;background:${STYLE.glow};display:flex;align-items:center;justify-content:center}
${bare ? "#bg,#stars{display:none}html,body{background:#030b1c}" : ""}`,
      body: phoneMarkup(W, H, { ...ph, screen: `<div class="top"><div class="av">${svg("users", u * 2.6)}</div>${title}</div><div class="list">${items}</div><div class="inp"><div class="sendb">${svg("send", u * 2.2)}</div></div>` }),
      script: `const n=${msgs.length};const gap=${(dur - 1.0) / Math.max(1, msgs.length)};const ph=document.getElementById('ph');
function draw(t){const k0=ease(t/0.6);ph.style.opacity=k0;ph.style.transform='translateY('+((1-k0)*H*0.05+Math.sin(t*1.1)*H*0.006)+'px)';
  for(let i=0;i<n;i++){const k=(t-0.5-i*gap)/0.4;const r=document.getElementById('c'+i);r.style.display=k<0?'none':'flex';
    const b=r.firstChild;b.style.transform='scale('+back(k)+')';b.style.opacity=clamp(k*2)}}` });
  },

  /** One message fans out along glowing paths to channel icons (SMS, WhatsApp-style chat, email, team chat), replies flow back. */
  fanOut({ W, H, dur, labels = ["SMS", "Chat apps", "Email", "Team chat"], headline = "" }) {
    const cx = W / 2, cy = H * 0.56, n = labels.length;
    // Two targets left, two right of the hub, mirrored.
    const pts = labels.map((_, i) => ({ x: cx + (i < n / 2 ? -1 : 1) * W * (i % 2 ? 0.2 : 0.33), y: cy + (i % 2 ? 1 : -1) * H * 0.2 }));
    const kinds = [2, 0, 1, 6];
    const size = Math.round(H * 0.12);
    return page({ W, H, css: `#hub{position:absolute;left:${cx - H * 0.11}px;top:${cy - H * 0.11}px;width:${H * 0.22}px;height:${H * 0.22}px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#5eead4,${STYLE.glow} 45%,#0e7490);box-shadow:0 0 ${H * 0.08}px ${STYLE.glow};display:flex;align-items:center;justify-content:center}
svg#paths{position:absolute;inset:0}
.lb{position:absolute;font-family:${STYLE.font};font-weight:700;font-size:${H * 0.032}px;color:#dff7ff;text-align:center;width:${H * 0.3}px;margin-left:-${H * 0.15}px;text-shadow:0 0 ${H * 0.01}px #000}
.dot{position:absolute;width:${H * 0.022}px;height:${H * 0.022}px;margin:-${H * 0.011}px;border-radius:50%;background:#fff;box-shadow:0 0 ${H * 0.02}px ${STYLE.glow},0 0 ${H * 0.04}px ${STYLE.glow}}
#hl{position:absolute;left:0;right:0;top:${H * 0.06}px;text-align:center;font-size:${H * 0.058}px;text-shadow:0 0 ${H * 0.03}px ${STYLE.glow}aa}`,
      body: `<svg id="paths" viewBox="0 0 ${W} ${H}">${pts.map((p, i) => `<path id="p${i}" d="M${cx} ${cy} C ${(cx + p.x) / 2} ${cy} ${(cx + p.x) / 2} ${p.y} ${p.x} ${p.y}" stroke="${STYLE.glow}" stroke-width="${H * 0.004}" fill="none" stroke-linecap="round" style="filter:drop-shadow(0 0 6px ${STYLE.glow})"/>`).join("")}</svg>
<div id="hub">${svg("send", H * 0.1)}</div>${pts.map((p, i) => icon(kinds[i], size).replace('class="ic"', `class="ic" id="i${i}"`).replace("position:absolute", "") + `<div class="lb" id="t${i}" style="left:${p.x}px;top:${p.y + size * 0.62}px">${labels[i]}</div>`).join("")}
${pts.map((_, i) => `<div class="dot" id="d${i}"></div><div class="dot" id="e${i}"></div>`).join("")}<h1 class="h" id="hl">${headline}</h1>`,
      script: `const P=${JSON.stringify(pts)},n=${n},size=${size};const L=[];for(let i=0;i<n;i++){const p=document.getElementById('p'+i);const len=p.getTotalLength();L.push(len);p.style.strokeDasharray=len;}
function draw(t){const hub=document.getElementById('hub');const k=back(t/0.6);hub.style.transform='scale('+(k*(1+0.04*Math.sin(t*4)))+')';
  document.getElementById('hl').style.opacity=ease((t-0.3)/0.6);
  for(let i=0;i<n;i++){const st=0.6+i*0.18;const k1=easeIO((t-st)/0.7);const p=document.getElementById('p'+i);p.style.strokeDashoffset=L[i]*(1-k1);
    const ic=document.getElementById('i'+i);const k2=back((t-st-0.55)/0.45);ic.style.transform='translate('+(P[i].x-size/2)+'px,'+(P[i].y-size/2)+'px) scale('+Math.max(0,k2)+')';
    document.getElementById('t'+i).style.opacity=ease((t-st-0.7)/0.4);
    const d=document.getElementById('d'+i);const pd=(t-st)/0.7;if(pd>0&&pd<1){const q=p.getPointAtLength(L[i]*easeIO(pd));d.style.transform='translate('+q.x+'px,'+q.y+'px)';d.style.opacity=1}else d.style.opacity=0;
    const e=document.getElementById('e'+i);const pe=((t-st-1.6)%1.4)/0.9;if(t>st+1.6&&pe<1){const q=p.getPointAtLength(L[i]*(1-easeIO(pe)));e.style.transform='translate('+q.x+'px,'+q.y+'px)';e.style.opacity=1}else e.style.opacity=0}}` });
  },

  /** Transparent end-card overlay over a Wan background: logo, tagline, URL pill. */
  endCard({ W, H, dur, name = "TxtYa", tagline = "", url = "" }) {
    return page({ W, H, transparent: true, css: `#veil{position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(3,7,18,.25), rgba(3,7,18,.8))}
#nm{position:absolute;left:0;right:0;top:${H * 0.3}px;text-align:center;font-family:${STYLE.font};font-weight:900;font-size:${H * 0.17}px;color:#fff;text-shadow:0 0 ${H * 0.05}px ${STYLE.glow},0 0 ${H * 0.015}px ${STYLE.glow2}}
#tg{position:absolute;left:0;right:0;top:${H * 0.55}px;text-align:center;font-family:${STYLE.body};font-weight:500;font-size:${H * 0.042}px;color:#d4f3ff;letter-spacing:.05em}
#url{position:absolute;left:50%;top:${H * 0.68}px;transform:translateX(-50%);font-family:${STYLE.font};font-weight:800;font-size:${H * 0.04}px;color:#04121f;background:${STYLE.glow};padding:${H * 0.014}px ${H * 0.04}px;border-radius:99px;box-shadow:0 0 ${H * 0.04}px ${STYLE.glow}}`,
      body: `<div id="veil"></div><div id="nm">${name}</div><div id="tg">${tagline}</div><div id="url">${url}</div>`,
      script: `function draw(t){document.getElementById('veil').style.opacity=ease(t/0.6);
  const a=ease((t-0.2)/0.7);const nm=document.getElementById('nm');nm.style.opacity=a;nm.style.transform='scale('+(0.9+0.1*back((t-0.2)/0.7))+')';nm.style.filter='blur('+((1-a)*8)+'px)';
  const b=ease((t-0.7)/0.6);const tg=document.getElementById('tg');tg.style.opacity=b;tg.style.transform='translateY('+(1-b)*H*0.03+'px)';
  const c=back((t-1.1)/0.5);const u=document.getElementById('url');u.style.opacity=clamp((t-1.1)/0.3);u.style.transform='translateX(-50%) scale('+Math.max(0,c)+')'}` });
  },
};

/**
 * Render a template to a video file: `dur` s at `fps`, frames piped as PNG into ffmpeg. Transparent templates are
 * written as ProRes 4444 (.mov, alpha) for overlaying; opaque ones as H.264.
 */
export async function renderTemplate(browser, name, params, file, { fps = 30, ffmpeg = "ffmpeg" } = {}) {
  const { W, H, dur } = params;
  const html = templates[name](params);
  const transparent = html.includes("background:transparent}");
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const args = ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-i", "-"];
  args.push(...(transparent ? ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p"]), file);
  const ff = spawn(ffmpeg, args, { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c} (${name})`)))));
  const frames = Math.round(dur * fps);
  for (let f = 0; f < frames; f++) {
    await page.evaluate((t) => window.render(t), f / fps);
    const buf = await page.screenshot({ type: "png", omitBackground: transparent });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
  await page.close();
  return { file, frames, transparent };
}
