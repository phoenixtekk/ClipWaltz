import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getWorkspaceRole, roleAtLeast, userCanAccessProject } from "@/lib/workspace";
import { headObject } from "@/lib/storage";
import { listDestinations } from "@/lib/social/destinations";
import { signedMediaUrl } from "@/lib/social/media";
import { parseTargetKeys } from "@/lib/social/publish-post";
import { appUrl } from "@/lib/social/app-url";
import { listReviews } from "@/lib/social/approval";
import {
  aspectFromResolution, providerName, providersForAspect,
  type ComposePrefill, type DestinationView, type MediaView, type PostView, type VideoAttachment,
} from "@/lib/social/ui-types";

// Read models for the /publish screens (P2). Server-only: every function takes the workspace the caller was already
// authorised for (requireSocial) and filters by it. Nothing here returns a credential.

type PostRow = typeof schema.socialPosts.$inferSelect;

export async function destinationsView(workspaceId: string): Promise<DestinationView[]> {
  const ds = await listDestinations(workspaceId);
  return ds.map((d) => ({ key: d.key, provider: d.provider, label: d.label, configured: d.configured, paused: Boolean(d.paused) }));
}

function mediaView(m: typeof schema.socialMedia.$inferSelect): MediaView {
  const kind = m.kind === "video" ? "video" : "image";
  let previewUrl: string | null = null;
  if (kind === "image") {
    try {
      previewUrl = signedMediaUrl(m.id);
    } catch {
      previewUrl = null;
    }
  }
  return { id: m.id, kind, filename: m.filename, mime: m.mime, size: m.size, previewUrl };
}

async function toViews(workspaceId: string, posts: PostRow[]): Promise<PostView[]> {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);
  const [targets, media, dests, reviews] = await Promise.all([
    db.select().from(schema.socialPostTargets).where(inArray(schema.socialPostTargets.postId, ids)),
    db.select().from(schema.socialMedia).where(and(eq(schema.socialMedia.workspaceId, workspaceId), inArray(schema.socialMedia.postId, ids))),
    listDestinations(workspaceId),
    listReviews(ids),
  ]);
  const label = new Map(dests.map((d) => [d.key, d.label]));
  return posts.map((p) => ({
    id: p.id,
    text: p.text,
    link: p.link,
    status: p.status,
    approvalStatus: p.approvalStatus,
    favorite: p.favorite,
    shareToken: p.shareToken,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    destinations: parseTargetKeys(p.providers).map((key) => {
      const provider = key.split("#")[0];
      return { key, provider, label: label.get(key) ?? providerName(provider) };
    }),
    perNetwork: (p.perNetwork as PostView["perNetwork"]) ?? null,
    media: media.filter((m) => m.postId === p.id).map(mediaView),
    targets: targets
      .filter((t) => t.postId === p.id)
      .map((t) => ({ id: t.id, provider: t.provider, label: t.label, status: t.status, url: t.url, error: t.error, metrics: t.metrics ?? null })),
    warnings: p.warnings ?? [],
    renderId: p.renderId,
    exportId: p.exportId,
    planAngle: p.planAngle,
    lastReview: (() => {
      const r = reviews.find((x) => x.postId === p.id); // newest first
      return r
        ? {
            decision: r.decision,
            note: r.note,
            by: r.viaToken ? `${r.reviewerName || "Guest reviewer"} (review link)` : (r.userName ?? "A member"),
            at: r.createdAt.toISOString(),
          }
        : null;
    })(),
  }));
}

export type PostFilter = "all" | "drafts" | "favorites" | "shared" | "published" | "scheduled" | "approval";

export async function listPostViews(workspaceId: string, filter: PostFilter = "all", limit = 200): Promise<PostView[]> {
  const ws = eq(schema.socialPosts.workspaceId, workspaceId);
  const where =
    filter === "drafts" ? and(ws, eq(schema.socialPosts.status, "draft"))
    : filter === "favorites" ? and(ws, eq(schema.socialPosts.favorite, true))
    : filter === "shared" ? and(ws, isNotNull(schema.socialPosts.shareToken))
    : filter === "published" ? and(ws, inArray(schema.socialPosts.status, ["published", "partial"]))
    : filter === "scheduled" ? and(ws, eq(schema.socialPosts.status, "scheduled"))
    : filter === "approval" ? and(ws, eq(schema.socialPosts.approvalStatus, "pending"))
    : ws;
  const rows = await db.select().from(schema.socialPosts).where(where).orderBy(desc(schema.socialPosts.createdAt)).limit(limit);
  return toViews(workspaceId, rows);
}

export async function getPostView(workspaceId: string, postId: string): Promise<PostView | null> {
  const [row] = await db
    .select()
    .from(schema.socialPosts)
    .where(and(eq(schema.socialPosts.id, postId), eq(schema.socialPosts.workspaceId, workspaceId)));
  return row ? (await toViews(workspaceId, [row]))[0] : null;
}

/** Posts that fall on the calendar between two instants: scheduled ones by their time, the rest by publish time. */
export async function calendarPosts(workspaceId: string, from: Date, to: Date): Promise<PostView[]> {
  const rows = await db
    .select()
    .from(schema.socialPosts)
    .where(
      and(
        eq(schema.socialPosts.workspaceId, workspaceId),
        or(
          and(gte(schema.socialPosts.scheduledAt, from), lte(schema.socialPosts.scheduledAt, to)),
          and(gte(schema.socialPosts.publishedAt, from), lte(schema.socialPosts.publishedAt, to)),
        ),
      ),
    )
    .limit(1000);
  return toViews(workspaceId, rows);
}

export interface PublishDashboard {
  counts: Record<"drafts" | "scheduled" | "published30" | "failed" | "approval" | "handoff", number>;
  upcoming: PostView[];
  recent: PostView[];
}

export async function publishDashboard(workspaceId: string): Promise<PublishDashboard> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const P = schema.socialPosts;
  const [c] = await db
    .select({
      drafts: sql<number>`count(*) filter (where ${P.status} = 'draft')`.mapWith(Number),
      scheduled: sql<number>`count(*) filter (where ${P.status} = 'scheduled')`.mapWith(Number),
      published30: sql<number>`count(*) filter (where ${P.status} in ('published', 'partial') and ${P.publishedAt} >= ${since.toISOString()}::timestamptz)`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${P.status} = 'failed')`.mapWith(Number),
      approval: sql<number>`count(*) filter (where ${P.approvalStatus} = 'pending')`.mapWith(Number),
      handoff: sql<number>`count(*) filter (where ${P.status} = 'handoff')`.mapWith(Number),
    })
    .from(P)
    .where(eq(P.workspaceId, workspaceId));
  const [up, recent] = await Promise.all([
    db.select().from(P).where(and(eq(P.workspaceId, workspaceId), eq(P.status, "scheduled"))).orderBy(P.scheduledAt).limit(5),
    db.select().from(P)
      .where(and(eq(P.workspaceId, workspaceId), inArray(P.status, ["published", "partial", "failed", "handoff"])))
      .orderBy(desc(P.updatedAt)).limit(5),
  ]);
  return {
    counts: c ?? { drafts: 0, scheduled: 0, published30: 0, failed: 0, approval: 0, handoff: 0 },
    upcoming: await toViews(workspaceId, up),
    recent: await toViews(workspaceId, recent),
  };
}

export interface AnalyticsRow {
  targetId: string;
  postId: string;
  text: string;
  provider: string;
  label: string | null;
  url: string | null;
  publishedAt: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  metricsAt: string | null;
}

/** Published destinations of the last 90 days with their cached engagement numbers (hourly metrics-pull). */
export async function analyticsRows(workspaceId: string): Promise<AnalyticsRow[]> {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const rows = await db
    .select({ t: schema.socialPostTargets, text: schema.socialPosts.text, publishedAt: schema.socialPosts.publishedAt })
    .from(schema.socialPostTargets)
    .innerJoin(schema.socialPosts, eq(schema.socialPostTargets.postId, schema.socialPosts.id))
    .where(
      and(
        eq(schema.socialPosts.workspaceId, workspaceId),
        eq(schema.socialPostTargets.status, "published"),
        gte(schema.socialPostTargets.createdAt, since),
      ),
    )
    .orderBy(desc(schema.socialPostTargets.createdAt))
    .limit(500);
  return rows.map(({ t, text, publishedAt }) => ({
    targetId: t.id,
    postId: t.postId,
    text,
    provider: t.provider,
    label: t.label,
    url: t.url,
    publishedAt: (publishedAt ?? t.updatedAt)?.toISOString() ?? null,
    likes: t.metrics?.likes ?? null,
    comments: t.metrics?.comments ?? null,
    shares: t.metrics?.shares ?? null,
    views: t.metrics?.views ?? null,
    metricsAt: t.metricsAt?.toISOString() ?? null,
  }));
}

/** Networks whose comments ClipWaltz can read and reply to (src/lib/social/jobs.ts COMMENT_PROVIDERS). */
export const COMMENT_NETWORKS = ["facebook", "instagram", "threads", "bluesky"];

export interface InboxTarget {
  targetId: string;
  postId: string;
  provider: string;
  label: string | null;
  text: string;
  url: string | null;
  commentsAt: string | null;
  comments: { id: string; author: string; text: string; createdAt: string | null }[];
}

export async function commentsInbox(workspaceId: string): Promise<InboxTarget[]> {
  const since = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  const rows = await db
    .select({ t: schema.socialPostTargets, text: schema.socialPosts.text })
    .from(schema.socialPostTargets)
    .innerJoin(schema.socialPosts, eq(schema.socialPostTargets.postId, schema.socialPosts.id))
    .where(
      and(
        eq(schema.socialPosts.workspaceId, workspaceId),
        eq(schema.socialPostTargets.status, "published"),
        inArray(schema.socialPostTargets.provider, COMMENT_NETWORKS),
        isNotNull(schema.socialPostTargets.externalId),
        gte(schema.socialPostTargets.createdAt, since),
      ),
    )
    .orderBy(desc(schema.socialPostTargets.createdAt))
    .limit(100);
  return rows.map(({ t, text }) => ({
    targetId: t.id,
    postId: t.postId,
    provider: t.provider,
    label: t.label,
    text,
    url: t.url,
    commentsAt: t.commentsAt?.toISOString() ?? null,
    comments: (t.comments ?? []).map((c) => ({ id: c.id, author: c.author, text: c.text, createdAt: c.createdAt })),
  }));
}

export interface HandoffItem {
  targetId: string;
  postId: string;
  provider: string;
  label: string | null;
  status: string;
  url: string | null;
  text: string;
  link: string | null;
  /** Where the person posts it (a Facebook Group's address), when known. */
  destinationUrl: string | null;
  media: MediaView[];
  updatedAt: string;
}

/** Destinations with no API, waiting on a person ("Post by hand"), plus the recently completed ones. */
export async function handoffItems(workspaceId: string): Promise<{ waiting: HandoffItem[]; done: HandoffItem[] }> {
  const rows = await db
    .select({ t: schema.socialPostTargets, p: schema.socialPosts, ext: schema.socialConnections.externalId })
    .from(schema.socialPostTargets)
    .innerJoin(schema.socialPosts, eq(schema.socialPostTargets.postId, schema.socialPosts.id))
    .leftJoin(
      schema.socialConnections,
      and(eq(schema.socialConnections.id, schema.socialPostTargets.connectionId), eq(schema.socialConnections.workspaceId, workspaceId)),
    )
    .where(
      and(
        eq(schema.socialPosts.workspaceId, workspaceId),
        or(
          eq(schema.socialPostTargets.status, "handoff"),
          and(eq(schema.socialPostTargets.provider, "facebook_group"), eq(schema.socialPostTargets.status, "published")),
        ),
      ),
    )
    .orderBy(desc(schema.socialPostTargets.updatedAt))
    .limit(200);
  const postIds = [...new Set(rows.map((r) => r.p.id))];
  const media = postIds.length
    ? await db.select().from(schema.socialMedia).where(and(eq(schema.socialMedia.workspaceId, workspaceId), inArray(schema.socialMedia.postId, postIds)))
    : [];
  const items = rows.map(({ t, p, ext }) => {
    const per = ((p.perNetwork as PostView["perNetwork"]) ?? {}) as Record<string, { text?: string }>;
    const key = Object.keys(per).find((k) => k.endsWith(`#${t.connectionId}`));
    const groupUrl = t.provider === "facebook_group" && ext ? (/^https?:\/\//.test(ext) ? ext : `https://www.facebook.com/groups/${ext}`) : null;
    return {
      targetId: t.id,
      postId: p.id,
      provider: t.provider,
      label: t.label,
      status: t.status,
      url: t.url,
      text: (key && per[key]?.text) || p.text,
      link: p.link,
      destinationUrl: groupUrl,
      media: media.filter((m) => m.postId === p.id).map(mediaView),
      updatedAt: t.updatedAt.toISOString(),
    };
  });
  return { waiting: items.filter((i) => i.status === "handoff"), done: items.filter((i) => i.status !== "handoff").slice(0, 30) };
}

/** A shared review link's post (public /r/<token>). Only text, destinations and media previews — no workspace data. */
export async function postByShareToken(token: string): Promise<PostView | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [row] = await db.select().from(schema.socialPosts).where(eq(schema.socialPosts.shareToken, token));
  return row ? (await toViews(row.workspaceId, [row]))[0] : null;
}

// ─── Publish-button prefill (render / export / campaign variant → composer) ─────────────────────────────────────

function suggestedKeys(dests: DestinationView[], aspect: string | null): string[] {
  const want = providersForAspect(aspect);
  return dests.filter((d) => d.configured && want.includes(d.provider)).map((d) => d.key);
}

function aspectNote(aspect: string | null): string | null {
  if (aspect === "9:16" || aspect === "4:5") return "Vertical video: TikTok, Instagram Reels and YouTube Shorts are suggested.";
  if (aspect === "16:9") return "Wide video: YouTube, LinkedIn and X are suggested.";
  if (aspect === "1:1") return "Square video: Instagram, Facebook, LinkedIn and X are suggested.";
  return null;
}

const safeName = (s: string) => s.replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "clipwaltz";

/** Networks that take a still image of this shape (LinkedIn's adapter posts text only, so it is never suggested). */
function providersForImage(format: string | null): string[] {
  if (format === "2:3") return ["pinterest"];
  if (format === "9:16") return ["instagram", "facebook"];
  return ["instagram", "facebook", "x", "threads", "bluesky"];
}

const MEDIA_ID = /^[a-f0-9-]{36}$/i;

/**
 * Waltz Image "Publish" (plan G1/G2/G5): the design's composited outputs were just stored as unattached social media of
 * this workspace (src/lib/image-ad/image-actions.ts prepareDesignPost); attach them, in order, with the design's words
 * as the starting text. Only unattached images of THIS workspace are accepted, so a crafted URL can't borrow another
 * post's (or workspace's) media.
 */
export async function imagesPrefill(userId: string, workspaceId: string, mediaIdsCsv: string, designId: string | null): Promise<ComposePrefill | null> {
  const ids = [...new Set(mediaIdsCsv.split(",").map((s) => s.trim()).filter((s) => MEDIA_ID.test(s)))].slice(0, 10);
  if (!ids.length) return null;
  const rows = await db.select().from(schema.socialMedia)
    .where(and(eq(schema.socialMedia.workspaceId, workspaceId), inArray(schema.socialMedia.id, ids), sql`${schema.socialMedia.postId} is null`, eq(schema.socialMedia.kind, "image")));
  if (!rows.length) return null;
  const media = ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r).map(mediaView);

  let text = "";
  let format: string | null = null;
  if (designId && MEDIA_ID.test(designId)) {
    const [d] = await db.select().from(schema.imageDesigns).where(eq(schema.imageDesigns.id, designId));
    if (d && roleAtLeast(await getWorkspaceRole(userId, d.workspaceId), "viewer")) {
      format = d.format;
      const data = (d.data ?? {}) as Record<string, unknown>;
      const slides = Array.isArray(data.slides) ? (data.slides as { headline?: string; body?: string }[]) : null;
      const parts = slides
        ? [slides[0]?.headline, slides[0]?.body]
        : [data.headline, data.subhead, data.caption, [data.top, data.bottom].filter(Boolean).join(" ")];
      text = parts.map((p) => String(p ?? "").trim()).filter(Boolean).join("\n\n");
    }
  }
  const dests = await destinationsView(workspaceId);
  const want = providersForImage(format);
  const many = media.length > 1;
  return {
    text,
    link: null,
    video: null,
    media,
    suggested: dests.filter((d) => d.configured && want.includes(d.provider)).map((d) => d.key),
    note: many
      ? `${media.length} images attached in order. Instagram, Facebook and Threads post them as one multi-image post; LinkedIn posts text only for now.`
      : "Image attached. LinkedIn posts text only for now, so it is not suggested.",
  };
}

/** The finished render the user may publish, as a composer prefill, or null (not found / no access / not done). */
export async function renderPrefill(userId: string, workspaceId: string, renderId: string): Promise<ComposePrefill | null> {
  const [r] = await db
    .select({
      id: schema.renders.id,
      projectId: schema.renders.projectId,
      status: schema.renders.status,
      outputKey: schema.renders.outputKey,
      aspect: schema.renders.aspect,
      version: schema.renders.version,
      description: schema.renders.description,
      campaignId: schema.renders.campaignId,
      variant: schema.renders.variant,
      title: schema.projects.title,
    })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .where(eq(schema.renders.id, renderId));
  if (!r || r.status !== "done" || !r.outputKey || !(await userCanAccessProject(userId, r.projectId))) return null;
  const size = await headObject(r.outputKey).then((h) => h.size, () => 0);

  // A campaign variant whose pack is shared links to its tracked landing page, so clicks from the post count for
  // the variant in the campaign stats.
  let link: string | null = null;
  let variantText = "";
  if (r.campaignId) {
    const [c] = await db.select({ shared: schema.deckCampaigns.shared }).from(schema.deckCampaigns).where(eq(schema.deckCampaigns.id, r.campaignId));
    if (c?.shared) link = `${appUrl()}/c/${r.id}`;
    const v = (r.variant ?? {}) as { ctaText?: string };
    variantText = v.ctaText ?? "";
  }

  const dests = await destinationsView(workspaceId);
  const video: VideoAttachment = {
    source: "render",
    id: r.id,
    filename: `${safeName(r.title)}-v${r.version}.mp4`,
    mime: "video/mp4",
    size,
    aspect: r.aspect,
    projectTitle: r.title,
  };
  return {
    text: (r.description ?? "").trim() || variantText || r.title,
    link,
    video,
    suggested: suggestedKeys(dests, r.aspect),
    note: aspectNote(r.aspect),
  };
}

export async function exportPrefill(userId: string, workspaceId: string, exportId: string): Promise<ComposePrefill | null> {
  const [e] = await db
    .select({
      id: schema.exportJobs.id,
      projectId: schema.exportJobs.projectId,
      status: schema.exportJobs.status,
      outputKey: schema.exportJobs.outputKey,
      format: schema.exportJobs.outputFormat,
      aspectRatio: schema.exportJobs.aspectRatio,
      resolution: schema.exportJobs.resolution,
      title: schema.projects.title,
      description: schema.projects.description,
      prompt: schema.generationJobs.prompt,
    })
    .from(schema.exportJobs)
    .innerJoin(schema.projects, eq(schema.exportJobs.projectId, schema.projects.id))
    .leftJoin(schema.generationVersions, eq(schema.exportJobs.sourceVersionId, schema.generationVersions.id))
    .leftJoin(schema.generationJobs, eq(schema.generationVersions.generationJobId, schema.generationJobs.id))
    .where(eq(schema.exportJobs.id, exportId));
  if (!e || e.status !== "completed" || !e.outputKey || !(await userCanAccessProject(userId, e.projectId))) return null;
  const size = await headObject(e.outputKey).then((h) => h.size, () => 0);
  const aspect = e.aspectRatio || aspectFromResolution(e.resolution);
  const webm = e.format === "webm";
  const dests = await destinationsView(workspaceId);
  return {
    text: (e.description ?? "").trim() || (e.prompt ?? "").trim() || e.title,
    link: null,
    video: {
      source: "export",
      id: e.id,
      filename: `${safeName(e.title)}.${webm ? "webm" : "mp4"}`,
      mime: webm ? "video/webm" : "video/mp4",
      size,
      aspect,
      projectTitle: e.title,
    },
    suggested: suggestedKeys(dests, aspect),
    note: aspectNote(aspect),
  };
}
