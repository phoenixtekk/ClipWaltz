"use server";
import { randomBytes, randomUUID } from "crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { toResult } from "@/lib/action-result";
import { userCanAccessProject } from "@/lib/workspace";
import { copyObject, deleteObject, headObject } from "@/lib/storage";
import { requireApprover, requireSocial, socialAllowedFor } from "@/lib/social/access";
import { getSession } from "@/lib/auth";
import { aiAssist as runAiAssist, type AiLength, type AiMode } from "@/lib/social/ai";
import {
  createRule, deleteRule, duplicateRule, setRuleActive, updateRule, type RuleInput,
} from "@/lib/social/auto-post-rules";
import { normalizePreset, type PresetConfig } from "@/lib/social/auto-post-presets";
import { postReply } from "@/lib/social/comments";
import {
  deleteConnectionById, getConnectionById, setConnectionAiContext, setConnectionPaused, updateConnectionById,
} from "@/lib/social/connections";
import { listDestinations } from "@/lib/social/destinations";
import { commentsPull } from "@/lib/social/jobs";
import { socialMediaKey } from "@/lib/social/media";
import { checkAllConnections, type Health } from "@/lib/social/network-health";
import { pinterestAccessToken, pinterestBoards, type PinterestBoard } from "@/lib/social/oauth/pinterest";
import { assertPerNetworkMediaOwned, createPost, decideApproval, PostInputError } from "@/lib/social/posts";
import { publishPost, type PublishPostResult } from "@/lib/social/publish-post";
import { approvalOnSave, logReview, notifyApprovers } from "@/lib/social/approval";
import { refreshPostStatus, retryTargetNow } from "@/lib/social/retry-targets";
import { COMMENT_NETWORKS } from "@/lib/social/ui";
import { providerName } from "@/lib/social/ui-types";

// Server actions behind the /publish screens (P2). Each one re-checks the caller with requireSocial (feature flag,
// workspace membership and role) and scopes every read/write to that workspace — ids arriving here are untrusted.
// Errors come back as ActionResult (src/lib/action-result.ts) so the user sees the real message in production.

const touch = () => revalidatePath("/publish", "layout");

/** Is Social Publishing available to the signed-in user? (Drives the Publish buttons; no data.) */
export async function publishEnabled(): Promise<boolean> {
  const s = await getSession();
  return Boolean(s && socialAllowedFor(s.user.email));
}

// ─── Posts ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface SavePostInput {
  id?: string | null;
  text: string;
  link?: string | null;
  providers: string[];
  perNetwork?: Record<string, { text?: string }>;
  mediaIds?: string[];
  /** A ClipWaltz video to attach (copied into the post's media on save). */
  video?: { source: "render" | "export"; id: string } | null;
  scheduledAt?: string | null;
  /** draft = save; queue = Auto Post queue; schedule = at scheduledAt; publish = now. */
  mode: "draft" | "queue" | "schedule" | "publish";
  requireApproval?: boolean;
}

/** Copy a finished render/export into the workspace's social media (source "render"). Returns the media id. */
async function attachVideo(userId: string, workspaceId: string, v: { source: "render" | "export"; id: string }): Promise<string> {
  let key: string | null = null;
  let projectId: string | null = null;
  let mime = "video/mp4";
  let name = "clipwaltz.mp4";
  if (v.source === "render") {
    const [r] = await db
      .select({ key: schema.renders.outputKey, projectId: schema.renders.projectId, status: schema.renders.status, version: schema.renders.version })
      .from(schema.renders)
      .where(eq(schema.renders.id, v.id));
    if (r?.status === "done") {
      key = r.key;
      projectId = r.projectId;
      name = `clipwaltz-v${r.version}.mp4`;
    }
  } else {
    const [e] = await db
      .select({ key: schema.exportJobs.outputKey, projectId: schema.exportJobs.projectId, status: schema.exportJobs.status, format: schema.exportJobs.outputFormat })
      .from(schema.exportJobs)
      .where(eq(schema.exportJobs.id, v.id));
    if (e?.status === "completed") {
      key = e.key;
      projectId = e.projectId;
      if (e.format === "webm") {
        mime = "video/webm";
        name = "clipwaltz.webm";
      }
    }
  }
  if (!key || !projectId || !(await userCanAccessProject(userId, projectId))) throw new PostInputError("That video is not available.");
  const id = randomUUID();
  const dest = socialMediaKey(workspaceId, id);
  await copyObject(key, dest, mime);
  const size = await headObject(dest).then((h) => h.size, () => 0);
  await db.insert(schema.socialMedia).values({
    id, workspaceId, createdBy: userId, kind: "video", filename: name, mime, size, storageKey: dest, source: "render",
  });
  return id;
}

async function savePostImpl(input: SavePostInput): Promise<{ id: string; publish?: PublishPostResult; submitted?: boolean }> {
  const sc = await requireSocial(null, "editor");
  const scheduledAt = input.mode === "schedule" && input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (input.mode === "schedule") {
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) throw new PostInputError("Pick a date and time to schedule it.");
    if (scheduledAt.getTime() < Date.now() - 60_000) throw new PostInputError("That time has already passed.");
  }
  const status = input.mode === "queue" ? "queued" : input.mode === "schedule" ? "scheduled" : "draft";
  const mediaIds = [...(input.mediaIds ?? [])];
  if (input.video) mediaIds.push(await attachVideo(sc.userId, sc.workspaceId, input.video));

  let id: string;
  if (input.id) {
    // Editing: only posts that have not started publishing.
    const [p] = await db
      .select({ id: schema.socialPosts.id, status: schema.socialPosts.status, approvalStatus: schema.socialPosts.approvalStatus })
      .from(schema.socialPosts)
      .where(and(eq(schema.socialPosts.id, input.id), eq(schema.socialPosts.workspaceId, sc.workspaceId)));
    if (!p) throw new PostInputError("That post no longer exists.");
    if (!["draft", "queued", "scheduled", "failed"].includes(p.status)) throw new PostInputError("A post that is publishing or published can't be edited. Re-share it instead.");
    const text = (input.text ?? "").trim();
    if (!text) throw new PostInputError("A post needs text.");
    const mine = new Set((await listDestinations(sc.workspaceId)).map((d) => d.key));
    const providers = [...new Set(input.providers)].filter(Boolean);
    if (providers.length === 0) throw new PostInputError("Choose at least one channel.");
    if (providers.some((k) => !mine.has(k))) throw new PostInputError("One of those channels is not connected to this workspace.");
    const link = input.link?.trim() || null;
    if (link && !/^https?:\/\//i.test(link)) throw new PostInputError("The link must start with http:// or https://.");
    await assertPerNetworkMediaOwned(sc.workspaceId, input.perNetwork);
    // Media: keep what is listed, release the rest, attach new uploads (must be this workspace's, unattached).
    const current = await db.select({ id: schema.socialMedia.id }).from(schema.socialMedia).where(eq(schema.socialMedia.postId, p.id));
    const keep = new Set(mediaIds);
    const released = current.filter((m) => !keep.has(m.id)).map((m) => m.id);
    if (released.length) await db.update(schema.socialMedia).set({ postId: null }).where(inArray(schema.socialMedia.id, released));
    const fresh = mediaIds.filter((m) => !current.some((c) => c.id === m));
    if (fresh.length) {
      const owned = await db
        .update(schema.socialMedia)
        .set({ postId: p.id })
        .where(and(eq(schema.socialMedia.workspaceId, sc.workspaceId), inArray(schema.socialMedia.id, fresh), isNull(schema.socialMedia.postId)))
        .returning({ id: schema.socialMedia.id });
      if (owned.length !== fresh.length) throw new PostInputError("Some media is missing or attached to another post.");
    }
    // G9: any edit resets approval — the server decides the new state (approvalOnSave), not the client.
    const approval = await approvalOnSave({
      workspaceId: sc.workspaceId,
      userId: sc.userId,
      submitting: input.mode !== "draft",
      askApproval: input.requireApproval === true,
      previous: p.approvalStatus,
    });
    await db
      .update(schema.socialPosts)
      .set({
        text, link, providers: providers.join(","), perNetwork: input.perNetwork ?? null, status, scheduledAt,
        approvalStatus: approval.status, approvedBy: approval.approvedBy, approvedAt: approval.approvedBy ? new Date() : null,
        warnings: null, updatedAt: new Date(),
      })
      .where(eq(schema.socialPosts.id, p.id));
    if (approval.status === "pending" && p.approvalStatus !== "pending") {
      await logReview({ postId: p.id, workspaceId: sc.workspaceId, decision: "submitted", reviewerUserId: sc.userId });
      await notifyApprovers(sc.workspaceId, p.id, text, sc.userId);
    }
    id = p.id;
  } else {
    id = await createPost(sc.workspaceId, sc.userId, {
      text: input.text,
      link: input.link ?? null,
      providers: input.providers,
      perNetwork: input.perNetwork,
      mediaIds,
      scheduledAt,
      status,
      requireApproval: input.requireApproval === true,
      submitForApproval: input.mode !== "draft",
      renderId: input.video?.source === "render" ? input.video.id : null,
      exportId: input.video?.source === "export" ? input.video.id : null,
    });
  }

  touch();
  if (input.mode === "publish") {
    // G9: a post that went to review is not published now; it goes out when an approver approves and it is published.
    const [saved] = await db.select({ a: schema.socialPosts.approvalStatus }).from(schema.socialPosts).where(eq(schema.socialPosts.id, id));
    if (saved?.a === "pending") return { id, submitted: true };
    const r = await publishPost(id);
    if (!r.ok) throw new PostInputError(r.error ?? "Publishing could not start.");
    return { id, publish: r };
  }
  const [saved] = await db.select({ a: schema.socialPosts.approvalStatus }).from(schema.socialPosts).where(eq(schema.socialPosts.id, id));
  return { id, submitted: saved?.a === "pending" };
}
export async function savePost(input: SavePostInput) { return toResult(() => savePostImpl(input)); }

async function ownedPost(workspaceId: string, id: string) {
  const [p] = await db.select().from(schema.socialPosts).where(and(eq(schema.socialPosts.id, id), eq(schema.socialPosts.workspaceId, workspaceId)));
  if (!p) throw new Error("That post no longer exists.");
  return p;
}

async function deletePostImpl(id: string) {
  const sc = await requireSocial(null, "editor");
  const p = await ownedPost(sc.workspaceId, id);
  if (p.status === "publishing") throw new Error("Wait until it has finished publishing.");
  const media = await db.select({ key: schema.socialMedia.storageKey, id: schema.socialMedia.id }).from(schema.socialMedia).where(eq(schema.socialMedia.postId, id));
  await db.delete(schema.socialPosts).where(eq(schema.socialPosts.id, id));
  if (media.length) {
    await db.delete(schema.socialMedia).where(inArray(schema.socialMedia.id, media.map((m) => m.id)));
    await Promise.all(media.map((m) => deleteObject(m.key).catch(() => {})));
  }
  touch();
}
export async function deletePost(id: string) { return toResult(() => deletePostImpl(id)); }

async function setFavoriteImpl(id: string, favorite: boolean) {
  const sc = await requireSocial(null, "editor");
  await ownedPost(sc.workspaceId, id);
  await db.update(schema.socialPosts).set({ favorite, updatedAt: new Date() }).where(eq(schema.socialPosts.id, id));
  touch();
}
export async function setFavorite(id: string, favorite: boolean) { return toResult(() => setFavoriteImpl(id, favorite)); }

async function reschedulePostImpl(id: string, iso: string) {
  const sc = await requireSocial(null, "editor");
  const p = await ownedPost(sc.workspaceId, id);
  if (!["draft", "queued", "scheduled", "failed"].includes(p.status)) throw new Error("Only posts that haven't been published can be moved.");
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) throw new Error("Invalid time.");
  if (at.getTime() < Date.now() - 60_000) throw new Error("That time has already passed.");
  // A planned draft (G14 "Plan a week") moves as a draft — dragging it never sends it out.
  await db
    .update(schema.socialPosts)
    .set({ scheduledAt: at, status: p.status === "draft" ? "draft" : "scheduled", updatedAt: new Date() })
    .where(eq(schema.socialPosts.id, id));
  touch();
}
export async function reschedulePost(id: string, iso: string) { return toResult(() => reschedulePostImpl(id, iso)); }

async function unschedulePostImpl(id: string) {
  const sc = await requireSocial(null, "editor");
  const p = await ownedPost(sc.workspaceId, id);
  if (p.status !== "scheduled" && p.status !== "queued") throw new Error("That post isn't scheduled.");
  await db.update(schema.socialPosts).set({ scheduledAt: null, status: "draft", updatedAt: new Date() }).where(eq(schema.socialPosts.id, id));
  touch();
}
export async function unschedulePost(id: string) { return toResult(() => unschedulePostImpl(id)); }

/** Re-share: clone a post (text, link, channels, per-network copy and media) into a fresh draft. */
async function duplicatePostImpl(id: string): Promise<string> {
  const sc = await requireSocial(null, "editor");
  const p = await ownedPost(sc.workspaceId, id);
  const media = await db.select().from(schema.socialMedia).where(eq(schema.socialMedia.postId, id));
  const newId = randomUUID();
  await db.insert(schema.socialPosts).values({
    id: newId, workspaceId: sc.workspaceId, createdBy: sc.userId, text: p.text, link: p.link, status: "draft",
    providers: p.providers, perNetwork: p.perNetwork, renderId: p.renderId, exportId: p.exportId,
  });
  for (const m of media) {
    const mid = randomUUID();
    const key = socialMediaKey(sc.workspaceId, mid);
    await copyObject(m.storageKey, key, m.mime);
    await db.insert(schema.socialMedia).values({
      id: mid, workspaceId: sc.workspaceId, createdBy: sc.userId, postId: newId, kind: m.kind, filename: m.filename,
      mime: m.mime, size: m.size, storageKey: key, source: m.source,
    });
  }
  touch();
  return newId;
}
export async function duplicatePost(id: string) { return toResult(() => duplicatePostImpl(id)); }

async function setShareLinkImpl(id: string, on: boolean): Promise<string | null> {
  const sc = await requireSocial(null, "editor");
  await ownedPost(sc.workspaceId, id);
  const token = on ? randomBytes(18).toString("base64url") : null;
  await db.update(schema.socialPosts).set({ shareToken: token, updatedAt: new Date() }).where(eq(schema.socialPosts.id, id));
  touch();
  return token;
}
export async function setShareLink(id: string, on: boolean) { return toResult(() => setShareLinkImpl(id, on)); }

async function publishNowImpl(id: string): Promise<PublishPostResult> {
  const sc = await requireSocial(null, "editor");
  await ownedPost(sc.workspaceId, id);
  const r = await publishPost(id);
  touch();
  if (!r.ok) throw new Error(r.error ?? "Publishing could not start.");
  return r;
}
export async function publishNow(id: string) { return toResult(() => publishNowImpl(id)); }

async function retryTargetImpl(postId: string, targetId: string) {
  const sc = await requireSocial(null, "editor");
  await ownedPost(sc.workspaceId, postId);
  if (!(await retryTargetNow(targetId, postId))) throw new Error("Only a failed destination can be retried.");
  touch();
}
export async function retryTarget(postId: string, targetId: string) { return toResult(() => retryTargetImpl(postId, targetId)); }

async function decideImpl(id: string, decision: "approved" | "rejected", note?: string) {
  const sc = await requireApprover(null);
  if (decision === "rejected" && !note?.trim()) throw new Error("Say what needs to change, so the author knows what to fix.");
  if (!(await decideApproval(sc.workspaceId, id, sc.userId, decision, note ?? null))) throw new Error("That post is not awaiting approval.");
  touch();
}
/** G9: approve, or request changes (with a note). "rejected" is shown as "Changes requested". */
export async function decidePost(id: string, decision: "approved" | "rejected", note?: string) {
  return toResult(() => decideImpl(id, decision, note));
}

async function submitForApprovalImpl(id: string) {
  const sc = await requireSocial(null, "editor");
  const p = await ownedPost(sc.workspaceId, id);
  if (!["draft", "queued", "scheduled", "failed"].includes(p.status)) throw new Error("Only posts that haven't gone out can be sent for approval.");
  if (p.approvalStatus === "pending") throw new Error("It is already waiting for approval.");
  await db
    .update(schema.socialPosts)
    .set({ approvalStatus: "pending", approvedBy: null, approvedAt: null, updatedAt: new Date() })
    .where(eq(schema.socialPosts.id, id));
  await logReview({ postId: id, workspaceId: sc.workspaceId, decision: "submitted", reviewerUserId: sc.userId });
  await notifyApprovers(sc.workspaceId, id, p.text, sc.userId);
  touch();
}
/** G9: send a saved post for approval. */
export async function submitPostForApproval(id: string) { return toResult(() => submitForApprovalImpl(id)); }

async function deleteMediaImpl(id: string) {
  const sc = await requireSocial(null, "editor");
  const [m] = await db
    .select()
    .from(schema.socialMedia)
    .where(and(eq(schema.socialMedia.id, id), eq(schema.socialMedia.workspaceId, sc.workspaceId), isNull(schema.socialMedia.postId)));
  if (!m) return;
  await db.delete(schema.socialMedia).where(eq(schema.socialMedia.id, id));
  await deleteObject(m.storageKey).catch(() => {});
}
/** Remove an uploaded file that is not (yet) attached to a post. */
export async function deleteUnattachedMedia(id: string) { return toResult(() => deleteMediaImpl(id)); }

// ─── AI copy (Ollama AI Box, 0 credits — ADR-0011) ─────────────────────────────────────────────────────────

const AI_MODES: AiMode[] = ["write", "improve", "shorten", "hashtags", "ideas"];
async function aiAssistImpl(mode: AiMode, input: string, length: AiLength = "standard"): Promise<string> {
  await requireSocial(null, "editor");
  if (!AI_MODES.includes(mode)) throw new Error("Unknown AI action.");
  const text = (input ?? "").trim().slice(0, 8000);
  if (!text) throw new Error(mode === "write" || mode === "ideas" ? "Describe what the post is about first." : "Write some text first.");
  try {
    return await runAiAssist(mode, text, length);
  } catch (e) {
    console.error("[social] ai assist:", (e as Error).message);
    throw new Error("The AI writer is not reachable right now — try again in a minute.");
  }
}
export async function aiAssist(mode: AiMode, input: string, length?: AiLength) { return toResult(() => aiAssistImpl(mode, input, length)); }

// ─── Channels (Networks page) ───────────────────────────────────────────────────────────────────────────────

async function setPausedImpl(id: string, paused: boolean) {
  const sc = await requireSocial(null, "admin");
  if (!(await setConnectionPaused(id, paused, sc.workspaceId))) throw new Error("That channel no longer exists.");
  touch();
}
export async function setChannelPaused(id: string, paused: boolean) { return toResult(() => setPausedImpl(id, paused)); }

async function disconnectImpl(id: string) {
  const sc = await requireSocial(null, "admin");
  if (!(await deleteConnectionById(id, sc.workspaceId))) throw new Error("That channel no longer exists.");
  touch();
}
export async function disconnectChannel(id: string) { return toResult(() => disconnectImpl(id)); }

async function setBriefImpl(id: string, brief: string) {
  const sc = await requireSocial(null, "admin");
  await setConnectionAiContext(id, brief.trim() || null, sc.workspaceId);
  touch();
}
export async function setChannelBrief(id: string, brief: string) { return toResult(() => setBriefImpl(id, brief)); }

async function checkHealthImpl(): Promise<Health[]> {
  const sc = await requireSocial(null, "viewer");
  return checkAllConnections(sc.workspaceId);
}
export async function checkChannelHealth() { return toResult(() => checkHealthImpl()); }

async function pinterestBoardsImpl(id: string): Promise<PinterestBoard[]> {
  const sc = await requireSocial(null, "admin");
  const c = await getConnectionById(id, sc.workspaceId);
  if (!c || c.provider !== "pinterest") throw new Error("That Pinterest channel no longer exists.");
  const t = await pinterestAccessToken(c.accessToken);
  if (t.updated) await updateConnectionById(id, { accessToken: t.updated }, sc.workspaceId);
  if (!t.token) throw new Error("Pinterest refused the saved login — reconnect Pinterest.");
  return pinterestBoards(t.token);
}
export async function listPinterestBoards(id: string) { return toResult(() => pinterestBoardsImpl(id)); }

async function choosePinterestBoardImpl(id: string, boardId: string) {
  const sc = await requireSocial(null, "admin");
  const boards = await pinterestBoardsImpl(id);
  const b = boards.find((x) => x.id === boardId);
  if (!b) throw new Error("That board was not found on the account.");
  const c = await getConnectionById(id, sc.workspaceId);
  const user = (c?.displayName ?? "").split(" · ")[0];
  await updateConnectionById(id, { externalId: b.id, displayName: user.startsWith("@") ? `${user} · ${b.name}` : b.name }, sc.workspaceId);
  touch();
}
export async function choosePinterestBoard(id: string, boardId: string) { return toResult(() => choosePinterestBoardImpl(id, boardId)); }

// ─── Auto Post rules + presets ─────────────────────────────────────────────────────────────────────────────

async function ownDestinations(workspaceId: string, keys: string[] | undefined) {
  const mine = new Set((await listDestinations(workspaceId)).map((d) => d.key));
  if ((keys ?? []).some((k) => !mine.has(k))) throw new Error("One of those channels is not connected to this workspace.");
}

async function saveRuleImpl(id: string | null, body: RuleInput): Promise<string> {
  const sc = await requireSocial(null, "editor");
  await ownDestinations(sc.workspaceId, body.providers);
  if (!body.providers?.length) throw new Error("Choose at least one channel for the rule.");
  if (id) {
    if (!(await updateRule(id, sc.workspaceId, body))) throw new Error("That rule no longer exists.");
  } else {
    id = await createRule(sc.workspaceId, body, sc.userId);
  }
  touch();
  return id;
}
export async function saveRule(id: string | null, body: RuleInput) { return toResult(() => saveRuleImpl(id, body)); }

async function ruleActiveImpl(id: string, active: boolean) {
  const sc = await requireSocial(null, "editor");
  if (!(await setRuleActive(id, sc.workspaceId, active))) throw new Error("That rule no longer exists.");
  touch();
}
export async function setRuleOn(id: string, active: boolean) { return toResult(() => ruleActiveImpl(id, active)); }

async function deleteRuleImpl(id: string) {
  const sc = await requireSocial(null, "editor");
  await deleteRule(id, sc.workspaceId);
  touch();
}
export async function removeRule(id: string) { return toResult(() => deleteRuleImpl(id)); }

async function duplicateRuleImpl(id: string) {
  const sc = await requireSocial(null, "editor");
  const n = await duplicateRule(id, sc.workspaceId, sc.userId);
  if (!n) throw new Error("That rule no longer exists.");
  touch();
  return n;
}
export async function copyRule(id: string) { return toResult(() => duplicateRuleImpl(id)); }

async function savePresetImpl(name: string, config: PresetConfig): Promise<string> {
  const sc = await requireSocial(null, "editor");
  const id = randomUUID();
  await db.insert(schema.socialAutoPresets).values({
    id, workspaceId: sc.workspaceId, createdBy: sc.userId, name: name.trim().slice(0, 60) || "Untitled preset", ...normalizePreset(config),
  });
  touch();
  return id;
}
export async function savePreset(name: string, config: PresetConfig) { return toResult(() => savePresetImpl(name, config)); }

async function deletePresetImpl(id: string) {
  const sc = await requireSocial(null, "editor");
  await db.delete(schema.socialAutoPresets).where(and(eq(schema.socialAutoPresets.id, id), eq(schema.socialAutoPresets.workspaceId, sc.workspaceId)));
  touch();
}
export async function deletePreset(id: string) { return toResult(() => deletePresetImpl(id)); }

// ─── Comments inbox ────────────────────────────────────────────────────────────────────────────────────────

async function ownedTarget(workspaceId: string, targetId: string) {
  const [row] = await db
    .select({ t: schema.socialPostTargets })
    .from(schema.socialPostTargets)
    .innerJoin(schema.socialPosts, eq(schema.socialPostTargets.postId, schema.socialPosts.id))
    .where(and(eq(schema.socialPostTargets.id, targetId), eq(schema.socialPosts.workspaceId, workspaceId)));
  if (!row) throw new Error("That post no longer exists.");
  return row.t;
}

async function refreshCommentsImpl(targetId: string): Promise<number> {
  const sc = await requireSocial(null, "viewer");
  const t = await ownedTarget(sc.workspaceId, targetId);
  if (!COMMENT_NETWORKS.includes(t.provider)) throw new Error("Comments can't be read from that network yet.");
  const r = await commentsPull(targetId);
  touch();
  return r.count;
}
export async function refreshComments(targetId: string) { return toResult(() => refreshCommentsImpl(targetId)); }

async function replyImpl(targetId: string, commentId: string, text: string) {
  const sc = await requireSocial(null, "editor");
  const t = await ownedTarget(sc.workspaceId, targetId);
  const body = text.trim().slice(0, 2000);
  if (!body) throw new Error("Write a reply first.");
  const c = (t.comments ?? []).find((x) => x.id === commentId);
  if (!c) throw new Error("That comment is no longer in the inbox — refresh it.");
  const conn = t.connectionId ? await getConnectionById(t.connectionId, sc.workspaceId) : null;
  const r = await postReply(t.provider, { commentId: c.id, ref: c.ref, text: body }, conn);
  if (!r.ok) throw new Error(r.error || "The network refused the reply.");
  await commentsPull(targetId).catch(() => null);
  touch();
}
export async function replyToComment(targetId: string, commentId: string, text: string) { return toResult(() => replyImpl(targetId, commentId, text)); }

// ─── Post by hand ──────────────────────────────────────────────────────────────────────────────────────────

async function markPostedImpl(targetId: string, url: string) {
  const sc = await requireSocial(null, "editor");
  const t = await ownedTarget(sc.workspaceId, targetId);
  if (t.status !== "handoff") throw new Error("That one is already marked as posted.");
  const u = url.trim();
  if (u && !/^https?:\/\//i.test(u)) throw new Error("The link must start with http:// or https://.");
  await db
    .update(schema.socialPostTargets)
    .set({ status: "published", url: u || null, error: null, updatedAt: new Date() })
    .where(eq(schema.socialPostTargets.id, targetId));
  await refreshPostStatus(t.postId);
  touch();
}
export async function markHandoffPosted(targetId: string, url: string) { return toResult(() => markPostedImpl(targetId, url)); }

// ─── G6 suggested times · G8 engagement estimate · G4 copy for each network ────────────────────────────────

async function suggestedTimesImpl(keys: string[]) {
  const sc = await requireSocial(null, "viewer");
  const { suggestTimes } = await import("@/lib/social/best-time");
  const providers = [...new Set(keys.map((k) => String(k).split("#")[0]).filter(Boolean))].slice(0, 30);
  return suggestTimes(sc.workspaceId, providers);
}
/** G6: suggested slots per network (personalised from this workspace's results, else general guidance). */
export async function suggestedTimes(keys: string[]) { return toResult(() => suggestedTimesImpl(keys)); }

async function scoreCalibrationImpl() {
  const sc = await requireSocial(null, "viewer");
  const { getCalibration } = await import("@/lib/social/score");
  return getCalibration(sc.workspaceId);
}
/** G8: is the 0–100 estimate backed by this workspace's own history (posts, Spearman rho)? */
export async function scoreCalibration() { return toResult(() => scoreCalibrationImpl()); }

async function critiqueImpl(text: string, keys: string[]) {
  await requireSocial(null, "editor");
  const t = (text ?? "").trim();
  if (!t) throw new Error("Write the post first.");
  const { aiCritique } = await import("@/lib/social/score");
  try {
    return await aiCritique(t, [...new Set(keys.map((k) => providerName(String(k).split("#")[0])))]);
  } catch (e) {
    console.error("[social] critique:", (e as Error).message);
    throw new Error("The AI reviewer is not reachable right now — try again in a minute.");
  }
}
/** G8: an AI opinion on the post (0 credits). */
export async function critiquePost(text: string, keys: string[]) { return toResult(() => critiqueImpl(text, keys)); }

async function copyForNetworksImpl(input: { brief: string; keys: string[]; mediaIds?: string[]; video?: boolean; link?: string | null }) {
  const sc = await requireSocial(null, "editor");
  const dests = (await listDestinations(sc.workspaceId)).filter((d) => input.keys.includes(d.key));
  if (!dests.length) throw new Error("Tick at least one channel first.");
  const conns = await db
    .select({ id: schema.socialConnections.id, ctx: schema.socialConnections.aiContext })
    .from(schema.socialConnections)
    .where(eq(schema.socialConnections.workspaceId, sc.workspaceId));
  const ctx = new Map(conns.map((c) => [c.id, c.ctx]));
  const media = input.mediaIds?.length
    ? await db
        .select({ id: schema.socialMedia.id, kind: schema.socialMedia.kind, filename: schema.socialMedia.filename, mime: schema.socialMedia.mime, size: schema.socialMedia.size })
        .from(schema.socialMedia)
        .where(and(eq(schema.socialMedia.workspaceId, sc.workspaceId), inArray(schema.socialMedia.id, input.mediaIds.slice(0, 20))))
    : [];
  const all = [
    ...media.map((m) => ({ ...m, kind: (m.kind === "video" ? "video" : "image") as "image" | "video" })),
    ...(input.video ? [{ id: "video", kind: "video" as const, filename: "video.mp4", mime: "video/mp4", size: 0 }] : []),
  ];
  const { copyForNetworks } = await import("@/lib/social/copy");
  try {
    return await copyForNetworks({
      brief: input.brief,
      link: input.link ?? null,
      media: all,
      targets: dests.slice(0, 12).map((d) => ({ key: d.key, provider: d.provider, label: d.label, context: d.connectionId ? ctx.get(d.connectionId) : null })),
    });
  } catch (e) {
    if ((e as Error).message.startsWith("Write a line")) throw e;
    console.error("[social] copy for networks:", (e as Error).message);
    throw new Error("The AI writer is not reachable right now — try again in a minute.");
  }
}
/** G4: one click — a caption + hashtags written for each selected network, pre-flight checked. 0 credits. */
export async function writeCopyForNetworks(input: { brief: string; keys: string[]; mediaIds?: string[]; video?: boolean; link?: string | null }) {
  return toResult(() => copyForNetworksImpl(input));
}

// ─── G14 Plan a week ───────────────────────────────────────────────────────────────────────────────────────

export interface PlanRequest {
  brief: string;
  days: number;
  perDay: number;
  angles: string[];
  keys: string[];
  autoImage: boolean;
  startDate?: string | null;
}

async function planKeys(workspaceId: string, keys: string[]) {
  const dests = (await listDestinations(workspaceId)).filter((d) => d.configured);
  const mine = new Map(dests.map((d) => [d.key, d.provider]));
  const ks = [...new Set(keys)].filter((k) => mine.has(k));
  if (!ks.length) throw new Error("Choose at least one connected channel.");
  if (ks.length !== new Set(keys).size) throw new Error("One of those channels is not connected to this workspace.");
  return { keys: ks, providers: [...new Set(ks.map((k) => mine.get(k)!))] };
}

async function buildPlanImpl(req: PlanRequest) {
  const sc = await requireSocial(null, "editor");
  const brief = (req.brief ?? "").trim();
  if (brief.length < 10) throw new Error("Describe what the week is about (a sentence or two).");
  const { keys, providers } = await planKeys(sc.workspaceId, req.keys);
  const { ANGLE_KEYS, buildPlan } = await import("@/lib/social/content-plan");
  const angles = req.angles.filter((a): a is (typeof ANGLE_KEYS)[number] => (ANGLE_KEYS as string[]).includes(a));
  try {
    return await buildPlan(sc.workspaceId, {
      brief, days: Number(req.days) || 7, perDay: Number(req.perDay) || 1, angles, keys, providers, autoImage: Boolean(req.autoImage), startDate: req.startDate ?? null,
    });
  } catch (e) {
    console.error("[social] plan:", (e as Error).message);
    throw new Error("The AI writer is not reachable right now — try again in a minute.");
  }
}
/** G14: write a plan (nothing saved, 0 credits). */
export async function buildContentPlan(req: PlanRequest) { return toResult(() => buildPlanImpl(req)); }

async function savePlanImpl(input: { drafts: { angle: string; text: string; at: string }[]; keys: string[]; autoImage: boolean; confirmCredits: number }) {
  const sc = await requireSocial(null, "editor");
  const { keys } = await planKeys(sc.workspaceId, input.keys);
  const { ANGLE_KEYS, MAX_PLAN_POSTS, planCredits, savePlan } = await import("@/lib/social/content-plan");
  const drafts = (input.drafts ?? [])
    .filter((d) => typeof d.text === "string" && d.text.trim() && !Number.isNaN(new Date(d.at).getTime()))
    .map((d) => ({ angle: ((ANGLE_KEYS as string[]).includes(d.angle) ? d.angle : "educational") as (typeof ANGLE_KEYS)[number], text: d.text, at: d.at }));
  if (!drafts.length) throw new Error("There are no drafts to add.");
  if (drafts.length > MAX_PLAN_POSTS) throw new Error(`A plan can hold at most ${MAX_PLAN_POSTS} posts.`);
  // The total the user confirmed must be what the server computes — no GPU work is set up without that.
  const credits = planCredits(drafts.length, Boolean(input.autoImage));
  if (credits !== Number(input.confirmCredits)) throw new Error(`Confirm the total first: ${credits} credits.`);
  const r = await savePlan(sc.workspaceId, sc.userId, drafts, keys, Boolean(input.autoImage));
  touch();
  return r;
}
/** G14: save the confirmed plan as drafts on the calendar. */
export async function saveContentPlan(input: { drafts: { angle: string; text: string; at: string }[]; keys: string[]; autoImage: boolean; confirmCredits: number }) {
  return toResult(() => savePlanImpl(input));
}
