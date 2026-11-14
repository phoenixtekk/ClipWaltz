"use client";
import { useEffect } from "react";

// G16: register the one service worker (public/sw.js, scope "/") on every page so the app is installable and has an
// offline fallback. It is the SAME worker and scope that Web Push uses (src/lib/notify-client.ts), so registering it
// here never replaces or breaks an existing push subscription.
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
