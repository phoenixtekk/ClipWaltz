"use client";
import { useDateFormat, type DateKind } from "@/lib/local-date";

/** A date in the viewer's locale and time zone, without a hydration mismatch (see src/lib/local-date.ts). */
export function LocalDate({ value, kind = "datetime", options }: {
  value: string | number | Date; kind?: DateKind; options?: Intl.DateTimeFormatOptions;
}) {
  const fmt = useDateFormat();
  const d = value instanceof Date ? value : new Date(value);
  return <time dateTime={Number.isNaN(d.getTime()) ? undefined : d.toISOString()}>{fmt(d, kind, options)}</time>;
}
