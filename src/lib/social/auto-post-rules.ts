import { randomUUID } from "crypto";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseLinks } from "@/lib/social/post-links";
import { computeNextRun, ruleTimezone } from "@/lib/social/scheduler";
import { isValidTimezone } from "@/lib/social/timezone";

// ─── Auto Post rules (many per workspace) ──────────────────────────────────────────
// Each rule is an independent recurring publisher: its own name, schedule,
// destinations, and — in generate mode — its own seed prompt, topic rotation,
// product and image behaviour. The scheduler already sweeps every active rule,
// so "several rules" is a UI/API concern rather than an engine change.

export type Rule = typeof schema.socialAutoRules.$inferSelect;

export interface RuleInput {
  name?: string;
  daysOfWeek?: number[];
  timesOfDay?: string[];
  timeOfDay?: string;
  providers?: string[];
  active?: boolean;
  mode?: string;
  seedPrompt?: string;
  topics?: string;
  productId?: string | null;
  imageMode?: string;
  videoMode?: string;
  imageSet?: string[];
  links?: string;
  linkUtm?: boolean;
  reviewFirst?: boolean;
  /** IANA zone the times are read in (ClipWaltz: per rule; SP had one per installation). */
  timezone?: string | null;
}

export interface RuleCard extends Rule {
  /** Posts this rule has produced (post.autoPostRuleId), all-time and recent. */
  postsTotal: number;
  postsRecent: number;
  /** Destination keys that another active rule also posts to at the same time. */
  clashesWith: string[];
}

const TIME_RE = /^\d{2}:\d{2}$/;

export function normalize(body: RuleInput): Omit<typeof schema.socialAutoRules.$inferInsert, "id" | "workspaceId"> {
  const days = (body.daysOfWeek ?? [1, 2, 3, 4, 5]).filter((n) => n >= 0 && n <= 6);
  const rawTimes = Array.isArray(body.timesOfDay) ? body.timesOfDay : String(body.timeOfDay ?? "").split(",");
  const times = rawTimes.map((t) => String(t).trim()).filter((t) => TIME_RE.test(t));
  return {
    name: (body.name ?? "Untitled rule").trim().slice(0, 60) || "Untitled rule",
    daysOfWeek: days.join(","),
    timeOfDay: (times.length ? times : ["09:00"]).join(","),
    providers: (body.providers ?? []).join(","),
    active: body.active ?? true,
    mode: body.mode === "generate" ? "generate" : "queue",
    seedPrompt: (body.seedPrompt ?? "").slice(0, 4000),
    topics: (body.topics ?? "").slice(0, 4000),
    // Only keep lines that are actually URLs, so a stray note in the box cannot
    // end up appended to a post as if it were a link.
    links: parseLinks(body.links).join("\n").slice(0, 4000),
    linkUtm: body.linkUtm ?? false,
    productId: body.productId || null,
    imageMode: ["generate", "set"].includes(body.imageMode ?? "") ? body.imageMode! : "none",
    // `normalize()` is a FULL replace — anything omitted is blanked (that is how
    // three rules lost their links once). So this has to be listed here, and
    // every caller that saves a rule has to send it.
    videoMode: body.videoMode === "explainer" ? "explainer" : "none",
    imageSet: (body.imageSet ?? []).join(","),
    reviewFirst: body.reviewFirst ?? false,
    timezone: body.timezone && isValidTimezone(body.timezone) ? body.timezone : null,
    nextRunAt: null,
  };
}

/** Recompute a rule's next slot straight away rather than waiting for a sweep. */
export async function scheduleRule(ruleId: string): Promise<Date | null> {
  const rule = await db.query.socialAutoRules.findFirst({ where: eq(schema.socialAutoRules.id, ruleId) });
  if (!rule) return null;
  const days = rule.daysOfWeek.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  const nextRunAt = computeNextRun(days, rule.timeOfDay, new Date(), await ruleTimezone(rule));
  await db.update(schema.socialAutoRules).set({ nextRunAt }).where(eq(schema.socialAutoRules.id, ruleId));
  return nextRunAt;
}

export async function listRules(workspaceId: string): Promise<RuleCard[]> {
  const rules = await db
    .select()
    .from(schema.socialAutoRules)
    .where(eq(schema.socialAutoRules.workspaceId, workspaceId))
    .orderBy(desc(schema.socialAutoRules.createdAt));

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const cards: RuleCard[] = [];
  for (const r of rules) {
    const [{ n: total } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.socialPosts)
      .where(eq(schema.socialPosts.autoPostRuleId, r.id));
    const [{ n: recent } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.socialPosts)
      .where(and(eq(schema.socialPosts.autoPostRuleId, r.id), gte(schema.socialPosts.createdAt, weekAgo)));
    cards.push({ ...r, postsTotal: Number(total), postsRecent: Number(recent), clashesWith: [] });
  }

  // With several rules it becomes easy to have two fire into the same channel at
  // the same minute — which double-posts. Flag the overlap rather than silently
  // letting it happen.
  for (const a of cards) {
    if (!a.active) continue;
    const aTimes = new Set(a.timeOfDay.split(","));
    const aDays = new Set(a.daysOfWeek.split(","));
    const aDests = new Set(a.providers.split(",").filter(Boolean));
    for (const b of cards) {
      if (b.id === a.id || !b.active) continue;
      const sharesTime = b.timeOfDay.split(",").some((t) => aTimes.has(t));
      const sharesDay = b.daysOfWeek.split(",").some((d) => aDays.has(d));
      if (!sharesTime || !sharesDay) continue;
      for (const d of b.providers.split(",").filter(Boolean)) {
        if (aDests.has(d) && !a.clashesWith.includes(d)) a.clashesWith.push(d);
      }
    }
  }
  return cards;
}

export async function createRule(workspaceId: string, body: RuleInput, createdBy?: string | null): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.socialAutoRules).values({ id, workspaceId, ...normalize(body), createdBy: createdBy ?? null });
  await scheduleRule(id);
  return id;
}

export async function updateRule(id: string, workspaceId: string, body: RuleInput): Promise<boolean> {
  const res = await db
    .update(schema.socialAutoRules)
    .set(normalize(body))
    .where(and(eq(schema.socialAutoRules.id, id), eq(schema.socialAutoRules.workspaceId, workspaceId)))
    .returning({ id: schema.socialAutoRules.id });
  if (res.length === 0) return false;
  await scheduleRule(id);
  return true;
}

/**
 * Flip a rule's active flag and nothing else.
 *
 * `updateRule` replaces the whole row through `normalize()`, so a caller that
 * sends a partial body silently blanks every field it omitted — that is how
 * pausing a rule used to wipe its links. Anything that changes one property
 * belongs here rather than in a hand-built full payload.
 */
export async function setRuleActive(id: string, workspaceId: string, active: boolean): Promise<boolean> {
  const res = await db
    .update(schema.socialAutoRules)
    .set({ active })
    .where(and(eq(schema.socialAutoRules.id, id), eq(schema.socialAutoRules.workspaceId, workspaceId)))
    .returning({ id: schema.socialAutoRules.id });
  if (res.length === 0) return false;
  await scheduleRule(id);
  return true;
}

export async function deleteRule(id: string, workspaceId: string): Promise<boolean> {
  const res = await db
    .delete(schema.socialAutoRules)
    .where(and(eq(schema.socialAutoRules.id, id), eq(schema.socialAutoRules.workspaceId, workspaceId)))
    .returning({ id: schema.socialAutoRules.id });
  return res.length > 0;
}

/** Copy a rule, paused, so a variant can be edited before it starts posting. */
export async function duplicateRule(id: string, workspaceId: string, createdBy?: string | null): Promise<string | null> {
  const src = await db.query.socialAutoRules.findFirst({
    where: and(eq(schema.socialAutoRules.id, id), eq(schema.socialAutoRules.workspaceId, workspaceId)),
  });
  if (!src) return null;
  const copyId = randomUUID();
  await db.insert(schema.socialAutoRules).values({
    id: copyId, workspaceId, createdBy: createdBy ?? src.createdBy, timezone: src.timezone,
    name: `${src.name} (copy)`.slice(0, 60),
    daysOfWeek: src.daysOfWeek, timeOfDay: src.timeOfDay, providers: src.providers,
    active: false, // never start posting behind the operator's back
    mode: src.mode, seedPrompt: src.seedPrompt, topics: src.topics, productId: src.productId,
    // Copy the link rotation as well — a duplicate that silently lost its links
    // would be the same class of bug as the partial-payload one above.
    links: src.links, linkUtm: src.linkUtm,
    imageMode: src.imageMode, videoMode: src.videoMode, imageSet: src.imageSet, reviewFirst: src.reviewFirst,
    nextRunAt: null,
  });
  return copyId;
}

export async function getRule(id: string, workspaceId: string): Promise<Rule | null> {
  return (await db.query.socialAutoRules.findFirst({
    where: and(eq(schema.socialAutoRules.id, id), eq(schema.socialAutoRules.workspaceId, workspaceId)),
  })) ?? null;
}
