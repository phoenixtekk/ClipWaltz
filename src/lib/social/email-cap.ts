import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// Per-workspace cap on Email destination sends. Email goes out through ClipWaltz's own SES account, so one workspace
// sending in bulk risks the sender reputation (and the SES account) every other workspace depends on. Counted from the
// DATABASE — published email targets of this workspace in the last 24 hours — so a restart or a second worker cannot
// reset it. Default 200 sends / rolling 24 h; SOCIAL_EMAIL_DAILY_CAP overrides (0 disables Email sends entirely).

export const DEFAULT_EMAIL_DAILY_CAP = 200;

export function emailDailyCap(): number {
  const raw = process.env.SOCIAL_EMAIL_DAILY_CAP;
  if (raw === undefined || raw.trim() === "") return DEFAULT_EMAIL_DAILY_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_EMAIL_DAILY_CAP;
}

/** Email targets of this workspace that were sent (status published) in the last 24 hours. */
export async function emailSendsLast24h(workspaceId: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.socialPostTargets)
    .innerJoin(schema.socialPosts, eq(schema.socialPosts.id, schema.socialPostTargets.postId))
    .where(
      and(
        eq(schema.socialPosts.workspaceId, workspaceId),
        eq(schema.socialPostTargets.provider, "email"),
        eq(schema.socialPostTargets.status, "published"),
        gte(schema.socialPostTargets.updatedAt, since),
      ),
    );
  return r?.n ?? 0;
}

/** null when another send is allowed; otherwise the message recorded on the target. */
export async function emailCapExceeded(workspaceId: string): Promise<string | null> {
  const cap = emailDailyCap();
  const used = await emailSendsLast24h(workspaceId);
  if (used < cap) return null;
  return `Email not sent: this workspace has reached its cap of ${cap} email sends in 24 hours. Publish it again once the window has passed.`;
}
