"use client";
// Campaign variant player (phase 4): plays the ad and reports view / play / complete once per page load, plus
// the per-browser id the CTA click carries — all de-duplicated per visitor and day on the server.
import { useEffect, useRef } from "react";

function visitorId(): string | null {
  try {
    let id = localStorage.getItem("cw-vid");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("cw-vid", id); }
    return id;
  } catch {
    return null;
  }
}

export function VariantPlayer({ renderId, className }: { renderId: string; className?: string }) {
  const sent = useRef(new Set<string>());
  useEffect(() => {
    const vid = visitorId();
    const send = (type: "view" | "play" | "complete") => {
      if (sent.current.has(type)) return;
      sent.current.add(type);
      const body = JSON.stringify({ type, v: vid });
      if (!navigator.sendBeacon?.(`/api/c/${renderId}/event`, new Blob([body], { type: "application/json" }))) {
        void fetch(`/api/c/${renderId}/event`, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    };
    send("view");
    // The CTA link carries the visitor id, so a click counts for the same visitor as the view.
    for (const a of document.querySelectorAll<HTMLAnchorElement>("a[data-cta]")) if (vid) a.href = `/c/${renderId}/go?v=${encodeURIComponent(vid)}`;
    const video = document.querySelector<HTMLVideoElement>(`video[data-variant="${renderId}"]`);
    if (!video) return;
    const onPlay = () => send("play");
    const onTime = () => { if (video.duration && video.currentTime / video.duration >= 0.9) send("complete"); };
    video.addEventListener("playing", onPlay);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("ended", () => send("complete"));
    return () => { video.removeEventListener("playing", onPlay); video.removeEventListener("timeupdate", onTime); };
  }, [renderId]);
  return (
    <video
      data-variant={renderId}
      src={`/api/renders/${renderId}/watch`}
      controls
      autoPlay
      muted
      playsInline
      className={className}
    />
  );
}
