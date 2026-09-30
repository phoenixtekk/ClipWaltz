import "server-only";
import { createHash, randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAuthUserId } from "./auth";
import { userCanAccessProject } from "./workspace";
import { utmUrl } from "./campaign";
import type { CampaignConfig } from "./deck/types";

// Public side of WaltzDeck campaign packs (phase 4): the variant landing page /c/<renderId> and its audience events.

export type PublicVariant = {
  renderId: string; projectId: string; campaignId: string; title: string; aspect: string;
  code: string; ctaText: string; ctaHref: string | null; watermark: boolean;
  /** Who made the pack (else the project owner) — their plan decides whether the CTA goes through the interstitial. */
  ownerId: string;
};

/** A variant whose pack has share links on and whose video is finished — else null (the page 404s). */
export async function getPublicVariant(renderId: string): Promise<PublicVariant | null> {
  const [r] = await db.select({
    id: schema.renders.id, projectId: schema.renders.projectId, campaignId: schema.renders.campaignId, status: schema.renders.status,
    outputKey: schema.renders.outputKey, visibility: schema.renders.visibility, aspect: schema.renders.aspect,
    variant: schema.renders.variant, watermark: schema.renders.watermark,
  }).from(schema.renders).where(eq(schema.renders.id, renderId));
  if (!r?.campaignId || r.status !== "done" || !r.outputKey || r.visibility === "private") return null;
  const [c] = await db.select().from(schema.deckCampaigns)
    .where(and(eq(schema.deckCampaigns.id, r.campaignId), eq(schema.deckCampaigns.projectId, r.projectId)));
  if (!c?.shared) return null;
  const [p] = await db.select({ title: schema.projects.title, ownerId: schema.projects.ownerId }).from(schema.projects).where(eq(schema.projects.id, r.projectId));
  const v = (r.variant ?? {}) as { code?: string; ctaText?: string; lengthSec?: number };
  const cfg = c.config as CampaignConfig;
  return {
    renderId: r.id, projectId: r.projectId, campaignId: c.id, title: p?.title ?? "", aspect: r.aspect, code: v.code ?? "",
    ctaText: v.ctaText && v.ctaText !== "(no call to action)" ? v.ctaText : "",
    ctaHref: utmUrl(cfg.ctaUrl, c.name, { code: v.code ?? "v", lengthSec: Number(v.lengthSec) || 0, aspect: r.aspect }),
    watermark: r.watermark,
    ownerId: c.createdBy ?? p?.ownerId ?? "",
  };
}

// Link-preview fetchers and crawlers never count (they don't run the page's script, but the click redirect is a GET).
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|skype|curl|wget|python|headless/i;

/**
 * Record one audience event (view | play | complete | click) — at most once per visitor, variant, type and UTC day.
 * `visitor` is a salted SHA-256 of the page's random per-browser id (or IP + user agent when there is none): no raw
 * identifier is stored. The owner and anyone who can open the project are never counted.
 */
export async function recordVariantEvent(req: Request, v: PublicVariant, type: "view" | "play" | "complete" | "click", clientId?: string | null) {
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || BOT.test(ua)) return false;
  const userId = await getAuthUserId().catch(() => null);
  if (userId && (await userCanAccessProject(userId, v.projectId).catch(() => false))) return false;
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  // The network address is part of the identity, so minting fresh browser ids from one machine doesn't mint visitors
  // beyond the per-address cap below.
  const who = clientId && /^[A-Za-z0-9-]{8,64}$/.test(clientId) ? `c:${clientId}|${ip}` : `i:${ip}|${ua}`;
  const salt = process.env.BETTER_AUTH_SECRET ?? "clipwaltz";
  const hash = (x: string) => createHash("sha256").update(`variant-visitor:${salt}:${x}`).digest("hex").slice(0, 32);
  const visitor = hash(who);
  const net = hash(`net:${ip}`);
  const day = new Date().toISOString().slice(0, 10);
  // A click counts only for a visitor who viewed the page (a bare /go hit can't push the click rate past 100 %).
  if (type === "click") {
    const [seen] = await db.select({ id: schema.variantEvents.id }).from(schema.variantEvents)
      .where(and(eq(schema.variantEvents.renderId, v.renderId), eq(schema.variantEvents.type, "view"), eq(schema.variantEvents.visitor, visitor))).limit(1);
    if (!seen) return false;
  }
  // At most 20 visitors per network address, variant, type and day (an office or a household is a few people).
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.variantEvents)
    .where(and(eq(schema.variantEvents.renderId, v.renderId), eq(schema.variantEvents.type, type), eq(schema.variantEvents.day, day), eq(schema.variantEvents.net, net)));
  if (n >= 20) return false;
  await db.insert(schema.variantEvents).values({
    id: randomUUID(), renderId: v.renderId, campaignId: v.campaignId, type, visitor, net, day,
  }).onConflictDoNothing();
  return true;
}
