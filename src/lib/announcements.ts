import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Tier } from "./tier";

export type Placement = "dashboard_banner" | "dashboard_card" | "community";
export type Audience = "all" | "free" | "paid";

export type Announcement = {
  id: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  placement: Placement;
  audience: Audience;
  accent: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
};

function rowToAnnouncement(r: typeof schema.announcements.$inferSelect): Announcement {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    imageUrl: r.imageUrl,
    ctaLabel: r.ctaLabel,
    ctaUrl: r.ctaUrl,
    placement: r.placement as Placement,
    audience: r.audience as Audience,
    accent: r.accent,
    active: r.active,
    startsAt: r.startsAt ? r.startsAt.toISOString() : null,
    endsAt: r.endsAt ? r.endsAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Live announcements for a placement, filtered to the viewer's tier and the current time window.
 * "paid" targets any non-free tier; "free" targets the free tier; "all" targets everyone.
 */
export async function listActiveAnnouncements(
  placement: Placement,
  tier: Tier,
): Promise<Announcement[]> {
  const now = new Date();
  const audiences =
    tier === "free" ? ["all", "free"] : ["all", "paid"];
  const rows = await db
    .select()
    .from(schema.announcements)
    .where(
      and(
        eq(schema.announcements.active, true),
        eq(schema.announcements.placement, placement),
        or(isNull(schema.announcements.startsAt), lte(schema.announcements.startsAt, now)),
        or(isNull(schema.announcements.endsAt), gt(schema.announcements.endsAt, now)),
      ),
    )
    .orderBy(desc(schema.announcements.createdAt));
  return rows
    .filter((r) => audiences.includes(r.audience))
    .map(rowToAnnouncement);
}

/** Admin: every announcement, newest first. */
export async function listAllAnnouncements(): Promise<Announcement[]> {
  const rows = await db
    .select()
    .from(schema.announcements)
    .orderBy(desc(schema.announcements.createdAt));
  return rows.map(rowToAnnouncement);
}
