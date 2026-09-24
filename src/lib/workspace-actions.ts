"use server";
import { createHash, randomBytes, randomUUID } from "crypto";
import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { sendEmail } from "./email";
import {
  ensurePersonalWorkspace,
  getWorkspaceRole,
  isWorkspaceRole,
  roleAtLeast,
  withArticle,
  type WorkspaceRole,
} from "./workspace";

// Member management for workspaces (ADR-0004). Roles: owner > admin > editor > viewer.
// Admins manage editors/viewers; only the owner manages admins. The owner can't be removed/demoted.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PENDING_INVITES = 25;
const INVITABLE: WorkspaceRole[] = ["admin", "editor", "viewer"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WorkspaceListItem = {
  id: string;
  name: string;
  role: WorkspaceRole;
  isPersonal: boolean;
  ownerName: string;
  memberCount: number;
};

export type WorkspaceMemberItem = {
  id: string; // membership id
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
};

export type WorkspaceInviteItem = {
  id: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: string | null;
  expiresAt: string;
};

export type WorkspaceDetail = {
  id: string;
  name: string;
  isPersonal: boolean;
  myRole: WorkspaceRole;
  members: WorkspaceMemberItem[];
  invites: WorkspaceInviteItem[]; // only populated for admins/owner
};

export type InvitePreview =
  | { status: "ok"; workspaceName: string; inviterName: string | null; role: WorkspaceRole; email: string }
  | { status: "invalid" | "expired" | "used" | "revoked" };

/** Expected, user-facing failure. Returned (not thrown) to the client — Next hides thrown messages
 *  from Server Functions in production. */
class ActionError extends Error {}
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: e.message };
    throw e;
  }
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function requireWorkspaceRole(userId: string, workspaceId: string, min: WorkspaceRole): Promise<WorkspaceRole> {
  const role = await getWorkspaceRole(userId, workspaceId);
  if (!roleAtLeast(role, min)) throw new ActionError("Workspace not found");
  return role!;
}

/** Every workspace the current user belongs to (personal first). */
export async function listMyWorkspaces(): Promise<WorkspaceListItem[]> {
  const userId = await requireUserId();
  await ensurePersonalWorkspace(userId);
  const rows = await db
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      isPersonal: schema.workspaces.isPersonal,
      ownerUserId: schema.workspaces.ownerUserId,
      ownerName: schema.user.name,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
    .innerJoin(schema.user, eq(schema.workspaces.ownerUserId, schema.user.id))
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(asc(schema.workspaces.createdAt));

  const out: WorkspaceListItem[] = [];
  for (const r of rows) {
    if (!isWorkspaceRole(r.role)) continue;
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, r.id));
    out.push({ id: r.id, name: r.name, role: r.role, isPersonal: r.isPersonal && r.ownerUserId === userId, ownerName: r.ownerName, memberCount: n });
  }
  // The caller's own personal workspace first, then shared ones.
  return out.sort((a, b) => Number(b.isPersonal) - Number(a.isPersonal));
}

/** Members (and, for admins, pending invites) of a workspace the current user belongs to. */
export async function getWorkspaceDetail(workspaceId: string): Promise<WorkspaceDetail | null> {
  const userId = await requireUserId();
  const myRole = await getWorkspaceRole(userId, workspaceId);
  if (!myRole) return null;
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  if (!ws) return null;

  const members = await db
    .select({
      id: schema.workspaceMembers.id,
      userId: schema.workspaceMembers.userId,
      role: schema.workspaceMembers.role,
      createdAt: schema.workspaceMembers.createdAt,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.user, eq(schema.workspaceMembers.userId, schema.user.id))
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(schema.workspaceMembers.createdAt));

  let invites: WorkspaceInviteItem[] = [];
  if (roleAtLeast(myRole, "admin")) {
    const rows = await db
      .select({
        id: schema.workspaceInvites.id,
        email: schema.workspaceInvites.email,
        role: schema.workspaceInvites.role,
        expiresAt: schema.workspaceInvites.expiresAt,
        invitedBy: schema.user.name,
      })
      .from(schema.workspaceInvites)
      .leftJoin(schema.user, eq(schema.workspaceInvites.invitedBy, schema.user.id))
      .where(
        and(
          eq(schema.workspaceInvites.workspaceId, workspaceId),
          isNull(schema.workspaceInvites.acceptedAt),
          isNull(schema.workspaceInvites.revokedAt),
          gt(schema.workspaceInvites.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(schema.workspaceInvites.createdAt));
    invites = rows
      .filter((r) => isWorkspaceRole(r.role))
      .map((r) => ({ id: r.id, email: r.email, role: r.role as WorkspaceRole, invitedBy: r.invitedBy, expiresAt: r.expiresAt.toISOString() }));
  }

  return {
    id: ws.id,
    name: ws.name,
    isPersonal: ws.isPersonal,
    myRole,
    members: members
      .filter((m) => isWorkspaceRole(m.role))
      .map((m) => ({ id: m.id, userId: m.userId, name: m.name, email: m.email, role: m.role as WorkspaceRole, joinedAt: m.createdAt.toISOString() })),
    invites,
  };
}

/** Rename a workspace (admin+). */
export async function renameWorkspace(workspaceId: string, name: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await requireWorkspaceRole(userId, workspaceId, "admin");
    const nm = name.trim().slice(0, 60);
    if (!nm) throw new ActionError("Name can't be empty");
    await db.update(schema.workspaces).set({ name: nm, updatedAt: new Date() }).where(eq(schema.workspaces.id, workspaceId));
    revalidatePath("/account/workspace");
    revalidatePath("/projects");
    return {};
  });
}

/**
 * Invite someone by email (admin+; only the owner may invite admins). Emails a single-use,
 * 7-day link; any earlier pending invite for the same address is revoked. Returns the link so the
 * inviter can also copy it (it's only ever shown to the inviter).
 */
export async function inviteMember(workspaceId: string, email: string, role: string): Promise<ActionResult<{ url: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    const myRole = await requireWorkspaceRole(userId, workspaceId, "admin");
    const addr = email.trim().toLowerCase();
    if (!EMAIL_RE.test(addr) || addr.length > 254) throw new ActionError("Enter a valid email address");
    if (!isWorkspaceRole(role) || !INVITABLE.includes(role)) throw new ActionError("Pick a role");
    if (role === "admin" && myRole !== "owner") throw new ActionError("Only the workspace owner can invite admins");
  
    // Already a member?
    const [existing] = await db
      .select({ id: schema.workspaceMembers.id })
      .from(schema.workspaceMembers)
      .innerJoin(schema.user, eq(schema.workspaceMembers.userId, schema.user.id))
      .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.user.email, addr)));
    if (existing) throw new ActionError("That person is already a member");
  
    const now = new Date();
    const [{ pending }] = await db
      .select({ pending: count() })
      .from(schema.workspaceInvites)
      .where(
        and(
          eq(schema.workspaceInvites.workspaceId, workspaceId),
          isNull(schema.workspaceInvites.acceptedAt),
          isNull(schema.workspaceInvites.revokedAt),
          gt(schema.workspaceInvites.expiresAt, now),
        ),
      );
    if (pending >= MAX_PENDING_INVITES) throw new ActionError(`Too many pending invites (max ${MAX_PENDING_INVITES}) — revoke some first`);
  
    // Supersede any earlier pending invite for this address.
    await db
      .update(schema.workspaceInvites)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.workspaceInvites.workspaceId, workspaceId),
          eq(schema.workspaceInvites.email, addr),
          isNull(schema.workspaceInvites.acceptedAt),
          isNull(schema.workspaceInvites.revokedAt),
        ),
      );
  
    const token = randomBytes(32).toString("base64url");
    await db.insert(schema.workspaceInvites).values({
      id: randomUUID(),
      workspaceId,
      email: addr,
      role,
      tokenHash: hashToken(token),
      invitedBy: userId,
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    });
  
    const [ws] = await db.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    const [me] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId));
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.clipwaltz.com";
    const url = `${base}/invite/${token}`;
    const who = escapeHtml(me?.name || "A ClipWaltz user");
    const wsName = escapeHtml(ws?.name ?? "a workspace");
    await sendEmail({
      to: addr,
      subject: `${me?.name || "Someone"} invited you to “${ws?.name ?? "a workspace"}” on ClipWaltz`,
      html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:auto">
    <h2>You're invited to ${wsName}</h2>
    <p style="color:#555">${who} invited you to join <b>${wsName}</b> on ClipWaltz as <b>${withArticle(role)}</b>. Sign in (or create an account) with this email address to accept.</p>
    <p><a href="${url}" style="display:inline-block;background:#cf5330;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Accept invite</a></p>
    <p style="color:#999;font-size:12px">This link expires in 7 days and works once. If you weren't expecting it, you can ignore this email.</p>
  </div>`,
      text: `${me?.name || "Someone"} invited you to join "${ws?.name ?? "a workspace"}" on ClipWaltz as ${withArticle(role)}. Accept (expires in 7 days): ${url}`,
    });
  
    revalidatePath("/account/workspace");
    return { url };
  });
}

/** Revoke a pending invite (admin+). */
export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const [inv] = await db
      .select({ workspaceId: schema.workspaceInvites.workspaceId })
      .from(schema.workspaceInvites)
      .where(eq(schema.workspaceInvites.id, inviteId));
    if (!inv) throw new ActionError("Invite not found");
    await requireWorkspaceRole(userId, inv.workspaceId, "admin");
    await db.update(schema.workspaceInvites).set({ revokedAt: new Date() }).where(eq(schema.workspaceInvites.id, inviteId));
    revalidatePath("/account/workspace");
    return {};
  });
}

// Load a membership and check the caller may manage it: admin+ for editors/viewers,
// owner only for admins; never the owner's own membership.
async function manageableMember(userId: string, memberId: string) {
  const [m] = await db
    .select({ id: schema.workspaceMembers.id, workspaceId: schema.workspaceMembers.workspaceId, userId: schema.workspaceMembers.userId, role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.id, memberId));
  if (!m) throw new ActionError("Member not found");
  const myRole = await requireWorkspaceRole(userId, m.workspaceId, "admin");
  if (m.role === "owner") throw new ActionError("The workspace owner can't be changed");
  if (m.role === "admin" && myRole !== "owner") throw new ActionError("Only the workspace owner can manage admins");
  return { member: m, myRole };
}

/** Change a member's role (admin+; admins can't grant/revoke admin). */
export async function changeMemberRole(memberId: string, role: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const { member, myRole } = await manageableMember(userId, memberId);
    if (!isWorkspaceRole(role) || role === "owner") throw new ActionError("Pick a role");
    if (role === "admin" && myRole !== "owner") throw new ActionError("Only the workspace owner can make admins");
    if (member.userId === userId) throw new ActionError("You can't change your own role");
    await db.update(schema.workspaceMembers).set({ role }).where(eq(schema.workspaceMembers.id, memberId));
    revalidatePath("/account/workspace");
    return {};
  });
}

/** Remove a member (admin+; the owner can't be removed). Their access to its projects ends. */
export async function removeMember(memberId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const { member } = await manageableMember(userId, memberId);
    if (member.userId === userId) throw new ActionError("Use “Leave workspace” to remove yourself");
    await db.delete(schema.workspaceMembers).where(eq(schema.workspaceMembers.id, memberId));
    revalidatePath("/account/workspace");
    return {};
  });
}

/** Leave a workspace you were invited to (not your own). */
export async function leaveWorkspace(workspaceId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const role = await requireWorkspaceRole(userId, workspaceId, "viewer");
    if (role === "owner") throw new ActionError("The owner can't leave their own workspace");
    await db
      .delete(schema.workspaceMembers)
      .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, userId)));
    revalidatePath("/account/workspace");
    revalidatePath("/projects");
    return {};
  });
}

async function findInvite(token: string) {
  if (!token || token.length > 100) return null;
  const [inv] = await db
    .select()
    .from(schema.workspaceInvites)
    .where(eq(schema.workspaceInvites.tokenHash, hashToken(token)));
  return inv ?? null;
}

/** What an invite link points at (for the accept page). Requires sign-in; reveals nothing more
 *  than the workspace name, inviter and role to the holder of the secret link. */
export async function getInvitePreview(token: string): Promise<InvitePreview> {
  await requireUserId();
  const inv = await findInvite(token);
  if (!inv) return { status: "invalid" };
  if (inv.acceptedAt) return { status: "used" };
  if (inv.revokedAt) return { status: "revoked" };
  if (inv.expiresAt <= new Date()) return { status: "expired" };
  if (!isWorkspaceRole(inv.role)) return { status: "invalid" };
  const [ws] = await db.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, inv.workspaceId));
  if (!ws) return { status: "invalid" };
  const [by] = inv.invitedBy
    ? await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, inv.invitedBy))
    : [];
  return { status: "ok", workspaceName: ws.name, inviterName: by?.name ?? null, role: inv.role, email: inv.email };
}

/**
 * Accept an invite as the signed-in user. The account's email must match the invited address.
 * Single-use: the row is claimed atomically (acceptedAt IS NULL guard). Returns the workspace id.
 */
export async function acceptInvite(token: string): Promise<ActionResult<{ workspaceId: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    const inv = await findInvite(token);
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt <= new Date() || !isWorkspaceRole(inv.role)) {
      throw new ActionError("This invite is no longer valid");
    }
    const [me] = await db.select({ email: schema.user.email, verified: schema.user.emailVerified }).from(schema.user).where(eq(schema.user.id, userId));
    if (!me || me.email.toLowerCase() !== inv.email) {
      throw new ActionError(`This invite was sent to ${inv.email}. Sign in with that address to accept it.`);
    }
    // Sign-up doesn't force verification, so prove the address before granting access.
    if (!me.verified) throw new ActionError("Verify your email address first — use the button above.");
  
    const claimed = await db
      .update(schema.workspaceInvites)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(and(eq(schema.workspaceInvites.id, inv.id), isNull(schema.workspaceInvites.acceptedAt), isNull(schema.workspaceInvites.revokedAt)))
      .returning({ id: schema.workspaceInvites.id });
    if (!claimed.length) throw new ActionError("This invite is no longer valid");
  
    // Already a member (e.g. re-invited)? Keep the existing role; never downgrade the owner.
    await db
      .insert(schema.workspaceMembers)
      .values({ id: randomUUID(), workspaceId: inv.workspaceId, userId, role: inv.role })
      .onConflictDoNothing();
    revalidatePath("/projects");
    revalidatePath("/account/workspace");
    return { workspaceId: inv.workspaceId };
  });
}
