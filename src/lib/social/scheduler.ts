import { and, eq, inArray, isNull, lte, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { publishPost } from "@/lib/social/publish-post";
import { refreshThreadsToken } from "@/lib/social/oauth/threads";
import { refreshLinkedInToken } from "@/lib/social/oauth/linkedin";
import { autoRefreshFacebook } from "@/lib/social/oauth/facebook-tokens";
import { listAllConnectionsForMaintenance, updateConnectionTokens } from "@/lib/social/connections";
import { retryDueTargets, reapStuckPublishing } from "@/lib/social/retry-targets";
import { nextPostForRule } from "@/lib/social/auto-post";
import { getSetting, setSetting } from "@/lib/social/settings";
import { getAppTimezone, isValidTimezone, zonedTimeToUtc, zonedYmd } from "@/lib/social/timezone";

// The scheduler sweep. Ported from SP `src/lib/scheduler.ts`.
//
// SP ran this from a crontab line that POSTed `/api/cron/run` every minute. ClipWaltz runs it as the repeatable
// `sweep` job (every 60 s) in worker/social-worker.mjs (plan §4.5). Its steps:
//
//   0. refresh OAuth tokens nearing expiry (LinkedIn, Threads) and keep Facebook Page tokens self-healing
//   1. publish due scheduled posts (skipping posts awaiting approval — D9)
//   2. fire due Auto Post rules
//   3. settle anything stranded mid-publish, re-enqueue lost jobs, and fire due retries
//
// Not ported: the funnel planner (stays on SP — D3). SP's Shorts rules and explainer render queue arrived in P5
// (render-jobs.ts / short-rules.ts); the per-network AI image render queue in P3 (via the generation queue).

type Enqueue = (targetId: string, attempt: number) => Promise<void>;

// Refresh OAuth tokens nearing expiry (within 7 days) so connections don't lapse.
async function refreshExpiringTokens(now: Date) {
  const window = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const conns = [
    ...(await listAllConnectionsForMaintenance("threads")),
    ...(await listAllConnectionsForMaintenance("linkedin")),
  ];
  let refreshed = 0;
  for (const c of conns) {
    if (!c.expiresAt || c.expiresAt > window) continue;
    try {
      if (c.provider === "threads") {
        const r = await refreshThreadsToken(c.accessToken);
        if (r) {
          // Update THIS instance by id (multiple accounts per provider are allowed).
          await updateConnectionTokens(c, {
            accessToken: r.accessToken,
            expiresAt: r.expiresIn ? new Date(now.getTime() + r.expiresIn * 1000) : null,
          });
          refreshed++;
        }
      } else if (c.provider === "linkedin" && c.refreshToken) {
        const r = await refreshLinkedInToken(c.refreshToken);
        if (r) {
          await updateConnectionTokens(c, {
            accessToken: r.accessToken,
            refreshToken: r.refreshToken,
            expiresAt: r.expiresIn ? new Date(now.getTime() + r.expiresIn * 1000) : null,
          });
          refreshed++;
        }
      }
    } catch {
      /* leave the connection; try again next sweep */
    }
  }
  return refreshed;
}

// Next datetime strictly after `from` matching one of `days` (0=Sun..6=Sat) at HH:MM. Evaluated in `tz` when given,
// falling back to the server's local time, which on this fleet is UTC. `hhmm` may be a single "HH:MM" or a
// comma-separated list of times ("09:00,13:00,17:00"). Returns the soonest future slot across every day×time combo.
export function computeNextRun(days: number[], hhmm: string, from: Date, tz?: string): Date {
  const times = hhmm.split(",").map((s) => s.trim()).filter(Boolean).map((t) => {
    const [h, m] = t.split(":").map(Number);
    return { h: h || 0, m: m || 0 };
  });
  if (times.length === 0) times.push({ h: 9, m: 0 });

  let best: Date | null = null;

  // With a zone, walk the calendar *there*: "09:15 on a weekday" has to mean the operator's 09:15, not the server's.
  // Without one, fall back to server-local time (the original behaviour).
  if (tz && isValidTimezone(tz)) {
    const today = zonedYmd(from, tz);
    for (let i = 0; i <= 7; i++) {
      const cal = new Date(Date.UTC(today.y, today.m - 1, today.d));
      cal.setUTCDate(cal.getUTCDate() + i);
      if (!days.includes(cal.getUTCDay())) continue;
      for (const { h, m } of times) {
        const d = zonedTimeToUtc(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), h, m, tz);
        if (d.getTime() > from.getTime() && (!best || d < best)) best = d;
      }
    }
    if (best) return best;
  }

  for (let i = 0; i <= 7; i++) {
    const day = new Date(from);
    day.setDate(day.getDate() + i);
    if (!days.includes(day.getDay())) continue;
    for (const { h, m } of times) {
      const d = new Date(day);
      d.setHours(h, m, 0, 0);
      if (d.getTime() > from.getTime() && (!best || d < best)) best = d;
    }
  }
  if (best) return best;

  // No day selected within a week → fall back to 7 days out at the first time.
  const d = new Date(from);
  d.setDate(d.getDate() + 7);
  d.setHours(times[0].h, times[0].m, 0, 0);
  return d;
}

/** The zone a rule's times are read in: its own, else the app default (setting / TZ / UTC). */
export async function ruleTimezone(rule: { timezone: string | null }): Promise<string> {
  return rule.timezone && isValidTimezone(rule.timezone) ? rule.timezone : getAppTimezone();
}

export interface SweepSummary {
  scheduledPublished: number;
  autoPosted: number;
  autoGenerated: number;
  rulesAdvanced: number;
  tokensRefreshed: number;
  fbPagesRefreshed: number;
  targetsReaped: number;
  targetsRequeued: number;
  targetsRetried: number;
  rendersFinalized: number;
  rendersFailed: number;
  shortsStarted: number;
  errors: string[];
}

const FB_LAST_REFRESH = "facebook_last_refresh";

/**
 * One scheduler sweep. Idempotent per sweep and safe to run every minute — never throws. Each step is isolated, so a
 * failure in one (an unreachable network during token refresh, a broken rule) never stops the others.
 */
export async function runSweep(opts: { now?: Date; enqueue?: Enqueue } = {}): Promise<SweepSummary> {
  const now = opts.now ?? new Date();
  const summary: SweepSummary = {
    scheduledPublished: 0, autoPosted: 0, autoGenerated: 0, rulesAdvanced: 0, tokensRefreshed: 0,
    fbPagesRefreshed: 0, targetsReaped: 0, targetsRequeued: 0, targetsRetried: 0, rendersFinalized: 0, rendersFailed: 0,
    shortsStarted: 0, errors: [],
  };
  const note = (step: string, e: unknown) => summary.errors.push(`${step}: ${e instanceof Error ? e.message : String(e)}`);

  // 0. Token maintenance.
  try {
    summary.tokensRefreshed = await refreshExpiringTokens(now);
  } catch (e) {
    note("tokens", e);
  }
  try {
    const last = Number((await getSetting(FB_LAST_REFRESH)) || 0);
    if (now.getTime() - last > 24 * 3600 * 1000) {
      summary.fbPagesRefreshed = await autoRefreshFacebook(now);
      await setSetting(FB_LAST_REFRESH, String(now.getTime()));
    }
  } catch (e) {
    note("facebook", e);
  }

  // 0.5 Explainer / Short render jobs the AI box has settled (P5): copy + media onto the post, then release it as
  // 'scheduled' (so step 1 publishes it in this same sweep) or 'draft' (review-first); settle the credits.
  try {
    const { finalizeRenderJobs, reapOrphanRenderingPosts } = await import("@/lib/social/render-jobs");
    const r = await finalizeRenderJobs(now);
    summary.rendersFinalized = r.finalized;
    summary.rendersFailed = r.failed;
    summary.errors.push(...r.errors);
    await reapOrphanRenderingPosts();
  } catch (e) {
    note("renders", e);
  }

  // 1. Due scheduled posts. Posts awaiting approval (or rejected) are skipped — they stay scheduled.
  try {
    const due = await db
      .select({ id: schema.socialPosts.id })
      .from(schema.socialPosts)
      .where(
        and(
          eq(schema.socialPosts.status, "scheduled"),
          lte(schema.socialPosts.scheduledAt, now),
          notInArray(schema.socialPosts.approvalStatus, ["pending", "rejected"]),
          // Imported from Social Publishing and not yet cut over (P4): SP still owns it.
          isNull(schema.socialPosts.migrationHold),
        ),
      )
      .limit(25);
    for (const p of due) {
      const r = await publishPost(p.id, { enqueue: opts.enqueue });
      if (r.ok) summary.scheduledPublished++;
    }
  } catch (e) {
    note("scheduled", e);
  }

  // 2. Auto Post rules.
  try {
    const rules = await db
      .select()
      .from(schema.socialAutoRules)
      .where(and(eq(schema.socialAutoRules.active, true), isNull(schema.socialAutoRules.migrationHold)));

    for (const rule of rules) {
      try {
        const tz = await ruleTimezone(rule);
        const days = rule.daysOfWeek
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n));

        // Newly created rule → set its first run, don't fire immediately.
        if (!rule.nextRunAt) {
          await db
            .update(schema.socialAutoRules)
            .set({ nextRunAt: computeNextRun(days, rule.timeOfDay, now, tz) })
            .where(eq(schema.socialAutoRules.id, rule.id));
          continue;
        }
        if (rule.nextRunAt > now) continue;

        // The claim: advance next_run_at BEFORE doing the work, conditionally on the value we read, so two overlapping
        // sweeps cannot both fire the same slot (SP learned this on its Shorts rules — a slot that outlasts the
        // one-minute sweep was built twice).
        const claimed = await db
          .update(schema.socialAutoRules)
          .set({ lastRunAt: now, nextRunAt: computeNextRun(days, rule.timeOfDay, now, tz) })
          .where(and(eq(schema.socialAutoRules.id, rule.id), eq(schema.socialAutoRules.nextRunAt, rule.nextRunAt)))
          .returning({ id: schema.socialAutoRules.id });
        if (claimed.length === 0) continue;
        summary.rulesAdvanced++;

        // Take the oldest queued post; in "generate" mode, write one when the queue is empty (a review-first rule
        // leaves a draft and publishes nothing).
        const next = await nextPostForRule(rule, now);
        if (next) {
          // A generated post already carries its per-destination copy and targets; only a hand-queued post inherits
          // the rule's destination list.
          if (!next.generated) {
            await db
              .update(schema.socialPosts)
              .set({ providers: rule.providers, updatedAt: now })
              .where(eq(schema.socialPosts.id, next.postId));
          }
          const r = await publishPost(next.postId, { enqueue: opts.enqueue });
          if (r.ok) {
            summary.autoPosted++;
            if (next.generated) summary.autoGenerated++;
          }
        }
      } catch (e) {
        note(`rule ${rule.id}`, e);
      }
    }
  } catch (e) {
    note("rules", e);
  }

  // 2.6 Shorts rules (P5): at most one due rule starts a Short per sweep (SP scheduler step 2.6).
  try {
    const { sweepShortRules } = await import("@/lib/social/short-rules");
    const r = await sweepShortRules(now);
    summary.shortsStarted = r.started;
    summary.errors.push(...r.errors);
  } catch (e) {
    note("shorts", e);
  }

  // 3. Settle anything stranded, re-enqueue lost jobs, then the due retries.
  try {
    const r = await reapStuckPublishing(now, opts.enqueue);
    summary.targetsReaped = r.reaped;
    summary.targetsRequeued = r.requeued;
  } catch (e) {
    note("reap", e);
  }
  try {
    summary.targetsRetried = (await retryDueTargets(now, opts.enqueue)).retried;
  } catch (e) {
    note("retries", e);
  }

  return summary;
}

/** Posts of a workspace that are due but held for approval (for the approver's queue in P2/G9). */
export async function heldForApproval(workspaceId: string) {
  return db
    .select()
    .from(schema.socialPosts)
    .where(and(eq(schema.socialPosts.workspaceId, workspaceId), inArray(schema.socialPosts.approvalStatus, ["pending"])));
}
