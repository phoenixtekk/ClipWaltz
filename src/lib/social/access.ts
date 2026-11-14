import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { memberCanApprove } from "@/lib/social/approval";
import { activeWorkspaceId } from "@/lib/active-workspace";
import { getWorkspaceRole, roleAtLeast, type WorkspaceRole } from "@/lib/workspace";

// Who may do what in Social Publishing (ADR-0011 / plan §4.3, D9). Request paths only — the worker never imports this
// (it pulls in the session), which is also why the rest of src/lib/social does not use `server-only`: those modules
// run inside worker/social-worker.mjs too. None of them may be imported from a client component.
//
//   feature flag   SOCIAL_PUBLISHING_ENABLED (default off). While off, only ADMIN_EMAILS accounts can use it.
//   viewer+        see the workspace's posts, channels (no credentials) and analytics
//   editor+        compose, schedule, publish through the workspace's channels
//   admin+         connect / disconnect / pause channels
//   approver       approve or reject posts awaiting approval: owners and admins by role, plus any member whose
//                  workspace_members.social_approver flag is set (the one extra capability, D9)

export function socialPublishingEnabled(): boolean {
  return process.env.SOCIAL_PUBLISHING_ENABLED === "1" || process.env.SOCIAL_PUBLISHING_ENABLED === "true";
}

/** True when this account may use Social Publishing at all (flag on, or a site admin while it is off). */
export function socialAllowedFor(email: string | null | undefined): boolean {
  return socialPublishingEnabled() || isAdminEmail(email);
}

export class SocialAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403 | 404,
  ) {
    super(message);
  }
}

export interface SocialContext {
  userId: string;
  email: string;
  workspaceId: string;
  role: WorkspaceRole;
}

/**
 * Resolve the caller and check they may act on the workspace with at least `min`. With no workspace given, the
 * caller's active workspace (G15 switcher) is used. Throws SocialAccessError (401 signed out, 403 flag/role, 404 not a member).
 */
export async function requireSocial(workspaceId: string | null | undefined, min: WorkspaceRole): Promise<SocialContext> {
  const session = await getSession();
  if (!session) throw new SocialAccessError("Sign in to continue.", 401);
  const { id: userId, email } = session.user;
  if (!socialAllowedFor(email)) throw new SocialAccessError("Social publishing is not available on this account yet.", 403);

  // G15: no workspace given = the caller's ACTIVE workspace (cookie, membership re-checked in activeWorkspaceId).
  const ws = workspaceId || (await activeWorkspaceId(userId));
  const role = await getWorkspaceRole(userId, ws);
  if (!role) throw new SocialAccessError("Workspace not found.", 404);
  if (!roleAtLeast(role, min)) {
    throw new SocialAccessError(
      min === "admin" ? "Only workspace owners and admins can manage channels." : "You don't have permission to do that in this workspace.",
      403,
    );
  }
  return { userId, email, workspaceId: ws, role };
}

/** D9: may this member approve/reject posts in the workspace? */
export async function canApprove(userId: string, workspaceId: string): Promise<boolean> {
  return memberCanApprove(userId, workspaceId);
}

/** requireSocial + the approver capability. */
export async function requireApprover(workspaceId: string | null | undefined): Promise<SocialContext> {
  const ctx = await requireSocial(workspaceId, "viewer");
  if (!(await canApprove(ctx.userId, ctx.workspaceId))) {
    throw new SocialAccessError("Only approvers can approve or reject posts in this workspace.", 403);
  }
  return ctx;
}

/** Grant or revoke the approver capability (workspace owners/admins only). */
export async function setSocialApprover(
  actorWorkspaceId: string,
  memberUserId: string,
  approver: boolean,
): Promise<boolean> {
  await requireSocial(actorWorkspaceId, "admin");
  const rows = await db
    .update(schema.workspaceMembers)
    .set({ socialApprover: approver })
    .where(and(eq(schema.workspaceMembers.workspaceId, actorWorkspaceId), eq(schema.workspaceMembers.userId, memberUserId)))
    .returning({ id: schema.workspaceMembers.id });
  return rows.length > 0;
}

/** Map an access error (or anything else) to a JSON Response for route handlers. */
export function socialErrorResponse(e: unknown): Response {
  if (e instanceof SocialAccessError) return Response.json({ error: e.message }, { status: e.status });
  console.error("[social]", e);
  return Response.json({ error: "Something went wrong." }, { status: 500 });
}
