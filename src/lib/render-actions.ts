"use server";
import { cleanTargets } from "./cloud/routing";
import { randomUUID } from "crypto";
import { and, asc, desc, eq, sql, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { userCanAccessProject } from "./workspace";
import { requireUserId } from "./auth";
import { deleteObject } from "./storage";
import { track } from "./analytics";
import type { RenderSettings, RenderCheckpoint, CheckWarning } from "./render";
import { toResult } from "./action-result";
import { isPresenterLayout, presenterCredits } from "./presenters";
import { estimateScriptSeconds } from "./talking-photo";
import { spendCredits } from "./credits-server";
import type { DeckBrief } from "./deck/types";
import { headObject } from "./storage";
import { clipCacheBase, narrationRequest } from "../../worker/deck/presenter.mjs";

/** Delete a saved render (the DB row + its MinIO object), editor-checked. */
async function deleteRenderImpl(renderId: string): Promise<void> {
  const userId = await requireUserId();
  const [row] = await db
    .select({ key: schema.renders.outputKey, projectId: schema.renders.projectId })
    .from(schema.renders)
    .where(eq(schema.renders.id, renderId));
  if (!row || !(await userCanAccessProject(userId, row.projectId, "editor"))) throw new Error("Render not found");
  await db.delete(schema.renders).where(eq(schema.renders.id, renderId));
  if (row.key) await deleteObject(row.key).catch(() => {});
  revalidatePath(`/projects/${row.projectId}/edit`);
}

// Snapshot the effective Format + Style settings from a project row.
function snapshotSettings(
  proj: typeof schema.projects.$inferSelect,
  clips: number,
): RenderSettings {
  return {
    aspect: proj.aspect,
    lengthSec: proj.lengthSec,
    maxFootage: proj.maxFootage,
    styleFilter: proj.styleFilter,
    lightFx: proj.lightFx,
    transition: proj.transition,
    motion: proj.motion,
    fades: proj.fades,
    fadeOut: proj.fadeOut,
    smartCut: proj.smartCut,
    beatSync: proj.beatSync,
    waltzToMusic: proj.waltzToMusic,
    loopToFill: proj.loopToFill,
    titleText: proj.titleText,
    musicTrackId: proj.musicTrackId,
    clips,
  };
}

/** Queue an HD render for a project (owner-checked). A worker picks it up. */
/** `cloudTargets`: the render modal's "Save to" (provider ids; [] = don't save); omitted = project setting / rules. */
async function createRenderImpl(projectId: string, opts: { cloudTargets?: string[] | null } = {}): Promise<string> {
  const userId = await requireUserId();

  const [proj] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!proj || !(await userCanAccessProject(userId, projectId, "editor"))) throw new Error("Project not found");

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.assets)
    .where(and(eq(schema.assets.projectId, projectId), eq(schema.assets.uploadState, "uploaded"), eq(schema.assets.hidden, false)));
  if (proj.kind === "deck") {
    // A WaltzDeck renders its storyboard; media is optional (text cards, animated explainer scenes).
    const [{ scenes }] = await db.select({ scenes: sql<number>`count(*)::int` }).from(schema.deckScenes).where(eq(schema.deckScenes.projectId, projectId));
    if (!scenes) throw new Error("Plan the video first — there are no scenes to render yet.");
  } else if (!count) throw new Error("Add at least one clip before rendering");

  // Waltz Avatar: presenter scenes cost AI credits for the lip-synced seconds (estimated from the narration now; the
  // worker settles down to what was rendered, or refunds it all if the render fails). Only the presenter's owner renders it.
  let presenterChargeId: string | undefined;
  let presenterSnap: RenderSettings["presenter"];
  if (proj.kind === "deck") {
    const brief = ((proj.deck ?? {}) as { brief?: DeckBrief }).brief;
    const scs = await db.select({ id: schema.deckScenes.id, layout: schema.deckScenes.layout, voice: schema.deckScenes.voice })
      .from(schema.deckScenes).where(eq(schema.deckScenes.projectId, projectId));
    const ps = scs.filter((s) => isPresenterLayout(s.layout));
    if (ps.length) {
      const pid = brief?.presenter?.id;
      if (!pid) throw new Error("This video has presenter scenes — pick your presenter under Voiceover first");
      const [pr] = await db.select({ status: schema.presenters.status, userId: schema.presenters.userId })
        .from(schema.presenters).where(eq(schema.presenters.id, pid));
      if (!pr) throw new Error("The presenter was deleted — pick another under Voiceover");
      if (pr.userId !== userId) throw new Error("Only the person whose presenter this is can render it");
      if (pr.status !== "ready") throw new Error("The presenter isn't ready yet");
      presenterSnap = { id: pid, scenes: ps.map((s) => ({ id: s.id, layout: s.layout, voice: s.voice })) };
      const voiceOn = !!brief?.voice?.mode && brief.voice.mode !== "off";
      // Lines already lip-synced (same words, voice, speed, pronunciations) are reused for free — only new ones count.
      let pron: unknown = [];
      if (proj.brandKitId) {
        const [bk] = await db.select({ p: schema.brandKits.pronunciationsJson }).from(schema.brandKits).where(eq(schema.brandKits.id, proj.brandKitId));
        pron = bk?.p ?? [];
      }
      let seconds = 0;
      if (voiceOn) {
        for (const s of ps) {
          if (!s.voice?.trim()) continue;
          const base = clipCacheBase({ id: pid, user_id: userId }, narrationRequest(s.voice, brief?.voice, pron));
          const cached = await headObject(`${base}.mp4`).then(() => true, () => false);
          if (!cached) seconds += estimateScriptSeconds(s.voice, brief?.voice?.speed ?? 1);
        }
      }
      const credits = presenterCredits(seconds);
      if (credits > 0) {
        presenterChargeId = randomUUID();
        const chargeId = presenterChargeId;
        await spendCredits(userId, credits, (tx) => tx.insert(schema.generationJobs).values({
          id: chargeId, projectId, workspaceId: proj.workspaceId ?? null, requestedBy: userId, credits,
          jobType: "presenter_render", status: "completed", progress: 100, modelName: "musetalk-1.5", workflowName: "presenter-lipsync-v1",
          requestJson: { presenterRender: { presenterId: pid, seconds: Math.round(seconds * 10) / 10 } },
        }));
      }
    }
  }

  const { shouldWatermark } = await import("./watermark");
  const watermark = await shouldWatermark(userId); // every plan by default; admin can exempt paid plans

  const [{ maxv }] = await db
    .select({ maxv: sql<number>`coalesce(max(version),0)::int` })
    .from(schema.renders)
    .where(eq(schema.renders.projectId, projectId));

  const id = randomUUID();
  try {
    await db.insert(schema.renders).values({
      id,
      projectId,
      version: (maxv ?? 0) + 1,
      aspect: proj.aspect,
      status: "queued",
      watermark,
      settings: { ...snapshotSettings(proj, count), ...(presenterChargeId ? { presenterChargeId } : {}), ...(presenterSnap ? { presenter: presenterSnap } : {}) },
      // Saves go to the project owner's storage, so only the owner's pick is kept.
      cloudTargets: Array.isArray(opts.cloudTargets) && proj.ownerId === userId ? cleanTargets(opts.cloudTargets) : null,
    });
  } catch (e) {
    if (presenterChargeId) {
      await db.update(schema.generationJobs).set({ status: "failed", updatedAt: new Date() }).where(eq(schema.generationJobs.id, presenterChargeId)).catch(() => {});
    }
    throw e;
  }
  await db
    .update(schema.projects)
    .set({ status: "rendering", updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  await track("render_requested", { userId, projectId, props: { renderId: id, version: (maxv ?? 0) + 1, clips: count, watermark } });

  revalidatePath(`/projects/${projectId}/edit`);
  revalidatePath(`/projects`);
  return id;
}

const fmtSec = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
};

// Human-readable diff between the previous render's settings and the current ones.
function diffSettings(prev: RenderSettings, cur: RenderSettings): string[] {
  const out: string[] = [];
  const lenLabel = (s: RenderSettings) => (s.maxFootage ? "Max" : `${s.lengthSec}s`);
  if (lenLabel(prev) !== lenLabel(cur)) out.push(`Length: ${lenLabel(prev)} → ${lenLabel(cur)}`);
  if (prev.aspect !== cur.aspect) out.push(`Format: ${prev.aspect} → ${cur.aspect}`);
  if (prev.styleFilter !== cur.styleFilter) out.push(`Filter: ${prev.styleFilter} → ${cur.styleFilter}`);
  if (prev.lightFx !== cur.lightFx) out.push(`Lighting: ${prev.lightFx} → ${cur.lightFx}`);
  if (prev.transition !== cur.transition) out.push(`Transition: ${prev.transition} → ${cur.transition}`);
  const flag = (k: keyof RenderSettings, label: string) => {
    if (prev[k] !== cur[k]) out.push(`${label}: ${cur[k] ? "on" : "off"}`);
  };
  flag("smartCut", "Smart cut");
  flag("beatSync", "Beat sync");
  flag("waltzToMusic", "Waltz to the Music");
  flag("motion", "Ken Burns");
  flag("fades", "Fade in");
  flag("fadeOut", "Fade out");
  flag("loopToFill", "Loop to fill");
  if (prev.musicTrackId !== cur.musicTrackId) out.push("Music track changed");
  if ((prev.titleText ?? "") !== (cur.titleText ?? "")) out.push("Title changed");
  if (prev.clips !== cur.clips) out.push(`Clips: ${prev.clips} → ${cur.clips}`);
  return out;
}

/**
 * Build the render confirmation checkpoint — the effective settings (read fresh from the DB, so
 * what's shown is exactly what will render), a projected length, tiered warnings, and a diff vs the
 * previous render. Called from the client the moment the user clicks Render / Re-render.
 */
async function getRenderCheckpointImpl(projectId: string): Promise<RenderCheckpoint> {
  const userId = await requireUserId();
  const [proj] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!proj || !(await userCanAccessProject(userId, projectId, "editor"))) throw new Error("Project not found");

  const assets = await db
    .select({
      kind: schema.assets.kind,
      durationSec: schema.assets.durationSec,
      width: schema.assets.width,
      height: schema.assets.height,
    })
    .from(schema.assets)
    .where(and(eq(schema.assets.projectId, projectId), eq(schema.assets.uploadState, "uploaded"), eq(schema.assets.hidden, false)))
    .orderBy(asc(schema.assets.orderIndex));
  const clips = assets.length;

  let musicTitle: string | null = null;
  if (proj.musicTrackId) {
    const [t] = await db
      .select({ title: schema.musicTracks.title })
      .from(schema.musicTracks)
      .where(eq(schema.musicTracks.id, proj.musicTrackId));
    musicTitle = t?.title ?? null;
  }

  const CEIL = 600;
  const footageSec = assets.reduce(
    (s, a) => s + (a.kind === "video" ? a.durationSec ?? 4 : 2),
    0,
  );
  const projectedSec = proj.maxFootage
    ? Math.min(CEIL, footageSec)
    : Math.min(proj.lengthSec, footageSec > 0 && !proj.loopToFill ? Math.max(footageSec, proj.lengthSec) : proj.lengthSec);

  const warnings: CheckWarning[] = [];
  // A WaltzDeck renders its storyboard — text cards and animated scenes need no media (an explainer may have none).
  if (clips === 0 && proj.kind !== "deck") {
    warnings.push({ level: "red", text: "No clips added yet — add media before rendering." });
  } else if (clips === 1) {
    warnings.push({
      level: "yellow",
      text: "Only 1 clip — expect Ken Burns motion or looping to fill the length.",
    });
  }
  if (!proj.musicTrackId) {
    warnings.push({ level: "yellow", text: "No music picked — a default track will be used." });
  }
  // Orientation vs chosen aspect.
  const oriented = assets.filter((a) => !!a.width && !!a.height);
  if (oriented.length) {
    const vertical = oriented.filter((a) => (a.height ?? 0) > (a.width ?? 0)).length;
    const horizontal = oriented.length - vertical;
    if (proj.aspect === "16:9" && vertical > horizontal) {
      warnings.push({ level: "yellow", text: "Most clips are vertical but the video is 16:9 — they'll letterbox or crop." });
    } else if (proj.aspect === "9:16" && horizontal > vertical) {
      warnings.push({ level: "yellow", text: "Most clips are landscape but the video is 9:16 — they'll be cropped." });
    }
  }
  if (!proj.maxFootage && !proj.loopToFill && footageSec > 0 && footageSec < proj.lengthSec - 1) {
    warnings.push({
      level: "info",
      text: `Your footage is ~${fmtSec(footageSec)} — shorter than the ${fmtSec(proj.lengthSec)} target, so the video fills to about ${fmtSec(footageSec)} (turn on Loop to fill to repeat).`,
    });
  }

  const cur = snapshotSettings(proj, clips);
  const [last] = await db
    .select({ settings: schema.renders.settings, version: schema.renders.version })
    .from(schema.renders)
    .where(and(eq(schema.renders.projectId, projectId), isNull(schema.renders.campaignId)))
    .orderBy(desc(schema.renders.version))
    .limit(1);
  const changes = last?.settings ? diffSettings(last.settings as RenderSettings, cur) : [];

  const effects =
    [
      proj.smartCut && "Smart cut",
      proj.beatSync && "Beat sync",
      proj.waltzToMusic && "Waltz",
      proj.motion && "Ken Burns",
      proj.fades && "Fade in",
      proj.fadeOut && "Fade out",
    ]
      .filter(Boolean)
      .join(", ") || "None";

  const summary = [
    { label: "Format", value: proj.aspect },
    { label: "Length", value: proj.maxFootage ? "Max footage" : `${proj.lengthSec}s` },
    { label: "Filter", value: proj.styleFilter },
    { label: "Lighting", value: proj.lightFx },
    { label: "Transition", value: proj.transition },
    { label: "Effects", value: effects },
    { label: "Music", value: musicTitle ?? "Default track" },
    { label: "Title", value: proj.titleText || "—" },
    { label: "Clips", value: String(clips) },
  ];

  return {
    clips,
    musicTitle,
    lengthLabel: proj.maxFootage ? "Max footage" : `${proj.lengthSec}s`,
    projectedSec,
    aspect: proj.aspect,
    summary,
    warnings,
    changes,
    hasBlocking: clips === 0 && proj.kind !== "deck",
  };
}

// Exported actions return ActionResult (action-result.ts — thrown messages are hidden in production builds).
// Client: unwrap(await action(...)).
export async function deleteRender(...args: Parameters<typeof deleteRenderImpl>) { return toResult(() => deleteRenderImpl(...args)); }
export async function createRender(...args: Parameters<typeof createRenderImpl>) { return toResult(() => createRenderImpl(...args)); }
export async function getRenderCheckpoint(...args: Parameters<typeof getRenderCheckpointImpl>) { return toResult(() => getRenderCheckpointImpl(...args)); }
