"use client";
// One WaltzDeck scene drawn in the browser: the media (video/photo) with the scene's text layout on top.
// A close approximation of worker/deck/templates (same layout names, fonts and proportions) for the
// storyboard cards and the instant preview; the render uses the real templates.
import { cn } from "cn";
import { rotatedFill, rotationParent } from "@/lib/rotation";
import type { CameraMode, SceneText } from "@/lib/deck/types";
import { CAMERA_SIZE, type CameraMove } from "@/lib/deck/camera";

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
};

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
}) {
  const cam = cameraStyle(move, cameraMode, durationSec, playing);
  const t = scene.textMode === "none" ? {} : scene.text ?? {};
  // Same rule as the template (W >= H): 16:9 and 1:1 put a slide's panel on the left, tall frames at the bottom.
  const wide = !/9\/16|4\/5/.test(aspectCss);
  const hasText = !!(t.headline || t.sub || t.bullets?.length);
  // Text-only scenes are brand cards; a card layout WITH media keeps the media under a dark scrim (as rendered).
  const card = !asset || scene.layout === "title-card" || scene.layout === "cta-card";
  const cardOnly = !asset;
  const src = asset ? `/api/projects/${projectId}/assets/${asset.id}` : null;
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-lg bg-black [container-type:size]", aspectCss, className)}
      style={asset ? rotationParent(asset.rotation) : undefined}
    >
      {cam ? <style>{CAMERA_CSS}</style> : null}
      {asset && (!card || !cardOnly) ? (
        // The camera preview moves a wrapper, never the media itself (its transform carries the clip's rotation).
        <div className="absolute inset-0" style={cam}>
        {asset.kind === "video" ? (
          <video
            key={`${asset.id}-${playing}`}
            src={`${src}#t=${Math.max(0.1, startAt ?? 0.1)}`}
            muted
            playsInline
            autoPlay={playing}
            preload="metadata"
            className="absolute inset-0 size-full object-cover"
            style={rotatedFill(asset.rotation)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src!} alt="" className="absolute inset-0 size-full object-cover" style={rotatedFill(asset.rotation)} />
        )}
        </div>
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(120% 90% at 20% 10%, ${brand?.primary ?? "#8b5cf6"} 0%, ${brand?.secondary ?? "#120a24"} 100%)` }}
        />
      )}

      {hasText || (card && brand?.logoUrl) ? (
        <TextLayer
          layout={card ? (scene.layout === "cta-card" ? "cta-card" : scene.layout === "slide" && cardOnly ? "slide" : "title-card") : scene.layout}
          text={t} brand={brand} scrim={card && !!asset} wide={wide} cardOnly={cardOnly}
        />
      ) : null}
    </div>
  );
}

// Sizes in container-query units (cqw/cqh) so text scales with the frame at any size.
function TextLayer({ layout, text, brand, scrim, wide, cardOnly }: {
  layout: string; text: SceneText; brand: FrameBrand; scrim: boolean; wide: boolean; cardOnly: boolean;
}) {
  const { headline, sub, bullets = [] } = text;
  const primary = brand?.primary ?? "#8b5cf6";
  const hf = { fontFamily: `'${brand?.headingFont ?? "Montserrat"}', sans-serif` };
  const bf = { fontFamily: `'${brand?.bodyFont ?? "Inter"}', sans-serif` };
  const H = (className?: string) =>
    headline ? <p style={hf} className={cn("font-extrabold leading-[1.05] text-white", className)}>{headline}</p> : null;
  const S = (className?: string) =>
    sub ? <p style={bf} className={cn("font-medium leading-snug text-violet-50", className)}>{sub}</p> : null;

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
            <p style={hf} className={cn("font-extrabold leading-[1.05] text-white", cardOnly
              ? (wide ? "pr-[14cqw] text-[5.6cqw]" : "text-[9cqw]") : (wide ? "text-[5cqw]" : "text-[8.5cqw]"))}>{headline}</p>
          ) : null}
          {headline ? <b className={cn("block h-[max(2px,0.45cqw)] shrink-0 rounded-full", wide ? "w-[6cqw]" : "w-[12cqw]")} style={{ background: primary }} /> : null}
          {sub ? <p style={bf} className={cn("font-medium leading-snug text-violet-50", wide ? "text-[2.4cqw]" : "text-[4.4cqw]")}>{sub}</p> : null}
          {bullets.length ? (
            <ul className="mt-[0.6cqw] space-y-[0.6em]">
              {bullets.map((b, i) => (
                <li key={i} style={bf} className={cn("flex items-start gap-[0.55em] font-medium leading-[1.3] text-white", wide ? "text-[2.5cqw]" : "text-[4.6cqw]")}>
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
        {sub ? <p style={{ ...bf, ...(layout === "cta-card" ? { background: primary } : {}) }} className={cn("text-[4.4cqw] font-medium leading-snug text-violet-50", layout === "cta-card" && "rounded-full px-[5cqw] py-[2cqw] font-bold text-white")}>{sub}</p> : null}
        {bullets.length ? <p className="font-['Inter',sans-serif] text-[3.6cqw] text-violet-100">{bullets.join(" · ")}</p> : null}
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
