import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

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

/**
 * Workspace-scoped access check: true if the user owns the project OR is a member of its
 * workspace. Owner is the fallback so projects with a null workspace_id (or the owner's own)
 * always resolve — no regression from the pre-workspace, owner-only model.
 */
export async function userCanAccessProject(userId: string, projectId: string): Promise<boolean> {
  const [p] = await db
    .select({ ownerId: schema.projects.ownerId, workspaceId: schema.projects.workspaceId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!p) return false;
  if (p.ownerId === userId) return true;
  if (!p.workspaceId) return false;
  const [m] = await db
    .select({ id: schema.workspaceMembers.id })
    .from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.workspaceId, p.workspaceId), eq(schema.workspaceMembers.userId, userId)));
  return !!m;
}
