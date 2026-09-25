import "server-only";
import { and, eq, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getEffectiveTier } from "./tier";
import { sendEmail, simpleEmail, emailConfigured } from "./email";
import { deleteObject } from "./storage";

// Free-plan retention (owner decision 2026-09-25): uploaded source files (and their 360 conversions)
// are deleted 7 days after upload. The owner is emailed ~24 h before, and nothing is deleted unless
// that notice went out ≥ 20 h earlier. Projects, AI results and finished videos are kept. Paid, comp
// and trialing accounts are never touched. Driven by POST /api/internal/retention.

const RETENTION_DAYS = 7;
const NOTICE_LEAD_HOURS = 24;
const MIN_NOTICE_HOURS = 20;
const NOTICE_VALID_HOURS = 72; // an older notice is stale (e.g. user upgraded then downgraded) → re-notice

// Only genuinely Free accounts. A paid subscription whose card is being retried (past_due / unpaid /
// incomplete) is NOT eligible even though getEffectiveTier treats it as free for features.
async function eligibleForRetention(ownerId: string): Promise<boolean> {
  if ((await getEffectiveTier(ownerId)) !== "free") return false;
  const [sub] = await db.select({ status: schema.subscriptions.status }).from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, ownerId)).orderBy(sql`${schema.subscriptions.updatedAt} desc`).limit(1);
  return !sub || sub.status === "canceled" || sub.status === "incomplete_expired";
}

export type RetentionReport = {
  dryRun: boolean;
  ownersChecked: number;
  freeOwners: number;
  noticesSent: number;
  noticeFailures: number;
  assetsNoticed: number;
  assetsDeleted: number;
  objectsDeleted: number;
  objectsKeptShared: number;
  mediaDeleted: number;
};

export async function runRetention(opts: { dryRun: boolean }): Promise<RetentionReport> {
  const r: RetentionReport = {
    dryRun: opts.dryRun, ownersChecked: 0, freeOwners: 0, noticesSent: 0, noticeFailures: 0,
    assetsNoticed: 0, assetsDeleted: 0, objectsDeleted: 0, objectsKeptShared: 0, mediaDeleted: 0,
  };
  const noticeCutoff = sql`now() - make_interval(hours => ${RETENTION_DAYS * 24 - NOTICE_LEAD_HOURS})`;
  const deleteCutoff = sql`now() - make_interval(days => ${RETENTION_DAYS})`;

  // Uploads entering the notice window, grouped by the project owner (whose plan applies).
  const rows = await db
    .select({
      id: schema.assets.id, key: schema.assets.storageKey, convertedKey: schema.assets.convertedKey,
      mediaId: schema.assets.mediaId, createdAt: schema.assets.createdAt, noticeAt: schema.assets.retentionNoticeAt,
      ownerId: schema.projects.ownerId, mediaOwnerId: schema.media.ownerId,
    })
    .from(schema.assets)
    .innerJoin(schema.projects, eq(schema.assets.projectId, schema.projects.id))
    .leftJoin(schema.media, eq(schema.assets.mediaId, schema.media.id))
    .where(and(eq(schema.assets.uploadState, "uploaded"), lt(schema.assets.createdAt, noticeCutoff)));
  // Only the project owner's own uploads: a collaborator's library file in someone else's project is
  // theirs (their plan, their media row) and is never deleted by the owner's retention.
  const own = rows.filter((a) => !a.mediaOwnerId || a.mediaOwnerId === a.ownerId);

  const byOwner = new Map<string, typeof rows>();
  for (const a of own) byOwner.set(a.ownerId, [...(byOwner.get(a.ownerId) ?? []), a]);
  r.ownersChecked = byOwner.size;

  for (const [ownerId, assets] of byOwner) {
    if (!(await eligibleForRetention(ownerId))) continue;
    r.freeOwners++;
    const now = Date.now();
    const noticeAge = (a: (typeof assets)[number]) => (a.noticeAt ? now - a.noticeAt.getTime() : Infinity);
    // Delete only with a FRESH notice (20–72 h old); a missing or stale notice is (re-)sent instead.
    const due = assets.filter((a) => noticeAge(a) >= MIN_NOTICE_HOURS * 3600_000 && noticeAge(a) <= NOTICE_VALID_HOURS * 3600_000
      && now - a.createdAt.getTime() >= RETENTION_DAYS * 86400_000);
    const toNotice = assets.filter((a) => noticeAge(a) > NOTICE_VALID_HOURS * 3600_000);

    // 1) Notice (one email per owner listing how many files go in ~24 h).
    if (toNotice.length) {
      r.assetsNoticed += toNotice.length;
      if (!opts.dryRun) {
        const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, ownerId));
        const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.clipwaltz.com";
        const n = toNotice.length;
        // Never count the console fallback as a notice: without SES nothing is emailed → nothing deleted.
        const ok = u?.email && emailConfigured() ? await sendEmail({
          to: u.email,
          subject: `${n} uploaded file${n === 1 ? "" : "s"} will be deleted in about 24 hours`,
          html: simpleEmail(
            "Your uploads are about to expire",
            `On the Free plan ClipWaltz keeps uploaded photos and videos for ${RETENTION_DAYS} days. ${n} of your uploaded file${n === 1 ? "" : "s"} will be deleted in about 24 hours. Your projects and finished videos stay. Upgrade to keep your uploads.`,
            { label: "Keep my uploads", url: `${base}/account/billing` },
          ),
          text: `${n} of your uploaded files will be deleted in about 24 hours (Free plan keeps uploads ${RETENTION_DAYS} days). Projects and finished videos stay. Upgrade: ${base}/account/billing`,
        }) : false;
        if (ok) {
          r.noticesSent++;
          await db.update(schema.assets).set({ retentionNoticeAt: new Date() }).where(inArray(schema.assets.id, toNotice.map((a) => a.id)));
        } else {
          r.noticeFailures++; // not recorded → nothing of this owner's is deleted until a notice succeeds
        }
      }
    }

    // 2) Delete what was noticed long enough ago.
    if (!due.length) continue;
    const dueIds = new Set(due.map((a) => a.id));
    const keys = [...new Set(due.flatMap((a) => [a.key, a.convertedKey]).filter((k): k is string => !!k))];
    for (const key of keys) {
      // Keep an object another (younger / other project) clip still uses — the media library shares files.
      const [shared] = await db.select({ id: schema.assets.id }).from(schema.assets)
        .where(and(or(eq(schema.assets.storageKey, key), eq(schema.assets.convertedKey, key)), notInArray(schema.assets.id, [...dueIds])))
        .limit(1);
      if (shared) { r.objectsKeptShared++; continue; }
      if (!opts.dryRun) await deleteObject(key).catch(() => {});
      r.objectsDeleted++;
    }
    if (!opts.dryRun) await db.delete(schema.assets).where(inArray(schema.assets.id, [...dueIds]));
    r.assetsDeleted += dueIds.size;

    // 3) Library media rows no clip uses any more (and past retention) go too.
    const mediaIds = [...new Set(due.map((a) => a.mediaId).filter((m): m is string => !!m))];
    for (const mid of mediaIds) {
      // (Counted against the not-yet-deleted rows so a dry run reports the same outcome.)
      const [still] = await db.select({ id: schema.assets.id }).from(schema.assets)
        .where(and(eq(schema.assets.mediaId, mid), notInArray(schema.assets.id, [...dueIds]))).limit(1);
      if (still) continue;
      const [m] = await db.select().from(schema.media).where(and(eq(schema.media.id, mid), lt(schema.media.createdAt, deleteCutoff)));
      if (!m) continue;
      if (!opts.dryRun) {
        for (const k of [m.convertedKey].filter((x): x is string => !!x && !keys.includes(x))) await deleteObject(k).catch(() => {});
        await db.delete(schema.media).where(eq(schema.media.id, mid));
      }
      r.mediaDeleted++;
    }
  }
  return r;
}
