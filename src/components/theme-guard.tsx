"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Re-asserts the theme on every route change. The pre-paint script in the root layout only
 * runs on a full document load; during client navigation a root re-render (the app pages sit
 * under a dynamic, cookie-reading layout) can reset the server-rendered <html> className and
 * drop the `dark` class, flipping the app to light. This restores it from `cw-theme` on each
 * navigation so the theme is stable everywhere. Idempotent; no visible effect when already correct.
 */
export function ThemeGuard() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const dark = (localStorage.getItem("cw-theme") || "dark") === "dark";
      document.documentElement.classList.toggle("dark", dark);
    } catch {
      document.documentElement.classList.add("dark");
    }
  }, [pathname]);
  return null;
}
