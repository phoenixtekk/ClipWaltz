"use server";
import { randomUUID } from "crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { getUserWorkspaceIds, userCanAccessProject, visibleProjectsFilter } from "./workspace";
import { enqueueEnhance } from "./queue";
import { shouldWatermark } from "./watermark";
import { spendCredits } from "./credits-server";
import { toResult, type ActionResult } from "./action-result";
import { remixCost } from "./credits";
import { burnedInLogo } from "./burned-logo";
import { resolveGenerationRoute, RouteUnavailableError, QUALITIES, type Quality } from "./ai/routing";

// Waltz AI Remix: take any finished video (an AutoWaltz render or a Waltz AI clip, from any project
// you can open) and weave AI into it — an AI lead-in that flows into its first frame, AI "moments"
// where a frame comes alive in place (same length, cuts stay on the beat), and an AI extension past
// its last frame with the song carried on. Runs as a `remix` job on the enhance queue
// (worker: processRemix in worker/generation-worker.mjs) and lands as a new version here.

export type RemixSource = {
  kind: "render" | "version";
  id: string;
  projectId: string;
  projectTitle: string;
  label: string; // "Render v3" / "Waltz AI v5 · Image → video"
  durationSec: number | null;
  aspect: string | null; // "16:9" | "9:16" | "1:1" (renders); versions derive from width/height
  watchUrl: string;
  createdAt: string;
};

const aspectOf = (w?: unknown, h?: unknown) => {
  const W = Number(w), H = Number(h);
  if (!W || !H) return null;
  return Math.abs(W / H - 1) < 0.1 ? "1:1" : W > H ? "16:9" : "9:16";
};

/** Every remixable video across the projects this user can open, newest first. */
export async function listRemixSources(): Promise<RemixSource[]> {
  const userId = await requireUserId();
  const ws = await getUserWorkspaceIds(userId);
  const projects = await db.select({ id: schema.projects.id, title: schema.projects.title })
    .from(schema.projects).where(visibleProjectsFilter(userId, ws));
  if (!projects.length) return [];
  const title = new Map(projects.map((p) => [p.id, p.title]));
  const ids = projects.map((p) => p.id);
  const [renders, versions] = await Promise.all([
    db.select({
      id: schema.renders.id, projectId: schema.renders.projectId, version: schema.renders.version,
      aspect: schema.renders.aspect, createdAt: schema.renders.createdAt, settings: schema.renders.settings,
    }).from(schema.renders)
      .where(and(inArray(schema.renders.projectId, ids), eq(schema.renders.status, "done"), isNotNull(schema.renders.outputKey)))
      .orderBy(desc(schema.renders.createdAt)).limit(120),
    db.select({
      id: schema.generationVersions.id, projectId: schema.generationVersions.projectId,
      versionNumber: schema.generationVersions.versionNumber, durationSec: schema.generationVersions.durationSec,
      settings: schema.generationVersions.settings, createdAt: schema.generationVersions.createdAt,
      jobType: schema.generationJobs.jobType,
    }).from(schema.generationVersions)
      .leftJoin(schema.generationJobs, eq(schema.generationVersions.generationJobId, schema.generationJobs.id))
      .where(and(inArray(schema.generationVersions.projectId, ids), isNotNull(schema.generationVersions.outputKey)))
      .orderBy(desc(schema.generationVersions.createdAt)).limit(120),
  ]);
  const out: RemixSource[] = [
    ...renders.map((r) => {
      return {
        kind: "render" as const, id: r.id, projectId: r.projectId, projectTitle: title.get(r.projectId) ?? "Project",
        label: `AutoWaltz render v${r.version}`,
        // Not settings.lengthSec: "max footage" renders ignore it (a "30 s" render was 197 s). The
        // player reads the real length.
        durationSec: null,
        aspect: r.aspect, watchUrl: `/api/renders/${r.id}/watch`, createdAt: r.createdAt.toISOString(),
      };
    }),
    ...versions.map((v) => {
      const st = (v.settings ?? {}) as Record<string, unknown>;
      const kind = v.jobType === "remix" ? "Remix" : v.jobType === "montage" ? "Storyboard" : v.jobType === "enhancement" ? "Enhanced" : "AI clip";
      return {
        kind: "version" as const, id: v.id, projectId: v.projectId, projectTitle: title.get(v.projectId) ?? "Project",
        label: `Waltz AI v${v.versionNumber} · ${kind}`, durationSec: v.durationSec,
        aspect: aspectOf(st.width, st.height), watchUrl: `/api/generations/${v.id}/watch`, createdAt: v.createdAt.toISOString(),
      };
    }),
  ];
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 150);
}

export type RemixRecipe = {
  leadIn?: { seconds: number; prompt: string } | null;
  moments?: { at: number; seconds: number; prompt: string }[];
  extend?: { seconds: number; prompt: string } | null;
  style?: string | null; // style phrase key (cinematic, dreamlike, …)
  quality?: Quality;
};

const STYLE_PHRASE: Record<string, string> = {
  cinematic: "cinematic style", commercial: "polished commercial style", documentary: "documentary style",
  social: "vibrant social-media style", action: "high-energy action style", dreamlike: "dreamlike, surreal style",
};
const SECS = new Set([3, 5, 8]);
const clean = (s: unknown) => (typeof s === "string" ? s.trim().slice(0, 600) : "");

/**
 * Queue a remix of `source` into `projectId` (editor access). Validates the recipe against the
 * source length and the routed model's clip-length range. Returns the job id.
 */
export async function createRemix(
  projectId: string,
  source: { kind: "render" | "version"; id: string },
  recipe: RemixRecipe,
): Promise<ActionResult<string>> {
  // Errors are returned, not thrown (src/lib/action-result.ts) — "not enough AI credits" must reach the user.
  return toResult(() => createRemixImpl(projectId, source, recipe));
}

async function createRemixImpl(
  projectId: string,
  source: { kind: "render" | "version"; id: string },
  recipe: RemixRecipe,
): Promise<string> {
  const userId = await requireUserId();
  if (!(await userCanAccessProject(userId, projectId, "editor"))) throw new Error("Project not found");

  // Resolve the source (any project the user can open) to a storage key + facts the worker needs.
  let src: { kind: string; id: string; projectId: string; key: string; watermarked: boolean; musicKey: string | null; label: string };
  if (source.kind === "render") {
    const [r] = await db.select({
      id: schema.renders.id, projectId: schema.renders.projectId, key: schema.renders.outputKey, version: schema.renders.version,
      watermark: schema.renders.watermark, status: schema.renders.status, settings: schema.renders.settings,
    }).from(schema.renders).where(eq(schema.renders.id, source.id));
    if (!r || !r.key || r.status !== "done" || !(await userCanAccessProject(userId, r.projectId))) throw new Error("Video not found");
    const trackId = ((r.settings ?? {}) as Record<string, unknown>).musicTrackId;
    let musicKey: string | null = null;
    if (typeof trackId === "string") {
      const [t] = await db.select({ key: schema.musicTracks.storageKey }).from(schema.musicTracks).where(eq(schema.musicTracks.id, trackId));
      musicKey = t?.key ?? null;
    }
    src = { kind: "render", id: r.id, projectId: r.projectId, key: r.key, watermarked: r.watermark, musicKey, label: `AutoWaltz render v${r.version}` };
  } else {
    const [v] = await db.select({
      id: schema.generationVersions.id, projectId: schema.generationVersions.projectId, versionNumber: schema.generationVersions.versionNumber,
      key: schema.generationVersions.outputKey, cleanKey: schema.generationVersions.cleanKey,
    }).from(schema.generationVersions).where(eq(schema.generationVersions.id, source.id));
    if (!v || !v.key || !(await userCanAccessProject(userId, v.projectId))) throw new Error("Video not found");
    // The clean master when there is one — the logo is added once, at the end. Except when the video
    // descends from a watermarked render: its "clean" master still has that render's logo burned in,
    // so take the branded copy (logo once on every frame) and treat it like a watermarked render.
    const burned = await burnedInLogo(v.id);
    src = { kind: "version", id: v.id, projectId: v.projectId, key: burned ? v.key : v.cleanKey ?? v.key, watermarked: burned, musicKey: null, label: `Waltz AI v${v.versionNumber}` };
  }

  const quality: Quality = QUALITIES.includes(recipe.quality as Quality) ? (recipe.quality as Quality) : "standard";
  let route;
  try {
    route = await resolveGenerationRoute("image_to_video", quality);
  } catch (e) {
    if (e instanceof RouteUnavailableError) throw new Error(e.message);
    throw e;
  }
  const fits = (s: number) => SECS.has(s) && (route.durationMax == null || s <= route.durationMax) && (route.durationMin == null || s >= route.durationMin);

  const leadIn = recipe.leadIn && fits(Number(recipe.leadIn.seconds)) ? { seconds: Number(recipe.leadIn.seconds), prompt: clean(recipe.leadIn.prompt) } : null;
  const extend = recipe.extend && fits(Number(recipe.extend.seconds)) ? { seconds: Number(recipe.extend.seconds), prompt: clean(recipe.extend.prompt) } : null;
  const moments = (recipe.moments ?? [])
    .map((m) => ({ at: Math.max(0, Math.round(Number(m.at) * 10) / 10), seconds: Number(m.seconds), prompt: clean(m.prompt) }))
    .filter((m) => Number.isFinite(m.at) && fits(m.seconds))
    .sort((a, b) => a.at - b.at);
  if (moments.length > 3) throw new Error("Up to 3 moments per remix");
  for (let i = 1; i < moments.length; i++) {
    if (moments[i].at < moments[i - 1].at + moments[i - 1].seconds) throw new Error("Moments overlap — space them out");
  }
  if (!leadIn && !extend && !moments.length) throw new Error("Pick at least one: lead-in, a moment or extend");
  const style = recipe.style && STYLE_PHRASE[recipe.style] ? recipe.style : null;

  const [proj] = await db.select({ workspaceId: schema.projects.workspaceId }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const id = randomUUID();
  const parts = [leadIn && "lead-in", moments.length && `${moments.length} moment${moments.length > 1 ? "s" : ""}`, extend && "extend"].filter(Boolean).join(" + ");
  // AI credits: only the seconds AI adds, at the remix's quality.
  const credits = remixCost((leadIn?.seconds ?? 0) + moments.reduce((n, m) => n + m.seconds, 0) + (extend?.seconds ?? 0), quality);
  const watermark = await shouldWatermark(userId);
  await spendCredits(userId, credits, (tx) => tx.insert(schema.generationJobs).values({
    id, credits, projectId, workspaceId: proj?.workspaceId ?? null, requestedBy: userId, jobType: "remix", status: "queued",
    routingProfile: route.ruleId, modelName: route.modelName, workflowName: route.workflow, workflowVersion: route.workflowVersion,
    prompt: `Remix of ${src.label}: ${parts}`,
    requestJson: {
      summary: parts, source: src, leadIn, moments, extend, style, stylePhrase: style ? STYLE_PHRASE[style] : null,
      quality, workflow: route.workflow, steps: route.steps, watermark,
    },
  }));
  try {
    await enqueueEnhance(id);
  } catch (e) {
    // Fail the charged job (failed jobs don't count against credits) and say nothing was spent.
    console.error(`[remix] enqueue ${id} failed:`, (e as Error).message);
    await db.update(schema.generationJobs).set({ status: "failed", errorMessage: "Couldn't reach the AI queue", failedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.generationJobs.id, id)).catch(() => {});
    throw new Error("Couldn't reach the AI queue — try again in a moment. No credits were used.");
  }
  revalidatePath(`/projects/${projectId}/edit`);
  return id;
}
