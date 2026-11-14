import { and, eq, gte, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAppTimezone, tzOffsetMs, zonedTimeToUtc, zonedYmd } from "@/lib/social/timezone";

// G6 suggested posting times (plan §6 G6). Per network, recommend weekday × hour slots from THIS workspace's own
// published posts: each published destination's latest engagement (social_post_targets.metrics — likes + comments +
// shares, filled by the hourly metrics-pull; imported Social Publishing posts carry theirs) at the hour it went out,
// over the last 90 days. Engagement is divided by that network's average first, so a big network does not drown a small
// one and every network's slots are compared on its own scale.
//
// Below MIN_POSTS published posts with metrics on a network, there is not enough history: the answer is clearly marked
// `personalised: false` with GENERAL defaults (common weekday office-hour slots, not research data and not this
// workspace's data). A bucket needs MIN_BUCKET posts before it can be recommended at all.

export const WINDOW_DAYS = 90;
export const MIN_POSTS = 10;
export const MIN_BUCKET = 2;
const TOP = 3;

export interface Sample {
  provider: string;
  at: Date; // when it was published
  engagement: number; // likes + comments + shares
}

export interface Slot {
  weekday: number; // 0 = Sunday … 6 = Saturday, in the scheduling time zone
  hour: number; // 0–23
  /** Average engagement in this slot ÷ the network's average (1 = average; 1.8 = 80% above). Null for defaults. */
  lift: number | null;
  posts: number; // how many of the workspace's posts went out in this slot
  /** The next time this slot comes round, as an ISO instant (for the composer's day + time). */
  next: string;
}

export interface NetworkSuggestion {
  provider: string;
  personalised: boolean;
  posts: number; // published posts with metrics in the window
  slots: Slot[];
  note: string;
}

// General guidance shown when a network has too little history. Deliberately plain weekday slots, labelled as general
// guidance in the UI — ClipWaltz holds no benchmark data, so it does not claim any.
const GENERAL: { weekday: number; hour: number }[] = [
  { weekday: 2, hour: 9 },
  { weekday: 3, hour: 12 },
  { weekday: 4, hour: 17 },
];
const GENERAL_EVENING: { weekday: number; hour: number }[] = [
  { weekday: 2, hour: 19 },
  { weekday: 4, hour: 19 },
  { weekday: 6, hour: 11 },
];
const EVENING_NETWORKS = new Set(["tiktok", "instagram", "youtube", "threads", "pinterest", "tumblr"]);

/** Weekday + hour of an instant in a time zone. */
export function zonedWeekdayHour(at: Date, tz: string): { weekday: number; hour: number } {
  const local = new Date(at.getTime() + tzOffsetMs(at, tz));
  return { weekday: local.getUTCDay(), hour: local.getUTCHours() };
}

/** The next instant (after `now`) at which weekday/hour occurs in `tz`. */
export function nextOccurrence(weekday: number, hour: number, now: Date, tz: string): Date {
  const { y, m, d } = zonedYmd(now, tz);
  for (let i = 0; i < 8; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    if (day.getUTCDay() !== weekday) continue;
    const at = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, 0, tz);
    if (at.getTime() > now.getTime() + 5 * 60_000) return at;
  }
  const day = new Date(Date.UTC(y, m - 1, d + 7));
  return zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, 0, tz);
}

/** Pure ranking (exported for the self-test): best slots for one network's samples. */
export function rankSlots(samples: Sample[], tz: string, now: Date): { personalised: boolean; slots: Slot[]; posts: number } {
  const posts = samples.length;
  const mean = posts ? samples.reduce((a, s) => a + s.engagement, 0) / posts : 0;
  if (posts < MIN_POSTS || mean <= 0) return { personalised: false, slots: [], posts };
  const buckets = new Map<string, { weekday: number; hour: number; sum: number; n: number }>();
  for (const s of samples) {
    const { weekday, hour } = zonedWeekdayHour(s.at, tz);
    const k = `${weekday}:${hour}`;
    const b = buckets.get(k) ?? { weekday, hour, sum: 0, n: 0 };
    b.sum += s.engagement / mean;
    b.n++;
    buckets.set(k, b);
  }
  const ranked = [...buckets.values()]
    .filter((b) => b.n >= MIN_BUCKET)
    .map((b) => ({ ...b, lift: b.sum / b.n }))
    .sort((a, b) => b.lift - a.lift || b.n - a.n)
    .slice(0, TOP);
  if (ranked.length === 0) return { personalised: false, slots: [], posts };
  return {
    personalised: true,
    posts,
    slots: ranked.map((b) => ({
      weekday: b.weekday,
      hour: b.hour,
      lift: Math.round(b.lift * 100) / 100,
      posts: b.n,
      next: nextOccurrence(b.weekday, b.hour, now, tz).toISOString(),
    })),
  };
}

function general(provider: string, tz: string, now: Date): Slot[] {
  return (EVENING_NETWORKS.has(provider) ? GENERAL_EVENING : GENERAL).map((g) => ({
    ...g,
    lift: null,
    posts: 0,
    next: nextOccurrence(g.weekday, g.hour, now, tz).toISOString(),
  }));
}

/** The workspace's published samples per network over the window. */
export async function workspaceSamples(workspaceId: string, now = new Date()): Promise<Sample[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({
      provider: schema.socialPostTargets.provider,
      metrics: schema.socialPostTargets.metrics,
      targetAt: schema.socialPostTargets.updatedAt,
      publishedAt: schema.socialPosts.publishedAt,
    })
    .from(schema.socialPostTargets)
    .innerJoin(schema.socialPosts, eq(schema.socialPostTargets.postId, schema.socialPosts.id))
    .where(
      and(
        eq(schema.socialPosts.workspaceId, workspaceId),
        eq(schema.socialPostTargets.status, "published"),
        isNotNull(schema.socialPostTargets.metrics),
        isNotNull(schema.socialPosts.publishedAt),
        gte(schema.socialPosts.publishedAt, since),
      ),
    );
  return rows
    .map((r) => {
      const m = r.metrics;
      if (!m) return null;
      const parts = [m.likes, m.comments, m.shares].filter((x): x is number => typeof x === "number");
      if (parts.length === 0) return null; // the network reported nothing (not zero)
      return { provider: r.provider, at: r.publishedAt ?? r.targetAt, engagement: parts.reduce((a, b) => a + b, 0) };
    })
    .filter((x): x is Sample => x !== null);
}

/** Suggestions for each of the given networks (deduplicated), in the scheduling time zone. */
export async function suggestTimes(workspaceId: string, providers: string[], now = new Date()): Promise<{ timezone: string; networks: NetworkSuggestion[] }> {
  const tz = await getAppTimezone();
  const samples = await workspaceSamples(workspaceId, now);
  const out: NetworkSuggestion[] = [];
  for (const provider of [...new Set(providers)]) {
    const r = rankSlots(samples.filter((s) => s.provider === provider), tz, now);
    out.push(
      r.personalised
        ? { provider, personalised: true, posts: r.posts, slots: r.slots, note: `From ${r.posts} of your posts in the last ${WINDOW_DAYS} days.` }
        : {
            provider,
            personalised: false,
            posts: r.posts,
            slots: general(provider, tz, now),
            note: `Not enough history yet (${r.posts} of ${MIN_POSTS} posts with results) — showing general guidance.`,
          },
    );
  }
  return { timezone: tz, networks: out };
}

/** For the calendar: the best personalised slots across all of the workspace's networks (or general guidance). */
export async function workspaceBestSlots(workspaceId: string, now = new Date()) {
  const tz = await getAppTimezone();
  const samples = await workspaceSamples(workspaceId, now);
  const providers = [...new Set(samples.map((s) => s.provider))];
  const per = providers.map((p) => ({ provider: p, ...rankSlots(samples.filter((s) => s.provider === p), tz, now) })).filter((r) => r.personalised);
  return { timezone: tz, networks: per.map((r) => ({ provider: r.provider, slots: r.slots, posts: r.posts })) };
}
