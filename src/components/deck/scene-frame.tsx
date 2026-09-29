"use client";
// One WaltzDeck scene drawn in the browser: the media (video/photo) with the scene's text layout on top.
// A close approximation of worker/deck/templates (same layout names, fonts and proportions) for the
// storyboard cards and the instant preview; the render uses the real templates.
import { cn } from "cn";
import { rotatedFill, rotationParent } from "@/lib/rotation";
import type { SceneText } from "@/lib/deck/types";

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
}: {
  projectId: string;
  scene: FrameScene;
  asset?: { id: string; kind: string; rotation: number } | null;
  aspectCss: string;
  playing?: boolean;
  startAt?: number | null;
  className?: string;
}) {
  const t = scene.textMode === "none" ? {} : scene.text ?? {};
  const hasText = !!(t.headline || t.sub || t.bullets?.length);
  const card = !asset || scene.layout === "title-card" || scene.layout === "cta-card";
  const src = asset ? `/api/projects/${projectId}/assets/${asset.id}` : null;
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-lg bg-black [container-type:size]", aspectCss, className)}
      style={asset && !card ? rotationParent(asset.rotation) : undefined}
    >
      {asset && !card ? (
        asset.kind === "video" ? (
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
        )
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_20%_10%,#8b5cf6_0%,#4c1d95_45%,#120a24_100%)]" />
      )}

      {hasText ? <TextLayer layout={card ? (scene.layout === "cta-card" ? "cta-card" : "title-card") : scene.layout} text={t} /> : null}
    </div>
  );
}

// Sizes in container-query units (cqw/cqh) so text scales with the frame at any size.
function TextLayer({ layout, text }: { layout: string; text: SceneText }) {
  const { headline, sub, bullets = [] } = text;
  const H = (className?: string) =>
    headline ? <p className={cn("font-['Montserrat',sans-serif] font-extrabold leading-[1.05] text-white", className)}>{headline}</p> : null;
  const S = (className?: string) =>
    sub ? <p className={cn("font-['Inter',sans-serif] font-medium leading-snug text-violet-50", className)}>{sub}</p> : null;

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
            <li key={i} className="flex items-start gap-[2cqw] font-['Inter',sans-serif] text-[4cqw] font-semibold text-white">
              <span className="mt-[1.3cqw] size-[1.8cqw] shrink-0 rounded-full bg-[#8b5cf6]" />
              {b}
            </li>
          ))}
        </ul>
      </div>
    );
  if (layout === "title-card" || layout === "cta-card")
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[2.5cqh] p-[8cqw] text-center">
        {H("text-[8.5cqw]")}
        {S(cn("text-[4.4cqw]", layout === "cta-card" && "rounded-full bg-[#8b5cf6] px-[5cqw] py-[2cqw] font-bold text-white"))}
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
