import { randomUUID } from "crypto";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { headObject, getObjectRange } from "@/lib/storage";
import { accessToken, updateConnection } from "./store";
import { provider } from "./providers";
import { cleanName, isCloudProvider, type CloudProviderId, type FolderLayout } from "./types";

// Saving finished videos to connected cloud storage. A cloud_saves row per render × provider is the queue;
// uploads run in this (app) process one at a time, streaming from MinIO in chunks — nothing is buffered whole.
// Rows left behind by a restart are picked up again by resumeStale() (render-ready and the Cloud storage page).

const MAX_ATTEMPTS = 3;

/** Queue a render for every connection with auto-save on (or just `only`, e.g. "Save to…"). Returns queued ids. */
export async function enqueueRenderSaves(renderId: string, opts: { only?: CloudProviderId; userId?: string } = {}): Promise<string[]> {
  const [r] = await db
    .select({ status: schema.renders.status, outputKey: schema.renders.outputKey, ownerId: schema.projects.ownerId })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .where(eq(schema.renders.id, renderId));
  if (!r || r.status !== "done" || !r.outputKey) return [];
  const userId = opts.userId ?? r.ownerId; // the project owner's storage (or whoever pressed Save to…)
  const conns = await db
    .select({ provider: schema.oauthAccounts.provider, autoSave: schema.oauthAccounts.autoSave })
    .from(schema.oauthAccounts)
    .where(eq(schema.oauthAccounts.userId, userId));
  const targets = conns
    .filter((c) => isCloudProvider(c.provider) && (opts.only ? c.provider === opts.only : c.autoSave))
    .map((c) => c.provider as CloudProviderId);
  const ids: string[] = [];
  for (const p of targets) {
    // A failed (or manual re-)save goes back to the queue; one that's done or running stays as it is.
    const [row] = await db
      .insert(schema.cloudSaves)
      .values({ id: randomUUID(), userId, renderId, provider: p })
      .onConflictDoUpdate({
        target: [schema.cloudSaves.renderId, schema.cloudSaves.provider, schema.cloudSaves.userId],
        set: { status: "queued", error: null, attempts: 0, updatedAt: new Date() },
        setWhere: sql`${schema.cloudSaves.status} = 'failed'`,
      })
      .returning({ id: schema.cloudSaves.id, status: schema.cloudSaves.status });
    if (row?.status === "queued") ids.push(row.id);
  }
  for (const id of ids) schedule(id);
  return ids;
}

let chain: Promise<void> = Promise.resolve();
const scheduled = new Set<string>();
function schedule(id: string) {
  if (scheduled.has(id)) return;
  scheduled.add(id);
  chain = chain.then(() => processSave(id)).catch(() => {}).finally(() => scheduled.delete(id));
}

/** Requeue rows a restart interrupted (uploading > 3 h, or queued > 2 min and not in this process's queue). */
export async function resumeStale(userId?: string) {
  const now = Date.now();
  const rows = await db
    .select({ id: schema.cloudSaves.id })
    .from(schema.cloudSaves)
    .where(and(
      userId ? eq(schema.cloudSaves.userId, userId) : undefined,
      or(
        and(eq(schema.cloudSaves.status, "uploading"), lt(schema.cloudSaves.updatedAt, new Date(now - 3 * 3600_000))),
        and(eq(schema.cloudSaves.status, "queued"), lt(schema.cloudSaves.updatedAt, new Date(now - 120_000))),
      ),
    ))
    .limit(50);
  for (const r of rows) {
    await db.update(schema.cloudSaves).set({ status: "queued", updatedAt: new Date() }).where(eq(schema.cloudSaves.id, r.id));
    schedule(r.id);
  }
}

function folderPath(layout: FolderLayout, category: string | null, project: string): string[] {
  if (layout === "flat") return ["ClipWaltz"];
  if (layout === "project") return ["ClipWaltz", cleanName(project)];
  return ["ClipWaltz", cleanName(category || "Uncategorized"), cleanName(project)];
}

function fileName(project: string, version: number, aspect: string, variant: unknown): string {
  const label = variant && typeof variant === "object" ? String((variant as { label?: unknown }).label ?? "").trim() : "";
  const base = `${project} v${version}${label ? ` - ${label}` : ""} (${aspect.replace(":", "x")})`;
  return `${cleanName(base, 140)}.mp4`;
}

async function processSave(id: string) {
  // Claim it (queued → uploading), so two processes never upload the same row.
  const [claimed] = await db
    .update(schema.cloudSaves)
    .set({ status: "uploading", attempts: sql`${schema.cloudSaves.attempts} + 1`, updatedAt: new Date() })
    .where(and(eq(schema.cloudSaves.id, id), eq(schema.cloudSaves.status, "queued")))
    .returning();
  if (!claimed) return;
  const p = claimed.provider as CloudProviderId;
  try {
    const [r] = await db
      .select({
        outputKey: schema.renders.outputKey, version: schema.renders.version, aspect: schema.renders.aspect,
        variant: schema.renders.variant, title: schema.projects.title, category: schema.projects.category,
        layout: schema.oauthAccounts.folderLayout,
      })
      .from(schema.renders)
      .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
      .innerJoin(schema.oauthAccounts, and(eq(schema.oauthAccounts.userId, claimed.userId), eq(schema.oauthAccounts.provider, p)))
      .where(eq(schema.renders.id, claimed.renderId));
    if (!r) throw new Error(`${p} is no longer connected`);
    if (!r.outputKey) throw new Error("the video file is missing");
    const key = r.outputKey;
    const head = await headObject(key);
    const token = await accessToken(claimed.userId, p);
    const res = await provider(p).upload(token, {
      folders: folderPath((r.layout as FolderLayout) || "category", r.category, r.title),
      name: fileName(r.title, r.version, r.aspect, r.variant),
      size: head.size,
      mime: head.contentType || "video/mp4",
      read: (s, e) => getObjectRange(key, s, e),
    });
    await db.update(schema.cloudSaves).set({
      status: "done", remoteId: res.id, remoteUrl: res.url, remotePath: res.path, bytes: head.size, error: null,
      updatedAt: new Date(), completedAt: new Date(),
    }).where(eq(schema.cloudSaves.id, id));
    await updateConnection(claimed.userId, p, { lastError: null });
    console.log(`[cloud] render ${claimed.renderId} → ${p} ${res.path} (${head.size} bytes)`);
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    const retry = claimed.attempts < MAX_ATTEMPTS && !/reconnect|no longer connected|missing/.test(msg);
    await db.update(schema.cloudSaves)
      .set({ status: retry ? "queued" : "failed", error: msg, updatedAt: new Date() })
      .where(eq(schema.cloudSaves.id, id));
    if (!retry) await updateConnection(claimed.userId, p, { lastError: msg }).catch(() => {});
    console.error(`[cloud] render ${claimed.renderId} → ${p} failed (attempt ${claimed.attempts}):`, msg);
    if (retry) setTimeout(() => schedule(id), 30_000 * claimed.attempts).unref?.();
  }
}

export type SaveRow = { id: string; renderId: string; provider: CloudProviderId; status: string; remoteUrl: string | null; remotePath: string | null; error: string | null; completedAt: string | null };

export async function savesForRenders(renderIds: string[]): Promise<SaveRow[]> {
  if (!renderIds.length) return [];
  const rows = await db.select().from(schema.cloudSaves).where(inArray(schema.cloudSaves.renderId, renderIds));
  return rows.map((r) => ({
    id: r.id, renderId: r.renderId, provider: r.provider as CloudProviderId, status: r.status, remoteUrl: r.remoteUrl,
    remotePath: r.remotePath, error: r.error, completedAt: r.completedAt?.toISOString() ?? null,
  }));
}
