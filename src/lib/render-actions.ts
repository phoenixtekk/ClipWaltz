"use server";
import { randomUUID } from "crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { userCanAccessProject } from "./workspace";
import { requireUserId } from "./auth";
import { deleteObject } from "./storage";
import type { RenderSettings, RenderCheckpoint, CheckWarning } from "./render";

/** Delete a saved render (the DB row + its MinIO object), editor-checked. */
export async function deleteRender(renderId: string): Promise<void> {
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
export async function createRender(projectId: string): Promise<string> {
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
  if (!count) throw new Error("Add at least one clip before rendering");

  const { getEffectiveTier } = await import("./tier");
  const watermark = (await getEffectiveTier(userId)) === "free";

  const [{ maxv }] = await db
    .select({ maxv: sql<number>`coalesce(max(version),0)::int` })
    .from(schema.renders)
    .where(eq(schema.renders.projectId, projectId));

  const id = randomUUID();
  await db.insert(schema.renders).values({
    id,
    projectId,
    version: (maxv ?? 0) + 1,
    aspect: proj.aspect,
    status: "queued",
    watermark,
    settings: snapshotSettings(proj, count),
  });
  await db
    .update(schema.projects)
    .set({ status: "rendering", updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));

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
export async function getRenderCheckpoint(projectId: string): Promise<RenderCheckpoint> {
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
  if (clips === 0) {
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
    .where(eq(schema.renders.projectId, projectId))
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
    hasBlocking: clips === 0,
  };
}
