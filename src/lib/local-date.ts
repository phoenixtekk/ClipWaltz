// Dates in client components: the server renders them in its own locale and time zone, the browser in the viewer's,
// so formatting them directly makes the HTML differ from the first client render (a hydration error, and React throws
// the server tree away). Until hydration is done these helpers format in a fixed locale and UTC — the same on both
// sides — then switch to the viewer's locale and time zone.
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False during the server render and hydration, true afterwards (and on client-side navigations). */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

export type DateKind = "date" | "time" | "datetime";
const DEFAULTS: Record<DateKind, Intl.DateTimeFormatOptions> = {
  date: { year: "numeric", month: "numeric", day: "numeric" },
  time: { hour: "numeric", minute: "2-digit" },
  datetime: { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" },
};

/** Format a date: in the viewer's locale / time zone when `local`, else en-US in UTC (stable on server and client). */
export function formatDate(value: string | number | Date, kind: DateKind = "datetime", options?: Intl.DateTimeFormatOptions, local = true): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const opts = options ?? DEFAULTS[kind];
  return local
    ? new Intl.DateTimeFormat(undefined, opts).format(d)
    : new Intl.DateTimeFormat("en-US", { ...opts, timeZone: opts.timeZone ?? "UTC" }).format(d);
}

/** A hydration-safe `formatDate` for client components. */
export function useDateFormat() {
  const hydrated = useHydrated();
  return (value: string | number | Date, kind?: DateKind, options?: Intl.DateTimeFormatOptions) => formatDate(value, kind, options, hydrated);
}
