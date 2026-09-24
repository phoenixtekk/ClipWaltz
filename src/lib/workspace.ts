import { randomUUID } from "crypto";
import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Workspace roles (ADR-0004), lowest → highest:
 *   viewer — open projects, watch/download renders + exports (read-only)
 *   editor — everything a viewer can, plus edit/upload/render/generate/enhance/export/delete media
 *   admin  — everything an editor can, plus delete projects and manage members/invites
 *   owner  — the workspace's owner (exactly one); cannot be removed or demoted
 */
export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export const WORKSPACE_ROLES: WorkspaceRole[] = ["owner", "admin", "editor", "viewer"];
const RANK: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

export function isWorkspaceRole(r: unknown): r is WorkspaceRole {
  return typeof r === "string" && r in RANK;
}

/** "an admin" / "an editor" / "a viewer" / "an owner". */
export function withArticle(role: WorkspaceRole): string {
  return `${/^[aeiou]/.test(role) ? "an" : "a"} ${role}`;
}

/** True when `role` is at least `min`. */
export function roleAtLeast(role: WorkspaceRole | null | undefined, min: WorkspaceRole): boolean {
  return !!role && RANK[role] >= RANK[min];
}

/**
 * Get-or-create the user's personal workspace + owner membership (ADR-0004). Idempotent.
 * Called on signup (auth-server user.create hook) and by the one-time backfill for existing users.
 * Returns the workspace id.
 */
export async function ensurePersonalWorkspace(
  userId: string,
  name = "My Workspace",
): Promise<string> {
  const [existing] = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.ownerUserId, userId), eq(schema.workspaces.isPersonal, true)))
    .limit(1);
  if (existing) return existing.id;

  const id = randomUUID();
  await db.insert(schema.workspaces).values({ id, ownerUserId: userId, name, isPersonal: true });
  await db
    .insert(schema.workspaceMembers)
    .values({ id: randomUUID(), workspaceId: id, userId, role: "owner" })
    .onConflictDoNothing();
  return id;
}

/** The workspace ids the user is a member of (ADR-0004). */
export async function getUserWorkspaceIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, userId));
  return rows.map((r) => r.id);
}

/** The user's role in a workspace, or null if not a member. */
export async function getWorkspaceRole(userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  const [m] = await db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, userId)));
  return m && isWorkspaceRole(m.role) ? m.role : null;
}

/**
 * The user's effective role on a project. A project in a workspace takes the user's membership
 * role there (so removing a member revokes access, even to projects they created). A legacy
 * project with no workspace falls back to its creator as owner.
 */
export async function getProjectRole(userId: string, projectId: string): Promise<WorkspaceRole | null> {
  const [p] = await db
    .select({ ownerId: schema.projects.ownerId, workspaceId: schema.projects.workspaceId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!p) return null;
  if (!p.workspaceId) return p.ownerId === userId ? "owner" : null;
  return getWorkspaceRole(userId, p.workspaceId);
}

/** True if the user holds at least `min` on the project (default: can view it). */
export async function userCanAccessProject(
  userId: string,
  projectId: string,
  min: WorkspaceRole = "viewer",
): Promise<boolean> {
  return roleAtLeast(await getProjectRole(userId, projectId), min);
}

/** Throws `message` unless the user holds at least `min` on the project. */
export async function assertProjectRole(
  userId: string,
  projectId: string,
  min: WorkspaceRole,
  message = "Project not found",
): Promise<void> {
  if (!(await userCanAccessProject(userId, projectId, min))) throw new Error(message);
}

/**
 * SQL filter for "projects this user can see": a member of the project's workspace, or the
 * creator of a legacy (workspace-less) project. Use in list/detail queries.
 */
export function visibleProjectsFilter(userId: string, workspaceIds: string[]): SQL {
  const legacy = and(isNull(schema.projects.workspaceId), eq(schema.projects.ownerId, userId))!;
  return workspaceIds.length ? or(legacy, inArray(schema.projects.workspaceId, workspaceIds))! : legacy;
}
