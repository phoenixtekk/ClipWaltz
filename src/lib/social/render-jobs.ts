import { randomUUID } from "crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { spendCredits } from "@/lib/credits-ledger";
import { EXPLAINER_COST, SHORT_COST } from "@/lib/credits";
// Type-only: the pipeline itself (canvas, ffmpeg, ElevenLabs) runs on the AI box, never in this process.
import type { EpisodePayload } from "@/lib/explainer/pipeline";
import { acceptsVideo } from "@/lib/social/network-capabilities";
import { parseKey, resolveTarget } from "@/lib/social/destinations";
import { getConnectionById } from "@/lib/social/connections";
import { uploadAllowed, type UploadLimits } from "@/lib/social/publishing/providers/discourse";
import { deleteMedia } from "@/lib/social/media";
import type { ProviderId } from "@/lib/social/publishing/types";

// Explainer episodes and Shorts (P5, decision D6) — the linuxg1 half. Ported from SP's render-queue.ts (explainer
// branch), auto-post.ts enqueueExplainer and shorts/runner.ts.
//
//   create   a post in status 'rendering' + a `social_render_jobs` row + its credits charge (one transaction)
//   render   the render worker on the AI box (worker/social-render/job.mjs) runs the pipeline and stores the files
//   finalize this module, from the social worker's sweep: per-network copy + media onto the post, then release it to
//            publish ('scheduled' now) or hold it as a draft (review-first); settle the charge; advance a Shorts rule
//
// No `server-only`: the social worker (tsx) runs the sweep. Never imported by client components.

export type RenderKind = "explainer" | "short";
export const RENDER_COST: Record<RenderKind, number> = { explainer: EXPLAINER_COST, short: SHORT_COST };
const VERTICAL_NETWORKS = new Set(["tiktok", "instagram"]); // same as src/lib/explainer/assemble.ts

const ADMIN_EMAILS = () =>
  (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Is this a site-admin (Phoenixtekk) workspace — its owner's email in ADMIN_EMAILS? Only such workspaces may use SP's
 * Phoenixtekk-specific pieces: the Workplace-catalogue grounding and the owner's cloned narration voice. Same test as
 * src/lib/admin.ts isAdminEmail (read from env directly: admin.ts pulls in the session and can't load in the worker).
 */
export async function isAdminWorkspace(workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ email: schema.user.email })
    .from(schema.workspaces)
    .innerJoin(schema.user, eq(schema.user.id, schema.workspaces.ownerUserId))
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return Boolean(row?.email && ADMIN_EMAILS().includes(row.email.toLowerCase()));
}

/** SP's Shorts audience line, for the admin workspace's un-grounded rules only. */
const ADMIN_AUDIENCE = "The audience administers Microsoft Intune, Microsoft 365 and endpoint reporting.";

/** The destinations of a key list that still resolve (connected, not paused) in this workspace. */
export async function usableKeys(keys: string[], workspaceId: string, opts: { allowPodcast: boolean }): Promise<string[]> {
  const out: string[] = [];
  for (const k of keys) {
    const { provider } = parseKey(k);
    if (provider === "podcast" && !opts.allowPodcast) continue;
    const t = await resolveTarget(k, workspaceId).catch(() => null);
    if (t && !t.paused) out.push(k);
  }
  return out;
}

/**
 * Charge and create one render job (and its post). Throws NotEnoughCredits (user-facing message) when the creator is
 * out of credits — callers on the sweep treat that as "no slot this time".
 */
async function createJob(input: {
  workspaceId: string;
  userId: string;
  kind: RenderKind;
  ruleId: string | null;
  post: { text: string; providers: string[]; link: string | null; autoPostRuleId?: string | null; shortRuleId?: string | null };
  payload: Record<string, unknown>;
}): Promise<{ postId: string; jobId: string }> {
  const postId = randomUUID();
  const jobId = randomUUID();
  const chargeId = randomUUID();
  const cost = RENDER_COST[input.kind];
  await spendCredits(
    input.userId,
    cost,
    async (tx) => {
      await tx.insert(schema.generationJobs).values({
        id: chargeId,
        projectId: null,
        workspaceId: input.workspaceId,
        requestedBy: input.userId,
        jobType: `social_${input.kind}`,
        status: "generating",
        credits: cost,
        prompt: input.post.text.slice(0, 500),
        requestJson: { socialRenderJobId: jobId, socialPostId: postId },
      });
      await tx.insert(schema.socialPosts).values({
        id: postId,
        workspaceId: input.workspaceId,
        createdBy: input.userId,
        // Replaced when the job finishes. Shown in the post list while it renders.
        text: input.post.text,
        providers: input.post.providers.join(","),
        link: input.post.link,
        status: "rendering",
        autoPostRuleId: input.post.autoPostRuleId ?? null,
        shortRuleId: input.post.shortRuleId ?? null,
      });
      await tx.insert(schema.socialRenderJobs).values({
        id: jobId,
        workspaceId: input.workspaceId,
        createdBy: input.userId,
        postId,
        kind: input.kind,
        ruleId: input.ruleId,
        status: "queued",
        stage: input.kind === "explainer" ? "scripting" : "building",
        payload: input.payload,
        chargeId,
      });
    },
    input.kind === "explainer" ? "An explainer episode costs " + cost + " credits." : "A Short costs " + cost + " credits.",
  );
  return { postId, jobId };
}

/** Start one explainer episode (an Auto Post slot in explainer mode, or "Make an explainer" by hand). */
export async function startExplainer(input: {
  workspaceId: string;
  userId: string;
  keys: string[];
  topic: string;
  seedPrompt: string;
  link?: string | null;
  reviewFirst: boolean;
  autoRuleId?: string | null;
}): Promise<{ postId: string; jobId: string }> {
  const topic = input.topic.trim().slice(0, 300);
  const seedPrompt = input.seedPrompt.trim().slice(0, 8000);
  if (!topic) throw new Error("An explainer needs a topic.");
  if (!seedPrompt) throw new Error("An explainer needs a brief (voice, audience, structure).");
  const admin = await isAdminWorkspace(input.workspaceId);
  const payload: EpisodePayload = {
    stage: "scripting",
    seedPrompt,
    topic,
    providers: [...new Set(input.keys.map((k) => parseKey(k).provider))] as ProviderId[],
    reviewFirst: input.reviewFirst,
    voice: admin ? "owner" : "stock",
    ...(input.link ? { link: input.link } : {}),
  };
  return createJob({
    workspaceId: input.workspaceId,
    userId: input.userId,
    kind: "explainer",
    ruleId: input.autoRuleId ?? null,
    post: { text: topic, providers: input.keys, link: input.link ?? null, autoPostRuleId: input.autoRuleId ?? null },
    payload: payload as unknown as Record<string, unknown>,
  });
}

/** Start one Short (a due Shorts rule, or "Make a Short now"). Workplace grounding is admin-workspace only. */
export async function startShort(input: {
  workspaceId: string;
  userId: string;
  keys: string[];
  source: "workplace" | "seed";
  solutionFilter?: string;
  solutionCursor?: number;
  seedPrompt?: string;
  topic?: string;
  reviewFirst: boolean;
  shortRuleId?: string | null;
}): Promise<{ postId: string; jobId: string }> {
  const admin = await isAdminWorkspace(input.workspaceId);
  if (input.source === "workplace" && !admin) throw new Error("Workplace-catalogue Shorts are only available to the Phoenixtekk admin workspace.");
  const topic = (input.topic ?? "").trim().slice(0, 300);
  if (input.source === "seed" && !topic) throw new Error("A Short needs a topic to write about.");
  return createJob({
    workspaceId: input.workspaceId,
    userId: input.userId,
    kind: "short",
    ruleId: input.shortRuleId ?? null,
    post: { text: topic || "Short (Workplace catalogue)", providers: input.keys, link: null, shortRuleId: input.shortRuleId ?? null },
    payload: {
      source: input.source,
      solutionFilter: input.solutionFilter ?? "",
      solutionCursor: input.solutionCursor ?? 0,
      seedPrompt: (input.seedPrompt ?? "").slice(0, 8000),
      topic,
      reviewFirst: input.reviewFirst,
      voice: admin ? "owner" : "stock",
      ...(admin ? { audience: ADMIN_AUDIENCE } : {}),
    },
  });
}

// ─── Finalize (social worker sweep) ──────────────────────────────────────────────────────────────────────────────

type Overrides = Record<string, { text?: string; mediaIds?: string[]; link?: string; meta?: Record<string, unknown> }>;

async function discourseLimits(connId: string, workspaceId: string): Promise<UploadLimits | undefined> {
  const c = await getConnectionById(connId, workspaceId).catch(() => null);
  if (!c || c.provider !== "discourse" || !c.accessToken) return undefined;
  try {
    return (JSON.parse(c.accessToken) as { uploads?: UploadLimits }).uploads;
  } catch {
    return undefined; // not JSON — unknown, which means "try it"
  }
}

/**
 * One file per destination (SP pickEpisodeMedia): the best video it will take, the episode audio for a podcast, or the
 * thumbnail when it takes no video. YouTube gets the master; vertical-first networks the 9:16 cut; everyone else the
 * compact cut when one exists. A Discourse forum is checked against its own upload settings.
 */
async function pickMedia(
  keys: string[],
  workspaceId: string,
  m: { video?: string; compact?: string; vertical?: string; audio?: string; thumb?: string },
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const ids = [m.video, m.compact, m.vertical].filter((x): x is string => Boolean(x));
  const rows = ids.length
    ? await db.select({ id: schema.socialMedia.id, filename: schema.socialMedia.filename, size: schema.socialMedia.size })
        .from(schema.socialMedia).where(and(inArray(schema.socialMedia.id, ids), eq(schema.socialMedia.workspaceId, workspaceId)))
    : [];
  const fileById = new Map(rows.map((r) => [r.id, r]));

  for (const key of keys) {
    const { provider, connId } = parseKey(key);
    if (provider === "podcast") {
      if (m.audio) out.set(key, [m.audio]);
      continue;
    }
    if (!acceptsVideo(provider)) {
      if (m.thumb) out.set(key, [m.thumb]);
      continue;
    }
    const limits = provider === "discourse" ? await discourseLimits(connId, workspaceId) : undefined;
    const order =
      provider === "youtube"
        ? [m.video, m.compact]
        : VERTICAL_NETWORKS.has(provider)
          ? [m.vertical, m.compact, m.video]
          : [m.compact, m.video];
    const chosen = order.filter((x): x is string => Boolean(x)).find((id) => {
      const f = fileById.get(id);
      return f ? uploadAllowed(limits, f.filename, f.size ?? 0) : false;
    });
    if (chosen) out.set(key, [chosen]);
    else if (m.thumb) out.set(key, [m.thumb]);
  }
  return out;
}

async function settleCharge(chargeId: string | null, ok: boolean, error?: string | null) {
  if (!chargeId) return;
  await db
    .update(schema.generationJobs)
    .set(
      ok
        ? { status: "completed", progress: 100, completedAt: new Date(), updatedAt: new Date() }
        : { status: "failed", failedAt: new Date(), errorMessage: (error ?? "render failed").slice(0, 500), updatedAt: new Date() },
    )
    .where(and(eq(schema.generationJobs.id, chargeId), eq(schema.generationJobs.status, "generating")));
}

/** Release a finished post: hold it as a draft (review-first) or schedule it for now so this sweep publishes it. */
function releaseSet(reviewFirst: boolean) {
  return reviewFirst
    ? { status: "draft" as const, scheduledAt: null }
    : { status: "scheduled" as const, scheduledAt: new Date() };
}

async function finalizeExplainer(job: typeof schema.socialRenderJobs.$inferSelect, post: typeof schema.socialPosts.$inferSelect) {
  const p = job.payload as unknown as EpisodePayload;
  const keys = post.providers.split(",").map((s) => s.trim()).filter(Boolean);
  const media = await pickMedia(keys, job.workspaceId, {
    video: p.videoMediaId, compact: p.compactMediaId, vertical: p.verticalMediaId, audio: p.audioMediaId, thumb: p.thumbnailMediaId,
  });
  const perNetwork: Overrides = {};
  for (const key of keys) {
    const provider = parseKey(key).provider;
    const text = p.perNetworkText?.[provider];
    const meta =
      provider === "youtube" && p.youtube
        ? { ...p.youtube, ...(p.thumbnailMediaId ? { thumbnailMediaId: p.thumbnailMediaId } : {}) }
        : provider === "podcast"
          ? { title: p.youtube?.title ?? p.script?.title, durationSec: Math.round(p.durationSec ?? 0), ...(p.thumbnailMediaId ? { imageMediaId: p.thumbnailMediaId } : {}) }
          : undefined;
    const mediaIds = media.get(key);
    if (text === undefined && meta === undefined && !mediaIds) continue;
    perNetwork[key] = { ...(text !== undefined ? { text } : {}), ...(meta ? { meta } : {}), ...(mediaIds ? { mediaIds } : {}) };
  }
  await db
    .update(schema.socialPosts)
    .set({
      perNetwork: perNetwork as never,
      ...(p.youtube?.title ? { text: p.youtube.title } : {}),
      warnings: p.warnings?.length ? p.warnings : null,
      ...releaseSet(Boolean(p.reviewFirst)),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.socialPosts.id, post.id), eq(schema.socialPosts.status, "rendering")));

  // Narration parts only existed so a crash could resume without re-spending ElevenLabs characters.
  for (const id of p.narrationMediaIds ?? []) {
    // Object first: deleteMedia finds the storage key through the row.
    await deleteMedia(id).catch(() => {});
    await db.delete(schema.socialMedia).where(and(eq(schema.socialMedia.id, id), eq(schema.socialMedia.workspaceId, job.workspaceId)));
  }
}

interface ShortResult {
  title: string;
  caption: string;
  tags: string[];
  durationSec: number;
  sourceUrl: string | null;
  nextCursor: number | null;
  warnings: string[];
  videoMediaId: string;
  thumbnailMediaId: string;
}

async function finalizeShort(job: typeof schema.socialRenderJobs.$inferSelect, post: typeof schema.socialPosts.$inferSelect) {
  const p = job.payload as { result?: ShortResult; reviewFirst?: boolean; source?: string };
  const r = p.result;
  if (!r) throw new Error("short job finished without a result");
  const keys = post.providers.split(",").map((s) => s.trim()).filter(Boolean);
  const media = await pickMedia(keys, job.workspaceId, { video: r.videoMediaId, vertical: r.videoMediaId, thumb: r.thumbnailMediaId });
  const perNetwork: Overrides = {};
  for (const key of keys) {
    const mediaIds = media.get(key);
    // YouTube wants the real title and description rather than the caption every other network gets.
    if (parseKey(key).provider === "youtube") {
      perNetwork[key] = {
        text: r.title,
        meta: {
          title: r.title,
          description: [r.caption, r.sourceUrl].filter(Boolean).join("\n\n"),
          tags: r.tags,
          thumbnailMediaId: r.thumbnailMediaId,
        },
        ...(mediaIds ? { mediaIds } : {}),
      };
    } else if (mediaIds) {
      perNetwork[key] = { mediaIds };
    }
  }
  await db
    .update(schema.socialPosts)
    .set({
      text: r.caption,
      // The solution page is the point of grounding: every grounded short sends the viewer somewhere real.
      link: r.sourceUrl ?? post.link,
      perNetwork: perNetwork as never,
      warnings: r.warnings?.length ? r.warnings : null,
      ...releaseSet(Boolean(p.reviewFirst)),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.socialPosts.id, post.id), eq(schema.socialPosts.status, "rendering")));

  // Advance the rule's rotation only because a short was genuinely produced (SP runner).
  if (job.ruleId) {
    const [rule] = await db.select().from(schema.shortRules).where(eq(schema.shortRules.id, job.ruleId)).limit(1);
    if (rule) {
      await db
        .update(schema.shortRules)
        .set({
          ...(r.nextCursor !== null && r.nextCursor !== undefined ? { solutionCursor: r.nextCursor } : {}),
          ...(rule.source === "seed" ? { topicCursor: rule.topicCursor + 1 } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.shortRules.id, rule.id));
    }
  }
}

/**
 * Finalize every settled job not yet finalized. Called first in each sweep so a released post publishes in the same
 * sweep. Each job is claimed (finalized_at set conditionally) before any work, so overlapping sweeps can't both apply
 * it. Never throws.
 */
export async function finalizeRenderJobs(): Promise<{ finalized: number; failed: number; errors: string[] }> {
  const out = { finalized: 0, failed: 0, errors: [] as string[] };
  const jobs = await db
    .select()
    .from(schema.socialRenderJobs)
    .where(and(inArray(schema.socialRenderJobs.status, ["done", "failed"]), isNull(schema.socialRenderJobs.finalizedAt)))
    .orderBy(schema.socialRenderJobs.updatedAt)
    .limit(20);
  for (const j of jobs) {
    const claimed = await db
      .update(schema.socialRenderJobs)
      .set({ finalizedAt: new Date() })
      .where(and(eq(schema.socialRenderJobs.id, j.id), isNull(schema.socialRenderJobs.finalizedAt)))
      .returning({ id: schema.socialRenderJobs.id });
    if (!claimed.length) continue;
    try {
      const [post] = j.postId ? await db.select().from(schema.socialPosts).where(eq(schema.socialPosts.id, j.postId)).limit(1) : [];
      if (j.status === "failed") {
        if (post && post.status === "rendering") {
          const what = j.kind === "explainer" ? "The explainer episode" : "The Short";
          await db
            .update(schema.socialPosts)
            .set({
              status: "failed",
              warnings: [`${what} could not be made: ${(j.error ?? "the render failed").slice(0, 300).replace(/\.+$/, "")}. The credits were refunded.`],
              updatedAt: new Date(),
            })
            .where(eq(schema.socialPosts.id, post.id));
        }
        await settleCharge(j.chargeId, false, j.error);
        out.failed++;
        continue;
      }
      if (post && post.status === "rendering") {
        if (j.kind === "explainer") await finalizeExplainer(j, post);
        else await finalizeShort(j, post);
      }
      await settleCharge(j.chargeId, true);
      out.finalized++;
    } catch (e) {
      // Leave it claimed but report it; the charge stays 'generating' until an operator looks (ADMIN_DOCS runbook).
      out.errors.push(`render job ${j.id}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** A post whose job was deleted / never created would sit in 'rendering' forever — fail it after 6 h. */
export async function reapOrphanRenderingPosts(): Promise<number> {
  const rows = await db.execute(sql`
    update social_posts p set status = 'failed', updated_at = now(),
      warnings = '["The video job for this post was lost — make it again."]'::jsonb
    where p.status = 'rendering' and p.updated_at < now() - interval '6 hours'
      and p.auto_image = false
      and not exists (select 1 from social_render_jobs j where j.post_id = p.id and (j.status in ('queued','running') or j.finalized_at is null))
      and not exists (select 1 from generation_jobs g where g.request_json->>'socialPostId' = p.id and g.status in ('queued','preparing','generating','uploading_output'))
    returning p.id`);
  return (rows as unknown as unknown[]).length;
}

export interface RenderJobView {
  id: string;
  kind: RenderKind;
  status: string;
  stage: string | null;
  progress: number;
  error: string | null;
  postId: string | null;
  postStatus: string | null;
  title: string;
  ruleId: string | null;
  createdAt: string;
}

/** Recent explainer / Short jobs of a workspace (the Explainers and Shorts pages poll this). */
export async function listRenderJobs(workspaceId: string, kind: RenderKind, limit = 20): Promise<RenderJobView[]> {
  const rows = await db
    .select({
      j: schema.socialRenderJobs,
      postStatus: schema.socialPosts.status,
      postText: schema.socialPosts.text,
    })
    .from(schema.socialRenderJobs)
    .leftJoin(schema.socialPosts, eq(schema.socialPosts.id, schema.socialRenderJobs.postId))
    .where(and(eq(schema.socialRenderJobs.workspaceId, workspaceId), eq(schema.socialRenderJobs.kind, kind)))
    .orderBy(desc(schema.socialRenderJobs.createdAt))
    .limit(limit);
  return rows.map(({ j, postStatus, postText }) => {
    const payload = j.payload as { topic?: string; result?: { title?: string } };
    return {
      id: j.id,
      kind: j.kind as RenderKind,
      status: j.status,
      stage: j.stage,
      progress: j.progress,
      error: j.error,
      postId: j.postId,
      postStatus: postStatus ?? null,
      title: (postText || payload.result?.title || payload.topic || (kind === "short" ? "Short" : "Explainer")).slice(0, 140),
      ruleId: j.ruleId,
      createdAt: j.createdAt.toISOString(),
    };
  });
}
