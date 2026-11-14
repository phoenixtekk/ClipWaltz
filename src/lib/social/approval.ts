import { randomUUID } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// G9 approval workflow (plan §6 G9, decision D9). Runs in the web app AND in the social worker (publishPost and the
// scheduler use the gate), so no `server-only` and no session imports here.
//
// Post approval states (social_posts.approval_status):
//   none      never submitted. Publishable only when the workspace does NOT require approval.
//   pending   in review — waiting for an approver. Never published.
//   approved  an approver (or the review link) approved it. Publishable.
//   rejected  shown as "Changes requested" — never published until it is edited and approved again.
//
// Workspace setting workspaces.social_require_approval: when on, nothing is published unless it is `approved`. That
// rule lives in the gate below (publishPost) and in the scheduler/queue SQL, so it holds whatever a client sends.
// Approver = workspace owner or admin by role, or a member with workspace_members.social_approver (D9).

export type ApprovalStatus = "none" | "pending" | "approved" | "rejected";
export type ReviewDecision = "submitted" | "approved" | "changes_requested";

export async function workspaceRequiresApproval(workspaceId: string): Promise<boolean> {
  const [w] = await db
    .select({ on: schema.workspaces.socialRequireApproval })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  return Boolean(w?.on);
}

/** May this member approve/reject posts in the workspace? Owner/admin by role, or the approver capability. */
export async function memberCanApprove(userId: string, workspaceId: string): Promise<boolean> {
  const [m] = await db
    .select({ role: schema.workspaceMembers.role, approver: schema.workspaceMembers.socialApprover })
    .from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, userId)));
  if (!m) return false;
  return m.role === "owner" || m.role === "admin" || m.approver;
}

/**
 * Why this post may not be published right now, or null when it may. The single gate used by publishPost (manual
 * Publish, the scheduler, Auto Post, the API). `required` can be passed when the caller already knows it.
 */
export async function approvalBlock(
  post: { workspaceId: string; approvalStatus: string },
  required?: boolean,
): Promise<string | null> {
  if (post.approvalStatus === "pending") return "This post is awaiting approval.";
  if (post.approvalStatus === "rejected") return "Changes were requested on this post — edit it and send it for approval again.";
  if (post.approvalStatus === "approved") return null;
  const req = required ?? (await workspaceRequiresApproval(post.workspaceId));
  return req ? "This workspace needs posts approved before they go out — send it for approval first." : null;
}

/**
 * SQL condition: the post's approval state lets it publish (approved, or never-submitted in a workspace that does
 * not require approval). The scheduler and the Auto Post queue add this so they never even pick an unapproved post.
 */
export function publishableApprovalSql() {
  return sql`(${schema.socialPosts.approvalStatus} = 'approved' or (${schema.socialPosts.approvalStatus} = 'none' and not exists (select 1 from ${schema.workspaces} w_appr where w_appr.id = ${schema.socialPosts.workspaceId} and w_appr.social_require_approval)))`;
}

/** Approval state a machine-made post (Auto Post, explainer, Short, content plan) starts in. */
export async function initialApprovalStatus(workspaceId: string): Promise<ApprovalStatus> {
  return (await workspaceRequiresApproval(workspaceId)) ? "pending" : "none";
}

/**
 * The approval state a post gets when a person saves it (composer, API).
 *   - Workspace requires approval: an approver's own save counts as their approval; anyone else's save makes it
 *     `pending` when they schedule / queue / publish it, and leaves a draft unsubmitted (`none`, or still `rejected`).
 *   - Workspace does not require approval: the composer's "Ask an approver" switch decides (pending / none).
 */
export async function approvalOnSave(input: {
  workspaceId: string;
  userId: string;
  submitting: boolean; // schedule / queue / publish (not a plain draft save)
  askApproval: boolean;
  previous?: string | null;
}): Promise<{ status: ApprovalStatus; approvedBy: string | null }> {
  const required = await workspaceRequiresApproval(input.workspaceId);
  if (required) {
    if (await memberCanApprove(input.userId, input.workspaceId)) return { status: "approved", approvedBy: input.userId };
    if (input.submitting || input.askApproval) return { status: "pending", approvedBy: null };
    return { status: input.previous === "rejected" ? "rejected" : "none", approvedBy: null };
  }
  return { status: input.askApproval ? "pending" : "none", approvedBy: null };
}

export async function logReview(row: {
  postId: string;
  workspaceId: string;
  decision: ReviewDecision;
  reviewerUserId?: string | null;
  viaToken?: boolean;
  reviewerName?: string | null;
  note?: string | null;
}): Promise<void> {
  await db.insert(schema.socialPostReviews).values({
    id: randomUUID(),
    postId: row.postId,
    workspaceId: row.workspaceId,
    reviewerUserId: row.reviewerUserId ?? null,
    viaToken: row.viaToken ?? false,
    reviewerName: row.reviewerName?.trim().slice(0, 80) || null,
    decision: row.decision,
    note: row.note?.trim().slice(0, 2000) || null,
  });
}

/**
 * Record an approver's decision on a post that is awaiting approval. Conditional on `pending`, so two approvers (or an
 * approver and the review link) cannot both decide. Returns false when the post is not awaiting approval.
 */
export async function decide(input: {
  workspaceId: string;
  postId: string;
  decision: "approved" | "changes_requested";
  reviewerUserId?: string | null;
  viaToken?: boolean;
  reviewerName?: string | null;
  note?: string | null;
}): Promise<boolean> {
  const rows = await db
    .update(schema.socialPosts)
    .set({
      approvalStatus: input.decision === "approved" ? "approved" : "rejected",
      approvedBy: input.decision === "approved" ? (input.reviewerUserId ?? null) : null,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.socialPosts.id, input.postId),
        eq(schema.socialPosts.workspaceId, input.workspaceId),
        eq(schema.socialPosts.approvalStatus, "pending"),
      ),
    )
    .returning({ id: schema.socialPosts.id, createdBy: schema.socialPosts.createdBy, text: schema.socialPosts.text });
  if (rows.length === 0) return false;
  await logReview({ ...input, decision: input.decision });
  if (rows[0].createdBy && rows[0].createdBy !== input.reviewerUserId) {
    await notify([rows[0].createdBy], {
      title: input.decision === "approved" ? "Post approved" : "Changes requested on your post",
      body: `${snippet(rows[0].text)}${input.note?.trim() ? ` — “${input.note.trim().slice(0, 140)}”` : ""}`,
      path: `/publish/compose?post=${input.postId}`,
      cta: "Open the post",
    });
  }
  return true;
}

/** Tell the workspace's approvers that a post is waiting (best effort, never throws). */
export async function notifyApprovers(workspaceId: string, postId: string, text: string, exceptUserId?: string | null) {
  const members = await db
    .select({ userId: schema.workspaceMembers.userId, role: schema.workspaceMembers.role, approver: schema.workspaceMembers.socialApprover })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId));
  const ids = members.filter((m) => (m.role === "owner" || m.role === "admin" || m.approver) && m.userId !== exceptUserId).map((m) => m.userId);
  await notify(ids, { title: "A post needs your approval", body: snippet(text), path: "/publish/review", cta: "Review it" });
}

function snippet(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 120 ? `${t.slice(0, 117)}…` : t || "(no text)";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Web push + email (SES) to each user. Failures are logged, never thrown — a notification must not undo a decision. */
async function notify(userIds: string[], msg: { title: string; body: string; path: string; cta: string }) {
  if (!userIds.length) return;
  // The self-test sets this so it never emails / pushes real members of the dev workspace.
  if (process.env.SOCIAL_NOTIFY_DISABLED === "1") return;
  try {
    const [{ sendPushToUser }, { sendEmail, simpleEmail }] = await Promise.all([import("@/lib/push"), import("@/lib/email")]);
    const base = (process.env.NEXT_PUBLIC_APP_URL || "https://www.clipwaltz.com").replace(/\/$/, "");
    const users = await db
      .select({ id: schema.user.id, email: schema.user.email })
      .from(schema.user)
      .where(inArray(schema.user.id, [...new Set(userIds)]));
    await Promise.all(
      users.map(async (u) => {
        await sendPushToUser(u.id, { title: msg.title, body: msg.body, url: msg.path, tag: `approval-${msg.path}` }).catch(() => 0);
        await sendEmail({
          to: u.email,
          subject: `${msg.title} — ClipWaltz`,
          html: simpleEmail(escapeHtml(msg.title), escapeHtml(msg.body), { label: msg.cta, url: `${base}${msg.path}` }),
          text: `${msg.title}\n\n${msg.body}\n\n${base}${msg.path}`,
        }).catch(() => false);
      }),
    );
  } catch (e) {
    console.warn("[social] approval notification failed:", (e as Error).message);
  }
}

/** A post's approval history, newest first, with reviewer names. */
export async function listReviews(postIds: string[]) {
  if (!postIds.length) return [];
  return db
    .select({
      postId: schema.socialPostReviews.postId,
      decision: schema.socialPostReviews.decision,
      note: schema.socialPostReviews.note,
      viaToken: schema.socialPostReviews.viaToken,
      reviewerName: schema.socialPostReviews.reviewerName,
      userName: schema.user.name,
      createdAt: schema.socialPostReviews.createdAt,
    })
    .from(schema.socialPostReviews)
    .leftJoin(schema.user, eq(schema.socialPostReviews.reviewerUserId, schema.user.id))
    .where(inArray(schema.socialPostReviews.postId, postIds))
    .orderBy(desc(schema.socialPostReviews.createdAt));
}
