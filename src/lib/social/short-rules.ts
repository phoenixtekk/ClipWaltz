import { randomUUID } from "crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { computeNextRun, ruleTimezone } from "@/lib/social/scheduler";
import { isAdminWorkspace, startShort, usableKeys } from "@/lib/social/render-jobs";

// Shorts rules (P5, decision D6; SP 0031 + /api/shorts/rules + scheduler step 2.6), workspace-scoped.
//
// A due rule is CLAIMED first — next_run_at pushed forward conditionally on the value read — and only then is its
// Short created (as a render job for the AI box). SP learned this the hard way: a build outlasting the one-minute sweep
// was started twice, and the ElevenLabs bill is per character. Only ONE Short is started per sweep however many rules
// are due, as SP did, so a backlog can't flood the render worker.

export type ShortRule = typeof schema.shortRules.$inferSelect;

export interface ShortRuleInput {
  id?: string;
  name?: string;
  source?: string;
  solutionFilter?: string;
  seedPrompt?: string;
  topics?: string;
  daysOfWeek?: string;
  timeOfDay?: string;
  timezone?: string | null;
  providers?: string;
  active?: boolean;
  reviewFirst?: boolean;
}

function clean(b: ShortRuleInput) {
  const str = (v: unknown, max = 8000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const days = str(b.daysOfWeek, 40)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-6]$/.test(s));
  const time = str(b.timeOfDay, 5);
  return {
    name: str(b.name, 120) || "Shorts",
    source: str(b.source) === "workplace" ? "workplace" : "seed",
    solutionFilter: str(b.solutionFilter, 200),
    seedPrompt: str(b.seedPrompt),
    topics: str(b.topics),
    daysOfWeek: days.length ? [...new Set(days)].join(",") : "1,2,3,4,5",
    timeOfDay: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "09:00",
    timezone: str(b.timezone, 64) || null,
    providers: str(b.providers, 4000),
    active: b.active !== false,
    reviewFirst: b.reviewFirst !== false,
  };
}

export async function listShortRules(workspaceId: string): Promise<ShortRule[]> {
  return db.select().from(schema.shortRules).where(eq(schema.shortRules.workspaceId, workspaceId)).orderBy(asc(schema.shortRules.createdAt));
}

export async function saveShortRule(workspaceId: string, userId: string, b: ShortRuleInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const data = clean(b);
  if (!data.providers) return { ok: false, error: "Choose at least one destination." };
  if (data.source === "workplace" && !(await isAdminWorkspace(workspaceId))) {
    return { ok: false, error: "Workplace-catalogue Shorts are only available to the Phoenixtekk admin workspace. Write your own brief and topics instead." };
  }
  if (data.source === "seed" && !data.topics) {
    return { ok: false, error: "A rule needs at least one topic — there is nothing to write about otherwise." };
  }
  if (b.id) {
    const r = await db
      .update(schema.shortRules)
      // nextRunAt cleared so the sweep re-computes the next slot from the new schedule.
      .set({ ...data, nextRunAt: null, updatedAt: new Date() })
      .where(and(eq(schema.shortRules.id, b.id), eq(schema.shortRules.workspaceId, workspaceId), isNull(schema.shortRules.migrationHold)))
      .returning({ id: schema.shortRules.id });
    if (!r.length) return { ok: false, error: "Rule not found (or it is an imported rule still on hold)." };
    return { ok: true, id: b.id };
  }
  const id = randomUUID();
  await db.insert(schema.shortRules).values({ id, workspaceId, createdBy: userId, ...data });
  return { ok: true, id };
}

export async function deleteShortRule(workspaceId: string, id: string): Promise<boolean> {
  const r = await db
    .delete(schema.shortRules)
    .where(and(eq(schema.shortRules.id, id), eq(schema.shortRules.workspaceId, workspaceId)))
    .returning({ id: schema.shortRules.id });
  return r.length > 0;
}

/** Start one Short from a rule now (the sweep, or "Run now"). Returns the post id or a user-facing error. */
export async function runShortRule(rule: ShortRule, userId: string): Promise<{ postId?: string; error?: string }> {
  const keys = await usableKeys(rule.providers.split(",").map((s) => s.trim()).filter(Boolean), rule.workspaceId, { allowPodcast: false });
  if (!keys.length) return { error: "No usable destinations on this rule — they are disconnected or paused." };
  const topics = rule.topics.split(",").map((s) => s.trim()).filter(Boolean);
  const topic = rule.source === "seed" ? topics[rule.topicCursor % Math.max(1, topics.length)] : undefined;
  try {
    const { postId } = await startShort({
      workspaceId: rule.workspaceId,
      userId,
      keys,
      source: rule.source === "workplace" ? "workplace" : "seed",
      solutionFilter: rule.solutionFilter,
      solutionCursor: rule.solutionCursor,
      seedPrompt: rule.seedPrompt,
      topic,
      reviewFirst: rule.reviewFirst,
      shortRuleId: rule.id,
    });
    return { postId };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Sweep step: claim and start at most one due Shorts rule. Never throws. */
export async function sweepShortRules(now: Date): Promise<{ started: number; errors: string[] }> {
  const out = { started: 0, errors: [] as string[] };
  const rules = await db
    .select()
    .from(schema.shortRules)
    .where(and(eq(schema.shortRules.active, true), isNull(schema.shortRules.migrationHold)));
  for (const rule of rules) {
    try {
      const tz = await ruleTimezone(rule);
      const days = rule.daysOfWeek.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      if (!rule.nextRunAt) {
        await db.update(schema.shortRules).set({ nextRunAt: computeNextRun(days, rule.timeOfDay, now, tz) }).where(eq(schema.shortRules.id, rule.id));
        continue;
      }
      if (rule.nextRunAt > now || out.started > 0) continue;
      const claimed = await db
        .update(schema.shortRules)
        .set({ lastRunAt: now, nextRunAt: computeNextRun(days, rule.timeOfDay, now, tz) })
        .where(and(eq(schema.shortRules.id, rule.id), eq(schema.shortRules.nextRunAt, rule.nextRunAt)))
        .returning({ id: schema.shortRules.id });
      if (!claimed.length) continue;
      if (!rule.createdBy) {
        out.errors.push(`short rule ${rule.id}: no creator to pay the credits`);
        continue;
      }
      const r = await runShortRule(rule, rule.createdBy);
      if (r.postId) out.started++;
      else out.errors.push(`short rule ${rule.id}: ${r.error}`);
    } catch (e) {
      out.errors.push(`short rule ${rule.id}: ${(e as Error).message}`);
    }
  }
  return out;
}
