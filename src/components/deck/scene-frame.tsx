"use client";
// One WaltzDeck scene drawn in the browser: the media (video/photo) with the scene's text layout on top.
// A close approximation of worker/deck/templates (same layout names, fonts and proportions) for the
// storyboard cards and the instant preview; the render uses the real templates.
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { rotatedFill, rotationParent } from "@/lib/rotation";
import { aspectNumber, cardRect, frameRect, type SceneFrameBox } from "@/lib/deck/frame";
import type { CameraMode, ResolvedBackdrop, SceneText } from "@/lib/deck/types";
import { BACKDROP_CSS, backdropMarkup, backdropTone, mediaArea, textZone, type TextZone } from "../../../worker/deck/backdrop.mjs";
import { CAMERA_SIZE, type CameraMove } from "@/lib/deck/camera";
import { motionHtml, motionOpaque, settledAt } from "../../../worker/deck/motion.mjs";
import { BRAND_FONTS_CSS } from "@/lib/brand";
import { isMotionLayout } from "@/lib/deck/types";

// Preview versions of the render's camera moves (worker/deck/camera.mjs) as CSS animations on the media only.
const CAMERA_CSS = `
@keyframes cw-push { from { transform: scale(1) } to { transform: scale(var(--z)) } }
@keyframes cw-pull { from { transform: scale(var(--z)) } to { transform: scale(1) } }
@keyframes cw-pan-l { from { transform: scale(var(--p)) translateX(calc(var(--p) * 4%)) } to { transform: scale(var(--p)) translateX(calc(var(--p) * -4%)) } }
@keyframes cw-pan-r { from { transform: scale(var(--p)) translateX(calc(var(--p) * -4%)) } to { transform: scale(var(--p)) translateX(calc(var(--p) * 4%)) } }
@keyframes cw-drift { from { transform: scale(var(--p)) translate(2%, 1%) } to { transform: scale(calc(var(--p) + 0.03)) translate(-2%, -1%) } }
@keyframes cw-punch { 0% { transform: scale(calc(1 + var(--k))) } 35% { transform: scale(1.01) } 100% { transform: scale(1.01) } }
@keyframes cw-shake { 0%,100% { transform: scale(1.08) translate(0,0) } 20% { transform: scale(1.08) translate(calc(var(--s) * -1), var(--s)) }
  40% { transform: scale(1.08) translate(var(--s), calc(var(--s) * -0.6)) } 60% { transform: scale(1.08) translate(calc(var(--s) * -0.5), calc(var(--s) * -1)) }
  80% { transform: scale(1.08) translate(calc(var(--s) * 0.8), calc(var(--s) * 0.5)) } }
`;
function cameraStyle(move: CameraMove | null | undefined, mode: CameraMode | undefined, dur: number, playing: boolean): React.CSSProperties | undefined {
  if (!move || !mode || mode === "off" || !playing) return undefined;
  const S = CAMERA_SIZE[mode];
  const vars = { "--z": String(1 + S.zoom), "--p": String(1 + S.pan), "--k": String(S.punch), "--s": `${(S.shake * 100).toFixed(2)}%` } as React.CSSProperties;
  const d = `${Math.max(0.5, dur)}s`;
  const anim: Record<CameraMove, string> = {
    "push-in": `cw-push ${d} ease-in-out forwards`, "pull-out": `cw-pull ${d} ease-in-out forwards`,
    "pan-left": `cw-pan-l ${d} ease-in-out forwards`, "pan-right": `cw-pan-r ${d} ease-in-out forwards`,
    drift: `cw-drift ${d} ease-in-out forwards`, punch: "cw-punch 0.5s ease-out infinite", shake: "cw-shake 0.35s linear infinite",
  };
  return { ...vars, animation: anim[move] };
}

/** Brand look for the preview (null = ClipWaltz defaults). */
export type FrameBrand = { primary: string; secondary: string; headingFont: string; bodyFont: string; logoUrl: string | null } | null;

export type FrameScene = {
  layout: string;
  textMode: string;
  text: SceneText;
  assetId: string | null;
  frame?: SceneFrameBox | null;
  /** The scene's effective backdrop (text cards, and media zoomed out below fill). Absent = brand gradient. */
  backdrop?: ResolvedBackdrop | null;
};

/** The shared backdrop styles (worker/deck/backdrop.mjs), hoisted and de-duplicated by React. */
export const BackdropStyles = () => <style href="cw-backdrop" precedence="medium">{BACKDROP_CSS}</style>;

/** One backdrop filling its (positioned) parent — the same markup the render and the slide exports draw. */
export function Backdrop({ backdrop, brand, aspect, zone }: { backdrop: ResolvedBackdrop | null | undefined; brand: FrameBrand; aspect: number; zone: TextZone }) {
  const html = backdropMarkup(backdrop, { primary: brand?.primary, secondary: brand?.secondary, aspect, zone });
  return (
    <>
      <BackdropStyles />
      <div aria-hidden className="absolute inset-0" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}

/**
 * Where the media sits inside the frame for a scene's framing (crop / reposition): a size container the size of
 * the whole upright source, offset so the framed rectangle fills the frame. undefined = plain cover (no framing,
 * or the media's size isn't known yet).
 */
function framedBox(frame: SceneFrameBox | null | undefined, natural: { w: number; h: number } | null, rotation: number, aspect: number): React.CSSProperties | undefined {
  if (!frame || !natural) return undefined;
  const turned = rotation % 180 !== 0;
  const r = frameRect(frame, turned ? natural.h : natural.w, turned ? natural.w : natural.h, aspect);
  return {
    position: "absolute", containerType: "size",
    left: `${(-r.l / r.w) * 100}%`, top: `${(-r.t / r.h) * 100}%`, width: `${100 / r.w}%`, height: `${100 / r.h}%`,
  };
}

export function SceneFrame({
  projectId,
  scene,
  asset,
  aspectCss,
  playing = false,
  startAt,
  className,
  brand = null,
  move = null,
  cameraMode,
  durationSec = 3,
  onMediaSize,
}: {
  projectId: string;
  scene: FrameScene;
  asset?: { id: string; kind: string; rotation: number } | null;
  aspectCss: string;
  playing?: boolean;
  startAt?: number | null;
  className?: string;
  brand?: FrameBrand;
  /** Dynamic camera preview (only while playing). */
  move?: CameraMove | null;
  cameraMode?: CameraMode;
  durationSec?: number;
  /** The media's displayed size (file rotation applied, user rotation not) once it loads. */
  onMediaSize?: (w: number, h: number) => void;
}) {
  const cam = cameraStyle(move, cameraMode, durationSec, playing);
  // The media's own size (as the browser shows it — file rotation flag applied), for the scene's framing.
  const [natural, setNaturalState] = useState<{ w: number; h: number } | null>(null);
  const setNatural = (n: { w: number; h: number }) => { setNaturalState(n); onMediaSize?.(n.w, n.h); };
  const aspect = aspectNumber(aspectCss);
  const zoomedOut = !!asset && (scene.frame?.zoom ?? 1) < 1;
  const box = asset && !zoomedOut ? framedBox(scene.frame, natural, asset.rotation, aspect) : undefined;
  const mediaCls = box ? "absolute inset-0 size-full object-fill" : "absolute inset-0 size-full object-cover";
  const t = scene.textMode === "none" ? {} : scene.text ?? {};
  // Same rule as the template (W >= H): 16:9 and 1:1 put a slide's panel on the left, tall frames at the bottom.
  const wide = !/9\/16|4\/5/.test(aspectCss);
  const hasText = !!(t.headline || t.sub || t.bullets?.length);
  // Text-only scenes are brand cards; a card layout WITH media keeps the media under a dark scrim (as rendered).
  const card = !asset || scene.layout === "title-card" || scene.layout === "cta-card";
  const cardOnly = !asset;
  const textLayout = card ? (scene.layout === "cta-card" ? "cta-card" : scene.layout === "slide" && cardOnly ? "slide" : "title-card") : scene.layout;
  const src = asset ? `/api/projects/${projectId}/assets/${asset.id}` : null;
  // Zoomed out below fill: the whole media as a card (its own shape) centred on the backdrop — worker/deck/backdrop.mjs cardRect.
  const turned = !!asset && asset.rotation % 180 !== 0;
  const mediaAspect = natural ? (turned ? natural.h / natural.w : natural.w / natural.h) : aspect;
  const rect = zoomedOut ? cardRect(aspect, mediaAspect, scene.frame!.zoom, mediaArea(scene.layout, wide)) : null;
  const cardBox: React.CSSProperties | undefined = rect
    ? { position: "absolute", containerType: "size", left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`,
        borderRadius: "1.6cqmin", overflow: "hidden", boxShadow: "0 2.5cqmin 6cqmin rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.12)" }
    : undefined;
  const media = asset ? (
    asset.kind === "video" ? (
      <video
        key={`${asset.id}-${playing}-${startAt ?? ""}`}
        src={`${src}#t=${Math.max(0.1, startAt ?? 0.1)}`}
        muted
        playsInline
        autoPlay={playing}
        preload="metadata"
        onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth) setNatural({ w: v.videoWidth, h: v.videoHeight }); }}
        className={mediaCls}
        style={rotatedFill(asset.rotation)}
      />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={asset.id}
        ref={(el) => { if (el?.complete && el.naturalWidth && !natural) setNatural({ w: el.naturalWidth, h: el.naturalHeight }); }}
        onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth) setNatural({ w: i.naturalWidth, h: i.naturalHeight }); }}
        src={src!} alt="" className={mediaCls} style={rotatedFill(asset.rotation)}
      />
    )
  ) : null;
  if (isMotionLayout(scene.layout)) {
    // Animated scene (worker/deck/motion.mjs): the same page the render draws, in a scaled iframe. Over-media layouts
    // sit on the scene's media; the others draw their own background and don't show it.
    const behind = !!asset && !motionOpaque(scene.layout, true);
    return (
      <div
        className={cn("relative w-full overflow-hidden rounded-lg bg-black [container-type:size]", aspectCss, className)}
        style={behind && !zoomedOut ? rotationParent(asset!.rotation) : undefined}
      >
        {cam ? <style>{CAMERA_CSS}</style> : null}
        {behind ? <div className="absolute inset-0" style={cam}><div className="absolute inset-0" style={box}>{media}</div></div> : null}
        <MotionLayer layout={scene.layout} text={t} brand={brand} aspect={aspect} durationSec={durationSec} playing={playing} over={behind} />
      </div>
    );
  }
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-lg bg-black [container-type:size]", aspectCss, className)}
      style={asset && !zoomedOut ? rotationParent(asset.rotation) : undefined}
    >
      {cam ? <style>{CAMERA_CSS}</style> : null}
      {asset && (!card || !cardOnly) ? (
        // The camera preview moves a wrapper, never the media itself (its transform carries the clip's rotation).
        <div className="absolute inset-0" style={cam}>
          {zoomedOut ? (
            <>
              <Backdrop backdrop={scene.backdrop} brand={brand} aspect={aspect} zone="none" />
              <div style={cardBox}>{media}</div>
            </>
          ) : (
            // Unframed, the media sizes itself from the root (already a size container).
            <div className="absolute inset-0" style={box}>{media}</div>
          )}
        </div>
      ) : (
        <Backdrop backdrop={scene.backdrop} brand={brand} aspect={aspect} zone={textZone(textLayout, { card: true, wide })} />
      )}

      {hasText || (card && brand?.logoUrl) ? (
        <TextLayer
          layout={textLayout}
          text={t} brand={brand} scrim={card && !!asset} wide={wide} cardOnly={cardOnly}
          ink={cardOnly && backdropTone(scene.backdrop, textZone(textLayout, { card: true, wide })) === "light" ? "dark" : "light"}
        />
      ) : null}
    </div>
  );
}

/** The brand logo as a data URL for the sandboxed preview page (it has no cookies to load the app's logo route). */
const logoCache = new Map<string, Promise<string | null>>();
function useLogoDataUrl(url: string | null) {
  const [got, setGot] = useState<{ url: string; data: string | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    if (!logoCache.has(url)) {
      logoCache.set(url, fetch(url).then(async (r) => {
        const b = r.ok ? await r.blob() : null;
        if (!b || !/^image\/(png|jpeg|webp)$/.test(b.type)) return null;
        return await new Promise<string | null>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(null); fr.readAsDataURL(b); });
      }).catch(() => null));
    }
    void logoCache.get(url)!.then((data) => { if (live) setGot({ url, data }); });
    return () => { live = false; };
  }, [url]);
  return url && got?.url === url ? got.data : null;
}

/**
 * An animated scene's page at a fixed size (1280 px on the long side), scaled to the frame. Playing: runs once from the
 * start and holds the last frame; otherwise shows the moment where everything has arrived.
 */
function MotionLayer({ layout, text, brand, aspect, durationSec, playing, over }: {
  layout: string; text: SceneText; brand: FrameBrand; aspect: number; durationSec: number; playing: boolean; over: boolean;
}) {
  const W = aspect >= 1 ? 1280 : Math.round(1280 * aspect), H = aspect >= 1 ? Math.round(1280 / aspect) : 1280;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [scale, setScale] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const logo = useLogoDataUrl(brand?.logoUrl ?? null);
  const dur = Math.max(1, durationSec);
  const key = JSON.stringify([text.headline, text.sub, text.bullets]);
  const html = useMemo(() => motionHtml({
    layout, text, W, H, dur, over, stars: 90, fontsCss: BRAND_FONTS_CSS,
    brand: brand ? { primary: brand.primary, secondary: brand.secondary, headingFont: brand.headingFont, bodyFont: brand.bodyFont, logoDataUrl: logo } : {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [layout, key, W, H, dur, over, brand?.primary, brand?.secondary, brand?.headingFont, brand?.bodyFont, logo]);
  const pageKey = useMemo(() => { let h = 0; for (let i = 0; i < html.length; i++) h = (Math.imul(h, 31) + html.charCodeAt(i)) | 0; return `${h}-${html.length}`; }, [html]);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, [W]);
  // The page runs in a scripts-only sandbox (no same-origin access): it says when it's ready, and frames are drawn by
  // message — so a slip in its escaping could never act as the app.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source && e.source === frameRef.current?.contentWindow && (e.data as { cwReady?: number } | null)?.cwReady) setLoaded((n) => n + 1);
    };
    addEventListener("message", onMsg);
    return () => removeEventListener("message", onMsg);
  }, []);
  useEffect(() => {
    const win = frameRef.current?.contentWindow;
    if (!loaded || !win) return;
    const draw = (t: number) => win.postMessage({ cwRender: t }, "*");
    if (!playing) { draw(settledAt(dur)); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = Math.min(dur, (performance.now() - t0) / 1000);
      draw(t);
      if (t < dur) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loaded, playing, dur]);
  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden">
      <iframe
        // Remount when the page changes: changing srcdoc on the live sandboxed frame left the old page showing
        // (verified 2026-10-05 — the brand logo arrived but never appeared).
        key={pageKey}
        ref={frameRef} srcDoc={html} title="" aria-hidden tabIndex={-1} sandbox="allow-scripts" onLoad={() => setLoaded((n) => n + 1)}
        style={{ width: W, height: H, border: 0, background: "transparent", pointerEvents: "none", transform: `scale(${scale})`, transformOrigin: "0 0", colorScheme: "normal" }}
      />
    </div>
  );
}

// Sizes in container-query units (cqw/cqh) so text scales with the frame at any size.
function TextLayer({ layout, text, brand, scrim, wide, cardOnly, ink = "light" }: {
  layout: string; text: SceneText; brand: FrameBrand; scrim: boolean; wide: boolean; cardOnly: boolean;
  /** "dark" on light backdrops (Paper, a light AI image): dark words instead of white. */
  ink?: "light" | "dark";
}) {
  const dark = ink === "dark";
  const { headline, sub, bullets = [] } = text;
  const primary = brand?.primary ?? "#8b5cf6";
  const hf = { fontFamily: `'${brand?.headingFont ?? "Montserrat"}', sans-serif` };
  const bf = { fontFamily: `'${brand?.bodyFont ?? "Inter"}', sans-serif` };
  const H = (className?: string) =>
    headline ? <p style={hf} className={cn("font-extrabold leading-[1.05]", dark ? "text-[#17121f]" : "text-white", className)}>{headline}</p> : null;
  const S = (className?: string) =>
    sub ? <p style={bf} className={cn("font-medium leading-snug", dark ? "text-[#2a2238]" : "text-violet-50", className)}>{sub}</p> : null;

  if (layout === "slide") {
    // worker/deck/text-layer.mjs .slide: brand panel beside the media (left when wide, bottom when tall), or full-frame as a card.
    const panel = cardOnly
      ? cn("inset-0 justify-start", wide ? "p-[6cqw] pt-[7cqw]" : "p-[9cqw] pt-[16cqw]")
      : wide ? "inset-y-0 left-0 w-[56%] px-[4.5cqw] py-[5cqw]" : "inset-x-0 bottom-0 h-[56%] p-[7cqw]";
    return (
      <>
        <div className={cn("absolute flex flex-col justify-center gap-[1.6cqw] overflow-hidden", panel)}
          style={cardOnly ? undefined : { background: `color-mix(in srgb, ${brand?.secondary ?? "#120a24"} 90%, transparent)` }}>
          {headline ? (
            <p style={hf} className={cn("font-extrabold leading-[1.05]", dark ? "text-[#17121f]" : "text-white", cardOnly
              ? (wide ? "pr-[14cqw] text-[5.6cqw]" : "text-[9cqw]") : (wide ? "text-[5cqw]" : "text-[8.5cqw]"))}>{headline}</p>
          ) : null}
          {headline ? <b className={cn("block h-[max(2px,0.45cqw)] shrink-0 rounded-full", wide ? "w-[6cqw]" : "w-[12cqw]")} style={{ background: primary }} /> : null}
          {sub ? <p style={bf} className={cn("font-medium leading-snug", dark ? "text-[#2a2238]" : "text-violet-50", wide ? "text-[2.4cqw]" : "text-[4.4cqw]")}>{sub}</p> : null}
          {bullets.length ? (
            <ul className="mt-[0.6cqw] space-y-[0.6em]">
              {bullets.map((b, i) => (
                <li key={i} style={bf} className={cn("flex items-start gap-[0.55em] font-medium leading-[1.3]", dark ? "text-[#17121f]" : "text-white", wide ? "text-[2.5cqw]" : "text-[4.6cqw]")}>
                  <span className="mt-[0.45em] size-[0.42em] shrink-0 rounded-full" style={{ background: primary }} />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {cardOnly && brand?.logoUrl ? <img src={brand.logoUrl} alt="" className="absolute right-[4cqw] top-[4cqw] max-h-[9cqh] max-w-[16cqw] object-contain" /> : null}
      </>
    );
  }
  if (layout === "headline-center")
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[2cqh] bg-black/25 p-[7cqw] text-center">
        {H("text-[9cqw] drop-shadow-[0_2px_12px_rgba(0,0,0,.6)]")}
        {S("text-[4.2cqw] drop-shadow-[0_1px_6px_rgba(0,0,0,.6)]")}
      </div>
    );
  if (layout === "lower-third")
    return (
      <div className="absolute inset-x-[5cqw] bottom-[6cqh] rounded-[1.5cqw] bg-black/60 px-[4cqw] py-[2.5cqw] backdrop-blur-sm">
        {H("text-[5cqw]")}
        {S("text-[3.4cqw]")}
      </div>
    );
  if (layout === "bullets")
    return (
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-[1.6cqh] bg-gradient-to-t from-black/75 to-transparent p-[7cqw] pt-[20cqh]">
        {H("text-[6.5cqw]")}
        <ul className="space-y-[1cqh]">
          {bullets.map((b, i) => (
            <li key={i} style={bf} className="flex items-start gap-[2cqw] text-[4cqw] font-semibold text-white">
              <span className="mt-[1.3cqw] size-[1.8cqw] shrink-0 rounded-full" style={{ background: primary }} />
              {b}
            </li>
          ))}
        </ul>
      </div>
    );
  if (layout === "title-card" || layout === "cta-card")
    return (
      <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-[2.5cqh] p-[8cqw] text-center", scrim && "bg-[rgba(10,6,24,.55)]")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {brand?.logoUrl ? <img src={brand.logoUrl} alt="" className="max-h-[14cqh] max-w-[40cqw] object-contain" /> : null}
        {H("text-[8.5cqw]")}
        {sub ? <p style={{ ...bf, ...(layout === "cta-card" ? { background: primary } : {}) }} className={cn("text-[4.4cqw] font-medium leading-snug", dark ? "text-[#2a2238]" : "text-violet-50", layout === "cta-card" && "rounded-full px-[5cqw] py-[2cqw] font-bold !text-white")}>{sub}</p> : null}
        {bullets.length ? <p className={cn("font-['Inter',sans-serif] text-[3.6cqw]", dark ? "text-[#3a3050]" : "text-violet-100")}>{bullets.join(" · ")}</p> : null}
      </div>
    );
  // headline-bottom (default)
  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-col gap-[1.4cqh] bg-gradient-to-t from-black/70 to-transparent p-[7cqw] pt-[22cqh]">
      {H("text-[7.5cqw]")}
      {S("text-[4.2cqw]")}
    </div>
  );
}
