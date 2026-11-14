import { randomUUID } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { composeForNetwork } from "@/lib/social/ai";
import { IMAGE_COST } from "@/lib/credits";
import { limitsFor } from "@/lib/social/network-capabilities";
import { suggestTimes } from "@/lib/social/best-time";
import { getAppTimezone, zonedTimeToUtc, zonedYmd } from "@/lib/social/timezone";
import { providerName } from "@/lib/social/ui-types";

// G14 bulk generation / multi-angle copilot (plan §6 G14) — "Plan a week". A brief becomes N drafts across distinct
// angles (problem-solution, educational, social proof, minimalist), laid onto the calendar as DRAFTS at suggested
// times (G6). Drafts never publish by themselves; scheduling them later goes through approval (G9) like any post.
//
// No two drafts may be near-duplicates: each new draft is embedded (AI Box nomic-embed-text) and compared with the
// drafts already kept and the workspace's recent posts; at cosine similarity ≥ 0.94 (Social Publishing's threshold —
// nomic-embed scores distinct same-topic posts ~0.85–0.93) it is re-written with a "take a different angle" nudge, up
// to 3 tries, and dropped if it is still too close. Writing costs 0 credits. The only GPU work is the optional AI image
// per post (IMAGE_COST each) — its total is shown and must be confirmed before the drafts are saved, and each picture is
// made (and charged) when its post is published.

export const SIM_THRESHOLD = 0.94;
const MAX_TRIES = 3;
export const MAX_PLAN_POSTS = 21;

export const ANGLES = {
  problem: { label: "Problem → solution", brief: "Open with a real problem the reader has, then show how this solves it." },
  educational: { label: "Educational", brief: "Teach one useful thing (a tip, a how-to, a fact) tied to the brief. No hard sell." },
  proof: { label: "Social proof", brief: "Lead with a result, a customer moment or a before/after. Do not invent numbers, names or quotes — if none are given, describe the kind of result in general terms." },
  minimal: { label: "Minimalist", brief: "One short, punchy line or two. Very few words, a strong hook, nothing extra." },
} as const;
export type Angle = keyof typeof ANGLES;
export const ANGLE_KEYS = Object.keys(ANGLES) as Angle[];

const OLLAMA_BASE = (process.env.OLLAMA_URL || "http://192.168.166.182:11434").replace(/\/$/, "");
const EMBED_MODEL = process.env.SOCIAL_EMBED_MODEL || "nomic-embed-text";

export async function embed(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(20_000),
    });
    const d = (await res.json()) as { embedding?: number[] };
    return Array.isArray(d.embedding) && d.embedding.length ? d.embedding : null;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export function maxSimilarity(v: number[], others: number[][]): number {
  let m = 0;
  for (const o of others) m = Math.max(m, cosine(v, o));
  return m;
}

/**
 * The dedupe loop, with the writer and the embedder injected (the self-test passes stubs). For each slot, write, embed,
 * compare with everything kept so far (+ `prior`); re-write with a growing nudge while ≥ threshold; drop the slot after
 * MAX_TRIES. An embedding failure is a hard stop for that slot (never kept unchecked).
 */
export async function writeDistinct<T>(
  slots: T[],
  write: (slot: T, nudge: number) => Promise<string>,
  embedFn: (text: string) => Promise<number[] | null>,
  prior: number[][] = [],
  threshold = SIM_THRESHOLD,
): Promise<{ kept: { slot: T; text: string; similarity: number }[]; dropped: { slot: T; reason: string }[] }> {
  const vecs = [...prior];
  const kept: { slot: T; text: string; similarity: number }[] = [];
  const dropped: { slot: T; reason: string }[] = [];
  for (const slot of slots) {
    let done = false;
    let last = 0;
    for (let nudge = 0; nudge < MAX_TRIES && !done; nudge++) {
      const text = (await write(slot, nudge)).trim();
      if (!text) continue;
      const v = await embedFn(text);
      if (!v) {
        dropped.push({ slot, reason: "The similarity check (AI Box embeddings) was unavailable." });
        done = true;
        break;
      }
      last = maxSimilarity(v, vecs);
      if (last < threshold) {
        vecs.push(v);
        kept.push({ slot, text, similarity: Math.round(last * 1000) / 1000 });
        done = true;
      }
    }
    if (!done) dropped.push({ slot, reason: `Still too similar to another post after ${MAX_TRIES} tries (${last.toFixed(3)}).` });
  }
  return { kept, dropped };
}

export interface PlanInput {
  brief: string;
  days: number; // 1–14
  perDay: number; // 1–3
  angles: Angle[];
  keys: string[]; // destination keys (already checked to be the workspace's)
  providers: string[];
  autoImage: boolean;
  startDate?: string | null; // YYYY-MM-DD in the scheduling zone; default tomorrow
}

export interface PlanDraft {
  angle: Angle;
  text: string;
  at: string; // ISO instant (suggested slot of that day)
  similarity: number; // max cosine vs the other drafts / recent posts when it was kept
}

export interface PlanPreview {
  drafts: PlanDraft[];
  dropped: { angle: Angle; at: string; reason: string }[];
  credits: number; // total credits the plan will spend (AI images only)
  timezone: string;
  maxSimilarity: number;
}

/** Credits a plan will spend: only the optional AI image per post. */
export function planCredits(posts: number, autoImage: boolean): number {
  return autoImage ? posts * IMAGE_COST : 0;
}

/** Hours for each day's posts: the network's best slots (G6), else general guidance. */
async function dayHours(workspaceId: string, providers: string[], perDay: number): Promise<number[]> {
  const s = await suggestTimes(workspaceId, providers.slice(0, 1));
  const hours = (s.networks[0]?.slots ?? []).map((x) => x.hour);
  const fallback = [9, 12, 17];
  const out = [...new Set([...hours, ...fallback])].slice(0, perDay);
  return out.sort((a, b) => a - b);
}

/** Write the plan (no rows saved). */
export async function buildPlan(workspaceId: string, input: PlanInput, now = new Date()): Promise<PlanPreview> {
  const tz = await getAppTimezone();
  const days = Math.min(Math.max(Math.round(input.days), 1), 14);
  const perDay = Math.min(Math.max(Math.round(input.perDay), 1), 3);
  const angles = input.angles.length ? input.angles : ANGLE_KEYS;
  const hours = await dayHours(workspaceId, input.providers, perDay);

  const start = input.startDate && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate)
    ? (() => {
        const [y, m, d] = input.startDate!.split("-").map(Number);
        return { y, m, d };
      })()
    : (() => {
        const t = zonedYmd(now, tz);
        const nx = new Date(Date.UTC(t.y, t.m - 1, t.d + 1));
        return { y: nx.getUTCFullYear(), m: nx.getUTCMonth() + 1, d: nx.getUTCDate() };
      })();

  const slots: { angle: Angle; at: Date }[] = [];
  let i = 0;
  for (let day = 0; day < days; day++) {
    const dt = new Date(Date.UTC(start.y, start.m - 1, start.d + day));
    for (const h of hours) {
      if (slots.length >= MAX_PLAN_POSTS) break;
      slots.push({ angle: angles[i % angles.length], at: zonedTimeToUtc(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), h, 0, tz) });
      i++;
    }
  }

  // Shortest text limit among the chosen networks, so one draft fits them all (per-network copy comes later, G4).
  const limits = input.providers.map((p) => limitsFor(p).text?.max).filter((x): x is number => typeof x === "number");
  const limit = limits.length ? Math.min(...limits) : undefined;
  const label = [...new Set(input.providers.map(providerName))].join(", ") || "social media";

  // The workspace's recent posts count against similarity too, so a plan does not repeat last week.
  const recent = await db
    .select({ text: schema.socialPosts.text })
    .from(schema.socialPosts)
    .where(and(eq(schema.socialPosts.workspaceId, workspaceId), inArray(schema.socialPosts.status, ["published", "partial", "scheduled", "queued"])))
    .orderBy(desc(schema.socialPosts.createdAt))
    .limit(12);
  const prior: number[][] = [];
  for (const r of recent) {
    const v = r.text.trim() ? await embed(r.text) : null;
    if (v) prior.push(v);
  }

  const brief = input.brief.trim().slice(0, 3000);
  const written: string[] = [];
  const res = await writeDistinct(
    slots,
    async (slot, nudge) => {
      const text = await composeForNetwork({
        seed: `${brief}\n\nANGLE for this post — ${ANGLES[slot.angle].label}: ${ANGLES[slot.angle].brief}`,
        networkLabel: label,
        limit,
        avoid: written.slice(-6),
        nudge,
      });
      return text;
    },
    embed,
    prior,
  );
  for (const k of res.kept) written.push(k.text);
  const drafts = res.kept.map((k) => ({ angle: k.slot.angle, text: k.text, at: k.slot.at.toISOString(), similarity: k.similarity }));
  return {
    drafts,
    dropped: res.dropped.map((d) => ({ angle: d.slot.angle, at: d.slot.at.toISOString(), reason: d.reason })),
    credits: planCredits(drafts.length, input.autoImage),
    timezone: tz,
    maxSimilarity: drafts.reduce((m, d) => Math.max(m, d.similarity), 0),
  };
}

/** Save the confirmed plan as drafts on the calendar. Returns the plan id and how many drafts were created. */
export async function savePlan(
  workspaceId: string,
  userId: string,
  drafts: { angle: Angle; text: string; at: string }[],
  keys: string[],
  autoImage: boolean,
): Promise<{ planId: string; created: number }> {
  const planId = randomUUID();
  const rows = drafts.slice(0, MAX_PLAN_POSTS).map((d) => ({
    id: randomUUID(),
    workspaceId,
    createdBy: userId,
    text: d.text.trim().slice(0, 100_000),
    providers: keys.join(","),
    status: "draft",
    // A draft with a planned time shows on the calendar; it only goes out once someone schedules it.
    scheduledAt: new Date(d.at),
    autoImage,
    planId,
    planAngle: d.angle,
    approvalStatus: "none",
  }));
  if (rows.length) await db.insert(schema.socialPosts).values(rows);
  return { planId, created: rows.length };
}
