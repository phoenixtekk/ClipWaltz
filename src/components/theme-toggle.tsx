"use client";
import { useSyncExternalStore } from "react";
import { Sun, Moon } from "lucide-react";

// Read the current theme from the <html> class (set pre-hydration by the inline
// script in the root layout — no flash), and subscribe to changes so the icon
// stays in sync. useSyncExternalStore keeps this SSR-safe without setState-in-effect.
function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");

/** Flips the `dark` class on <html> and persists the choice. */
export function ThemeToggle({ className }: { className?: string }) {
  const dark = useSyncExternalStore(
    subscribe,
    isDark,
    () => false, // server snapshot: render the Moon (light) icon
  );

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("cw-theme", next ? "dark" : "light");
    } catch {
      /* private mode / blocked storage — theme still applies for this visit */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle light or dark mode"
      title="Toggle light / dark"
      className={className}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
