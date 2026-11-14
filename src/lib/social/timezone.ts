import { getSetting, setSetting } from "@/lib/social/settings";

// ─── Scheduling timezone ──────────────────────────────────────────────────────
// "Post at 09:15" means 09:15 *where you are*, not where the server happens to
// live. The fleet runs on UTC, so without this a rule set for 09:15 fired at
// 02:15 local — which reads as "tomorrow" on the Auto Post page and makes
// same-day testing impossible.
//
// One app-level zone drives every schedule (Auto Post rules and funnels), so
// there is a single answer to "what does 09:15 mean here".

const KEY = "app:timezone";

export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Configured zone, else the server's, else UTC. */
export async function getAppTimezone(): Promise<string> {
  const stored = (await getSetting(KEY))?.trim();
  if (stored && isValidTimezone(stored)) return stored;
  const server = process.env.TZ?.trim();
  if (server && isValidTimezone(server)) return server;
  return "UTC";
}

export async function setAppTimezone(tz: string): Promise<boolean> {
  if (!isValidTimezone(tz)) return false;
  await setSetting(KEY, tz);
  return true;
}

/** How far `tz` is from UTC at this instant, in ms (DST-aware). */
export function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) if (part.type !== "literal") p[part.type] = part.value;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - date.getTime();
}

/** The calendar date it currently is in `tz`. */
export function zonedYmd(date: Date, tz: string): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) if (part.type !== "literal") p[part.type] = part.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

/**
 * The instant at which a wall-clock time occurs in `tz`. Offsets are resolved
 * twice so a slot that lands across a DST change still points at the right
 * moment rather than being an hour out.
 */
export function zonedTimeToUtc(y: number, m: number, d: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  const first = tzOffsetMs(new Date(guess), tz);
  let ts = guess - first;
  const second = tzOffsetMs(new Date(ts), tz);
  if (second !== first) ts = guess - second;
  return new Date(ts);
}
