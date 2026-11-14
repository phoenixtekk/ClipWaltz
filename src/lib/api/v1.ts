import "server-only";
import { randomUUID } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, finishRequest, authenticateApi, requireScope, type ApiContext } from "@/lib/api-keys";
import { NotEnoughCredits } from "@/lib/credits-ledger";
import { IMAGE_COST } from "@/lib/credits";
import { createImageJob } from "@/lib/image-ad/jobs";
import { designImages, pictureBytes } from "@/lib/image-ad/designs";
import type { ImageAdData } from "@/lib/image-ad/types";
import { socialAllowedFor } from "@/lib/social/access";
import { listDestinations } from "@/lib/social/destinations";
import { createMedia, createPost, getPost, listPosts, PostInputError } from "@/lib/social/posts";
import { publishPost } from "@/lib/social/publish-post";
import { IMAGE_FORMATS, IMAGE_STYLES } from "../../../worker/image/presets.mjs";

// G12 public API v1 + G13 MCP: one set of operations, two front doors (src/app/api/v1/** and src/app/mcp/route.ts).
// Every operation takes the authenticated ApiContext (src/lib/api-keys.ts) and works ONLY inside the key's workspace —
// ids from another workspace are reported as not found (404), never acted on.
//
// Social endpoints additionally obey the Social Publishing flag (SOCIAL_PUBLISHING_ENABLED; while it is off only
// ADMIN_EMAILS accounts may publish) — the key acts as its creator, so the creator must be allowed.

export const API_VERSION = "1.0.0";
const ID = /^[a-f0-9-]{36}$/i;

function needSocial(ctx: ApiContext) {
  if (!socialAllowedFor(ctx.email)) throw new ApiError(403, "not_available", "Social publishing is not available on this account yet.");
}

function asDate(v: unknown, field: string): Date | null {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new ApiError(400, "bad_request", `\`${field}\` must be an ISO 8601 date-time.`);
  return d;
}

// ─── Read ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function apiMe(ctx: ApiContext) {
  const [w] = await db.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId));
  return { workspace: { id: ctx.workspaceId, name: w?.name ?? "" }, scopes: ctx.scopes, acting_role: ctx.role, api_version: API_VERSION };
}

export async function apiListChannels(ctx: ApiContext) {
  requireScope(ctx, "read");
  needSocial(ctx);
  const dests = await listDestinations(ctx.workspaceId);
  return {
    channels: dests
      .filter((d) => d.configured)
      .map((d) => ({ key: d.key, provider: d.provider, label: d.label, paused: Boolean(d.paused) })),
  };
}

function postView(p: typeof schema.socialPosts.$inferSelect) {
  return {
    id: p.id,
    text: p.text,
    link: p.link,
    status: p.status,
    approval: p.approvalStatus,
    channels: p.providers ? p.providers.split(",").filter(Boolean) : [],
    scheduled_at: p.scheduledAt?.toISOString() ?? null,
    published_at: p.publishedAt?.toISOString() ?? null,
    created_at: p.createdAt.toISOString(),
  };
}

export async function apiListPosts(ctx: ApiContext, limit: number) {
  requireScope(ctx, "read");
  needSocial(ctx);
  const rows = await listPosts(ctx.workspaceId, Math.min(Math.max(Number(limit) || 50, 1), 100));
  return { posts: rows.map(postView) };
}

export async function apiGetPost(ctx: ApiContext, id: string) {
  requireScope(ctx, "read");
  needSocial(ctx);
  if (!ID.test(id)) throw new ApiError(404, "not_found", "Post not found.");
  const p = await getPost(ctx.workspaceId, id);
  if (!p) throw new ApiError(404, "not_found", "Post not found.");
  return {
    ...postView(p),
    targets: p.targets.map((t) => ({
      channel: `${t.provider}${t.connectionId ? `#${t.connectionId}` : ""}`,
      label: t.label,
      status: t.status,
      url: t.url ?? null,
      error: t.error ?? null,
      updated_at: t.updatedAt.toISOString(),
    })),
  };
}

// ─── Publish scope ──────────────────────────────────────────────────────────────────────────────────────────

export interface ApiPostBody {
  text?: unknown;
  link?: unknown;
  channels?: unknown;
  media_ids?: unknown;
  scheduled_at?: unknown;
  /** draft (default) | queue | schedule | publish */
  mode?: unknown;
  require_approval?: unknown;
}

export async function apiCreatePost(ctx: ApiContext, b: ApiPostBody) {
  requireScope(ctx, "publish");
  needSocial(ctx);
  const mode = typeof b.mode === "string" ? b.mode : b.scheduled_at ? "schedule" : "draft";
  if (!["draft", "queue", "schedule", "publish"].includes(mode)) throw new ApiError(400, "bad_request", "`mode` must be draft, queue, schedule or publish.");
  const scheduledAt = asDate(b.scheduled_at, "scheduled_at");
  if (mode === "schedule") {
    if (!scheduledAt) throw new ApiError(400, "bad_request", "`scheduled_at` is required for mode schedule.");
    if (scheduledAt.getTime() < Date.now() - 60_000) throw new ApiError(400, "bad_request", "`scheduled_at` is in the past.");
  }
  try {
    const id = await createPost(ctx.workspaceId, ctx.userId, {
      text: String(b.text ?? ""),
      link: typeof b.link === "string" ? b.link : null,
      providers: Array.isArray(b.channels) ? b.channels.map(String) : [],
      mediaIds: Array.isArray(b.media_ids) ? b.media_ids.map(String) : [],
      scheduledAt: mode === "schedule" ? scheduledAt : null,
      status: mode === "queue" ? "queued" : mode === "schedule" ? "scheduled" : "draft",
      requireApproval: b.require_approval === true,
      submitForApproval: mode !== "draft",
    });
    let publish: { ok: boolean; status: string; error?: string } | null = null;
    if (mode === "publish") {
      const [saved] = await db.select({ a: schema.socialPosts.approvalStatus }).from(schema.socialPosts).where(eq(schema.socialPosts.id, id));
      if (saved?.a !== "pending") {
        const r = await publishPost(id);
        publish = { ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) };
      }
    }
    const view = await apiGetPost({ ...ctx, scopes: [...new Set([...ctx.scopes, "read" as const])] }, id);
    return { ...view, ...(publish ? { publish } : {}) };
  } catch (e) {
    if (e instanceof PostInputError) throw new ApiError(400, "bad_request", e.message);
    throw e;
  }
}

/** Schedule (or re-schedule) a post that has not started publishing. */
export async function apiSchedulePost(ctx: ApiContext, id: string, at: unknown) {
  requireScope(ctx, "publish");
  needSocial(ctx);
  if (!ID.test(id)) throw new ApiError(404, "not_found", "Post not found.");
  const when = asDate(at, "scheduled_at");
  if (!when) throw new ApiError(400, "bad_request", "`scheduled_at` is required.");
  if (when.getTime() < Date.now() - 60_000) throw new ApiError(400, "bad_request", "`scheduled_at` is in the past.");
  const [p] = await db
    .select({ id: schema.socialPosts.id, status: schema.socialPosts.status, approval: schema.socialPosts.approvalStatus })
    .from(schema.socialPosts)
    .where(and(eq(schema.socialPosts.id, id), eq(schema.socialPosts.workspaceId, ctx.workspaceId)));
  if (!p) throw new ApiError(404, "not_found", "Post not found.");
  if (!["draft", "queued", "scheduled", "failed"].includes(p.status)) throw new ApiError(409, "conflict", "A post that is publishing or published can't be rescheduled.");
  await db.update(schema.socialPosts).set({ status: "scheduled", scheduledAt: when, updatedAt: new Date() }).where(eq(schema.socialPosts.id, id));
  return apiGetPost({ ...ctx, scopes: [...new Set([...ctx.scopes, "read" as const])] }, id);
}

export async function apiUploadMedia(ctx: ApiContext, file: File | null) {
  requireScope(ctx, "publish");
  needSocial(ctx);
  if (!file || typeof file === "string") throw new ApiError(400, "bad_request", "Send the file as multipart/form-data field `file`.");
  try {
    const m = await createMedia(ctx.workspaceId, ctx.userId, { name: file.name || "upload", type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return { id: m.id, kind: m.kind };
  } catch (e) {
    if (e instanceof PostInputError) throw new ApiError(400, "bad_request", e.message);
    throw e;
  }
}

export async function apiListMedia(ctx: ApiContext) {
  requireScope(ctx, "read");
  needSocial(ctx);
  const rows = await db
    .select({ id: schema.socialMedia.id, kind: schema.socialMedia.kind, filename: schema.socialMedia.filename, size: schema.socialMedia.size, postId: schema.socialMedia.postId, createdAt: schema.socialMedia.createdAt })
    .from(schema.socialMedia)
    .where(eq(schema.socialMedia.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.socialMedia.createdAt))
    .limit(100);
  return { media: rows.map((m) => ({ id: m.id, kind: m.kind, filename: m.filename, size: m.size, attached_to: m.postId, created_at: m.createdAt.toISOString() })) };
}

// ─── Generate scope ─────────────────────────────────────────────────────────────────────────────────────────

const FORMAT_KEYS = (IMAGE_FORMATS as { key: string }[]).map((f) => f.key);
const STYLE_KEYS = (IMAGE_STYLES as { key: string }[]).map((s) => s.key);

/** AI picture (IMAGE_COST credits, charged to the key's member, refunded if the job fails). Lands in Waltz Image. */
export async function apiCreateImage(ctx: ApiContext, b: { brief?: unknown; format?: unknown; style?: unknown }) {
  requireScope(ctx, "generate");
  const brief = String(b.brief ?? "").trim();
  if (!brief) throw new ApiError(400, "bad_request", "`brief` (what the picture should show) is required.");
  const format = typeof b.format === "string" && FORMAT_KEYS.includes(b.format) ? b.format : "1:1";
  const style = typeof b.style === "string" && STYLE_KEYS.includes(b.style) ? b.style : "photographic";
  const id = randomUUID();
  const imageId = randomUUID();
  const data: ImageAdData = { brief: brief.slice(0, 1000), style, layout: "none", headline: "", subhead: "", cta: "", useBrand: false, imageId: null };
  await db.insert(schema.imageDesigns).values({ id, workspaceId: ctx.workspaceId, createdBy: ctx.userId, kind: "image", title: `API · ${brief}`.slice(0, 100), format, data });
  try {
    await createImageJob({ userId: ctx.userId, workspaceId: ctx.workspaceId, brief, style, format, design: { designId: id, imageId } });
  } catch (e) {
    await db.delete(schema.imageDesigns).where(eq(schema.imageDesigns.id, id));
    if (e instanceof NotEnoughCredits) throw new ApiError(402, "not_enough_credits", e.message);
    throw new ApiError(503, "unavailable", (e as Error).message.slice(0, 200));
  }
  await db.update(schema.imageDesigns).set({ data: { ...data, imageId } }).where(eq(schema.imageDesigns.id, id));
  return { id, status: "pending", credits: IMAGE_COST, format, style };
}

export async function apiGetImage(ctx: ApiContext, id: string) {
  requireScope(ctx, "read");
  if (!ID.test(id)) throw new ApiError(404, "not_found", "Image not found.");
  const [d] = await db
    .select({ id: schema.imageDesigns.id, format: schema.imageDesigns.format, data: schema.imageDesigns.data })
    .from(schema.imageDesigns)
    .where(and(eq(schema.imageDesigns.id, id), eq(schema.imageDesigns.workspaceId, ctx.workspaceId)));
  if (!d) throw new ApiError(404, "not_found", "Image not found.");
  const imgs = await designImages(id);
  const want = (d.data as { imageId?: string | null }).imageId ?? null;
  const img = imgs.find((i) => i.id === want) ?? imgs[0] ?? null;
  return {
    id,
    format: d.format,
    status: img?.status ?? "failed",
    error: img?.error ?? null,
    file_url: img?.status === "ready" ? `/api/v1/images/${id}/file` : null,
    width: img?.width ?? null,
    height: img?.height ?? null,
  };
}

export async function apiImageFile(ctx: ApiContext, id: string): Promise<Uint8Array> {
  const v = await apiGetImage(ctx, id);
  if (v.status !== "ready") throw new ApiError(409, "not_ready", "The picture is not ready yet.");
  const [d] = await db.select({ data: schema.imageDesigns.data }).from(schema.imageDesigns).where(eq(schema.imageDesigns.id, id));
  const imgs = await designImages(id);
  const want = (d?.data as { imageId?: string | null } | undefined)?.imageId ?? imgs[0]?.id ?? null;
  const bytes = await pictureBytes(id, want);
  if (!bytes) throw new ApiError(404, "not_found", "Image file not found.");
  return bytes;
}

/** AI caption + hashtags per channel (0 credits; AI Box). */
export async function apiGenerateCopy(ctx: ApiContext, b: { brief?: unknown; channels?: unknown; link?: unknown }) {
  requireScope(ctx, "generate");
  needSocial(ctx);
  const brief = String(b.brief ?? "").trim();
  if (!brief) throw new ApiError(400, "bad_request", "`brief` is required.");
  const keys = Array.isArray(b.channels) ? b.channels.map(String) : [];
  const dests = (await listDestinations(ctx.workspaceId)).filter((d) => keys.includes(d.key));
  if (!dests.length) throw new ApiError(400, "bad_request", "`channels` must list at least one channel key from GET /api/v1/connections.");
  const conns = dests.map((d) => d.connectionId).filter((x): x is string => Boolean(x));
  const ctxRows = conns.length
    ? await db.select({ id: schema.socialConnections.id, c: schema.socialConnections.aiContext }).from(schema.socialConnections)
        .where(and(eq(schema.socialConnections.workspaceId, ctx.workspaceId), inArray(schema.socialConnections.id, conns)))
    : [];
  const aiCtx = new Map(ctxRows.map((r) => [r.id, r.c]));
  const { copyForNetworks } = await import("@/lib/social/copy");
  try {
    const out = await copyForNetworks({
      brief,
      link: typeof b.link === "string" ? b.link : null,
      media: [],
      targets: dests.slice(0, 12).map((d) => ({ key: d.key, provider: d.provider, label: d.label, context: d.connectionId ? aiCtx.get(d.connectionId) : null })),
    });
    return { copy: out.map((c) => ({ channel: c.key, text: c.text, hashtags: c.hashtags })) };
  } catch (e) {
    if ((e as Error).message.startsWith("Write a line")) throw new ApiError(400, "bad_request", (e as Error).message);
    throw new ApiError(503, "unavailable", "The AI writer is not reachable right now — try again in a minute.");
  }
}

// ─── Route handler wrapper ──────────────────────────────────────────────────────────────────────────────────

export function apiJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

/** Authenticate, run, map errors to `{ error: { code, message } }`, and record the status for the rate limiter. */
export async function apiRoute(req: Request, handler: (ctx: ApiContext) => Promise<Response>): Promise<Response> {
  let ctx: ApiContext | null = null;
  try {
    ctx = await authenticateApi(req, new URL(req.url).pathname);
    const res = await handler(ctx);
    await finishRequest(ctx, res.status);
    res.headers.set("x-request-id", ctx.requestId);
    return res;
  } catch (e) {
    if (e instanceof ApiError) {
      await finishRequest(ctx, e.status);
      return apiJson({ error: { code: e.code, message: e.message } }, e.status, { ...e.headers, ...(ctx ? { "x-request-id": ctx.requestId } : {}) });
    }
    console.error("[api v1]", e);
    await finishRequest(ctx, 500);
    return apiJson({ error: { code: "internal", message: "Something went wrong." } }, 500);
  }
}

export async function readJson(req: Request): Promise<{ text: string; body: Record<string, unknown> }> {
  const text = await req.text();
  if (!text.trim()) return { text, body: {} };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return { text, body };
  } catch {
    throw new ApiError(400, "bad_request", "The body must be a JSON object.");
  }
}
