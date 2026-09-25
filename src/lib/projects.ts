import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { getUserWorkspaceIds, getProjectRole, visibleProjectsFilter, type WorkspaceRole } from "./workspace";
import { parseOverlays, type Overlay } from "./overlays";

export type ProjectStatus = "draft" | "rendering" | "ready" | "failed";

export type ProjectSummary = {
  id: string;
  title: string;
  titleText: string | null; // the Style Title / caption — shown on cards to tell projects apart
  status: ProjectStatus;
  aspect: string;
  clips?: number; // uploaded asset count (populated by listProjects)
  category: string | null; // folder name on the projects page; null = Uncategorized
  tags: string[]; // free-form labels
  updatedAt: string; // ISO — serializable across the RSC boundary
};

export type ProjectDetail = ProjectSummary & {
  template: string;
  lengthSec: number;
  musicTrackId: string | null;
  titleText: string | null;
  styleFilter: string;
  lightFx: string;
  transition: string;
  motion: boolean;
  fades: boolean;
  fadeOut: boolean;
  smartCut: boolean;
  beatSync: boolean;
  waltzToMusic: boolean;
  describe: boolean;
  postTopic: string | null;
  postTemplate: string | null;
  originalAudio: boolean;
  musicVolume: number | null;
  originalVolume: number | null;
  loopToFill: boolean;
  maxFootage: boolean;
  overlays: Overlay[];
  workspaceId: string | null;
  role: WorkspaceRole; // the caller's effective role — gates the editor UI (viewer = read-only)
  description: string | null;
  aiTemplateId: string | null;
};

/** A single project the current user can see (any workspace role), or null. */
export async function getProject(id: string): Promise<ProjectDetail | null> {
  const userId = await requireUserId();
  const wsIds = await getUserWorkspaceIds(userId);
  const [r] = await db
    .select()
    .from(schema.projects)
    .where(
      // a member of the project's workspace, or the creator of a legacy project (ADR-0004)
      and(eq(schema.projects.id, id), visibleProjectsFilter(userId, wsIds)),
    );
  if (!r) return null;
  const role = await getProjectRole(userId, r.id);
  if (!role) return null;
  return {
    description: r.description,
    aiTemplateId: r.aiTemplateId,
    id: r.id,
    title: r.title,
    status: r.status as ProjectStatus,
    aspect: r.aspect,
    category: r.category,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    template: r.template,
    lengthSec: r.lengthSec,
    musicTrackId: r.musicTrackId,
    titleText: r.titleText,
    styleFilter: r.styleFilter,
    lightFx: r.lightFx,
    transition: r.transition,
    motion: r.motion,
    fades: r.fades,
    fadeOut: r.fadeOut,
    smartCut: r.smartCut,
    beatSync: r.beatSync,
    waltzToMusic: r.waltzToMusic,
    describe: r.describe,
    postTopic: r.postTopic,
    postTemplate: r.postTemplate,
    originalAudio: r.originalAudio,
    musicVolume: r.musicVolume,
    originalVolume: r.originalVolume,
    loopToFill: r.loopToFill,
    maxFootage: r.maxFootage,
    overlays: parseOverlays(r.overlays),
    workspaceId: r.workspaceId,
    role,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export type ProjectCategory = { id: string; name: string; color: string | null; sortOrder: number };

/** The signed-in user's project categories, ordered. Server-only. */
export async function listCategories(): Promise<ProjectCategory[]> {
  const userId = await requireUserId();
  const rows = await db
    .select()
    .from(schema.projectCategories)
    .where(eq(schema.projectCategories.ownerId, userId))
    .orderBy(schema.projectCategories.sortOrder, schema.projectCategories.createdAt);
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, sortOrder: r.sortOrder }));
}

/**
 * Projects the current user can see, newest first. With `workspaceId`, only that workspace's
 * (plus, for the caller's personal workspace, their legacy workspace-less projects).
 */
export async function listProjects(workspaceId?: string, includeLegacy = false): Promise<ProjectSummary[]> {
  const userId = await requireUserId();
  const allWs = await getUserWorkspaceIds(userId);
  const wsIds = workspaceId ? allWs.filter((id) => id === workspaceId) : allWs;
  const filter = workspaceId && !includeLegacy
    ? inArray(schema.projects.workspaceId, wsIds)
    : visibleProjectsFilter(userId, wsIds);
  const rows = await db
    .select()
    .from(schema.projects)
    .where(filter)
    .orderBy(desc(schema.projects.updatedAt));

  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await db
        .select({ pid: schema.assets.projectId, n: sql<number>`count(*)::int` })
        .from(schema.assets)
        .where(and(inArray(schema.assets.projectId, ids), eq(schema.assets.uploadState, "uploaded"), eq(schema.assets.hidden, false)))
        .groupBy(schema.assets.projectId)
    : [];
  const clipMap = new Map(counts.map((c) => [c.pid, c.n]));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    titleText: r.titleText,
    status: r.status as ProjectStatus,
    aspect: r.aspect,
    clips: clipMap.get(r.id) ?? 0,
    category: r.category,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    updatedAt: r.updatedAt.toISOString(),
  }));
}
