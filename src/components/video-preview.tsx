"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A shared render's preview for feed cards: a real frame from the video (seeked to ~1 s), loaded only when the card
 * scrolls near the viewport, and played muted on hover (not with reduced motion; touch devices just show the frame).
 * Uses the public stream (/api/renders/<id>/watch → presigned media URL, Range-capable).
 */
export function VideoPreview({ renderId, className }: { renderId: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSrc(`/api/renders/${renderId}/watch`);
        io.disconnect();
      }
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [renderId]);

  const still = () => {
    const v = ref.current;
    if (v && v.duration > 0) v.currentTime = Math.min(1, v.duration / 3);
  };
  const canHover = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover)").matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <video
      ref={ref}
      src={src ?? undefined}
      muted
      playsInline
      loop
      preload="metadata"
      aria-hidden
      tabIndex={-1}
      onLoadedMetadata={still}
      // Any of these means a frame can be shown (some browsers don't surface "seeked" for the first seek).
      onSeeked={() => setReady(true)}
      onLoadedData={() => setReady(true)}
      onCanPlay={() => setReady(true)}
      onMouseEnter={() => { if (ready && canHover()) ref.current?.play().catch(() => {}); }}
      onMouseLeave={() => { const v = ref.current; if (v && !v.paused) { v.pause(); still(); } }}
      className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${ready ? "opacity-100" : "opacity-0"} ${className ?? ""}`}
    />
  );
}
