"use server";
import { and, desc, eq, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { userCanAccessProject } from "./workspace";
import { toResult } from "./action-result";
import { provider } from "./cloud/providers";
import { accessToken, disconnect, listConnections, updateConnection, type Connection } from "./cloud/store";
import { enqueueRenderSaves, resumeStale } from "./cloud/saves";
import { CLOUD_PROVIDERS, FOLDER_LAYOUTS, isCloudProvider, type CloudProviderId, type FolderLayout } from "./cloud/types";
import {
  cleanRules, cleanTargets, getPrefs, resolveTargets, videoType, type CloudPrefs, type CloudRule, type Resolved,
} from "./cloud/routing";

export type CloudProviderState = { id: CloudProviderId; available: boolean; connection: Connection | null };
export type RecentSave = {
  id: string; renderId: string; provider: CloudProviderId; status: string; remoteUrl: string | null; remotePath: string | null;
  error: string | null; at: string; projectTitle: string; version: number;
};

function check(p: unknown): CloudProviderId {
  if (!isCloudProvider(p)) throw new Error("Unknown storage provider");
  return p;
}

/** Account → Cloud storage: every provider, whether it can be connected here, and the user's connection. */
async function getCloudStorageImpl(): Promise<{ providers: CloudProviderState[]; recent: RecentSave[] }> {
  const userId = await requireUserId();
  await resumeStale(userId).catch((e) => console.error("[cloud] resume failed:", (e as Error).message));
  const conns = await listConnections(userId);
  const providers = CLOUD_PROVIDERS.map((id) => ({
    id, available: provider(id).configured(), connection: conns.find((c) => c.provider === id) ?? null,
  }));
  const rows = await db
    .select({
      id: schema.cloudSaves.id, renderId: schema.cloudSaves.renderId, provider: schema.cloudSaves.provider, status: schema.cloudSaves.status,
      remoteUrl: schema.cloudSaves.remoteUrl, remotePath: schema.cloudSaves.remotePath, error: schema.cloudSaves.error,
      at: schema.cloudSaves.updatedAt, projectTitle: schema.projects.title, version: schema.renders.version,
    })
    .from(schema.cloudSaves)
    .innerJoin(schema.renders, eq(schema.cloudSaves.renderId, schema.renders.id))
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .where(eq(schema.cloudSaves.userId, userId))
    .orderBy(desc(schema.cloudSaves.updatedAt))
    .limit(15);
  return {
    providers,
    recent: rows.map((r) => ({ ...r, provider: r.provider as CloudProviderId, at: r.at.toISOString() })),
  };
}

async function setCloudAutoSaveImpl(p: CloudProviderId, on: boolean) {
  const userId = await requireUserId();
  await updateConnection(userId, check(p), { autoSave: !!on });
  revalidatePath("/account/storage");
}

async function setCloudFolderLayoutImpl(p: CloudProviderId, layout: FolderLayout) {
  const userId = await requireUserId();
  if (!FOLDER_LAYOUTS.includes(layout)) throw new Error("Unknown folder layout");
  await updateConnection(userId, check(p), { folderLayout: layout });
  revalidatePath("/account/storage");
}

async function disconnectCloudImpl(p: CloudProviderId) {
  const userId = await requireUserId();
  await disconnect(userId, check(p));
  revalidatePath("/account/storage");
}

/** The providers the current user has connected (for "Save to…" menus). */
async function myCloudProvidersImpl(): Promise<CloudProviderId[]> {
  const userId = await requireUserId();
  return (await listConnections(userId)).map((c) => c.provider);
}

/** "Save to…" one finished render (also retries a failed save). */
async function saveRenderToCloudImpl(renderId: string, p: CloudProviderId) {
  const userId = await requireUserId();
  const [r] = await db
    .select({ projectId: schema.renders.projectId, status: schema.renders.status })
    .from(schema.renders)
    .where(eq(schema.renders.id, String(renderId)));
  if (!r || !(await userCanAccessProject(userId, r.projectId, "viewer"))) throw new Error("Render not found");
  if (r.status !== "done") throw new Error("This video hasn't finished rendering yet");
  const conns = await listConnections(userId);
  if (!conns.some((c) => c.provider === check(p))) throw new Error("Connect it first in Account → Cloud storage");
  const [existing] = await db
    .select({ status: schema.cloudSaves.status })
    .from(schema.cloudSaves)
    .where(and(eq(schema.cloudSaves.renderId, renderId), eq(schema.cloudSaves.provider, p), eq(schema.cloudSaves.userId, userId)));
  if (existing?.status === "done") {
    // Saving again on purpose: start a fresh row.
    await db.delete(schema.cloudSaves).where(and(eq(schema.cloudSaves.renderId, renderId), eq(schema.cloudSaves.provider, p), eq(schema.cloudSaves.userId, userId)));
  }
  await enqueueRenderSaves(renderId, { only: p, userId });
  revalidatePath(`/projects/${r.projectId}`, "layout");
}

// ── Where videos go: default destinations, rules, per-project and per-render choices ──────────────────────────

export type CloudRouting = {
  prefs: CloudPrefs;
  connected: CloudProviderId[];
  categories: string[]; // the user's categories (+ Uncategorized), for category rules
  aspects: string[];
};

async function getCloudRoutingImpl(): Promise<CloudRouting> {
  const userId = await requireUserId();
  const [prefs, conns, cats] = await Promise.all([
    getPrefs(userId),
    listConnections(userId),
    db.select({ name: schema.projectCategories.name }).from(schema.projectCategories)
      .where(eq(schema.projectCategories.ownerId, userId)).orderBy(schema.projectCategories.sortOrder),
  ]);
  return {
    prefs,
    connected: conns.map((c) => c.provider),
    categories: [...cats.map((c) => c.name), "Uncategorized"],
    aspects: ["9:16", "16:9", "1:1", "4:5"],
  };
}

async function saveCloudRoutingImpl(input: { defaultTargets: CloudProviderId[]; rules: CloudRule[] }) {
  const userId = await requireUserId();
  const values = { defaultTargets: cleanTargets(input?.defaultTargets), rules: cleanRules(input?.rules), updatedAt: new Date() };
  await db.insert(schema.cloudPrefs).values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.cloudPrefs.userId, set: values });
  revalidatePath("/account/storage");
}

/** Where a new render of this project would be saved — the render dialog's "Save to" defaults. */
async function previewRenderTargetsImpl(projectId: string): Promise<{
  owner: boolean; connected: CloudProviderId[]; resolved: Resolved; projectTargets: CloudProviderId[] | null;
}> {
  const userId = await requireUserId();
  const [p] = await db
    .select({
      ownerId: schema.projects.ownerId, kind: schema.projects.kind, deck: schema.projects.deck, category: schema.projects.category,
      aspect: schema.projects.aspect, cloudTargets: schema.projects.cloudTargets,
    })
    .from(schema.projects).where(eq(schema.projects.id, String(projectId)));
  if (!p || !(await userCanAccessProject(userId, String(projectId), "viewer"))) throw new Error("Project not found");
  const owner = p.ownerId === userId;
  const connected = owner ? (await listConnections(userId)).map((c) => c.provider) : [];
  const resolved = resolveTargets(await getPrefs(p.ownerId), { type: videoType(p.kind, p.deck, null), category: p.category, aspect: p.aspect },
    connected, p.cloudTargets, undefined);
  return { owner, connected, resolved, projectTargets: Array.isArray(p.cloudTargets) ? cleanTargets(p.cloudTargets) : null };
}

/** Video properties → "Save finished videos to": a fixed list (or [] = never), or null = follow my rules. */
async function setProjectCloudTargetsImpl(projectId: string, targets: CloudProviderId[] | null) {
  const userId = await requireUserId();
  const [p] = await db.select({ ownerId: schema.projects.ownerId }).from(schema.projects).where(eq(schema.projects.id, String(projectId)));
  if (!p || p.ownerId !== userId) throw new Error("Only the project's owner can choose where its videos are saved");
  await db.update(schema.projects).set({ cloudTargets: targets === null ? null : cleanTargets(targets) })
    .where(eq(schema.projects.id, String(projectId)));
  revalidatePath("/projects");
}

// ── Analytics ───────────────────────────────────────────────────────────────────────────────────────────────

export type CloudAnalytics = {
  days: number;
  asOf: string; // server time the report was built (ISO) — the day axis ends here
  totals: { saved: number; bytes: number; failed: number; pending: number; successRate: number | null; avgSeconds: number | null; lastAt: string | null };
  byProvider: { provider: CloudProviderId; saved: number; bytes: number; failed: number; pending: number; avgSeconds: number | null; lastAt: string | null }[];
  byType: { type: string; saved: number; bytes: number }[];
  byFormat: { aspect: string; saved: number; bytes: number }[];
  daily: { day: string; provider: CloudProviderId; saved: number; bytes: number }[];
  topProjects: { title: string; saved: number; bytes: number }[];
  connections: {
    provider: CloudProviderId; available: boolean; connected: boolean; accountLabel: string | null; health: "ok" | "error" | "off";
    lastError: string | null; quota: { used: number; total: number | null } | null;
  }[];
};

async function getCloudAnalyticsImpl(days: number): Promise<CloudAnalytics> {
  const userId = await requireUserId();
  const d = [7, 30, 90, 365].includes(days) ? days : 30;
  const since = new Date(Date.now() - d * 86400_000);
  const rows = await db
    .select({
      provider: schema.cloudSaves.provider, status: schema.cloudSaves.status, bytes: schema.cloudSaves.bytes,
      createdAt: schema.cloudSaves.createdAt, completedAt: schema.cloudSaves.completedAt,
      aspect: schema.renders.aspect, campaignId: schema.renders.campaignId, kind: schema.projects.kind, deck: schema.projects.deck,
      title: schema.projects.title,
    })
    .from(schema.cloudSaves)
    .innerJoin(schema.renders, eq(schema.cloudSaves.renderId, schema.renders.id))
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .where(and(eq(schema.cloudSaves.userId, userId), gte(schema.cloudSaves.createdAt, since)));
  type Row = (typeof rows)[number];

  const done = rows.filter((r) => r.status === "done");
  const isPending = (r: Row) => r.status === "queued" || r.status === "uploading";
  const secs = (r: Row) => (r.completedAt ? (r.completedAt.getTime() - r.createdAt.getTime()) / 1000 : null);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const last = (xs: Row[]) => xs.reduce<Date | null>((m, r) => (r.completedAt && (!m || r.completedAt > m) ? r.completedAt : m), null)?.toISOString() ?? null;
  const sum = (xs: Row[]) => xs.reduce((a, r) => a + (r.bytes ?? 0), 0);
  const group = (xs: Row[], key: (r: Row) => string) => {
    const m = new Map<string, Row[]>();
    for (const r of xs) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return [...m];
  };
  const failed = rows.filter((r) => r.status === "failed").length;

  const byProvider = CLOUD_PROVIDERS.map((p) => {
    const all = rows.filter((r) => r.provider === p);
    const ok = all.filter((r) => r.status === "done");
    return {
      provider: p, saved: ok.length, bytes: sum(ok), failed: all.filter((r) => r.status === "failed").length,
      pending: all.filter(isPending).length, avgSeconds: avg(ok.map(secs)), lastAt: last(ok),
    };
  });
  const byType = group(done, (r) => videoType(r.kind, r.deck, r.campaignId)).map(([type, xs]) => ({ type, saved: xs.length, bytes: sum(xs) }))
    .sort((a, b) => b.bytes - a.bytes);
  const byFormat = group(done, (r) => r.aspect).map(([aspect, xs]) => ({ aspect, saved: xs.length, bytes: sum(xs) }))
    .sort((a, b) => b.bytes - a.bytes);
  const daily = group(done, (r) => `${(r.completedAt ?? r.createdAt).toISOString().slice(0, 10)}|${r.provider}`).map(([k, xs]) => {
    const [day, p] = k.split("|");
    return { day, provider: p as CloudProviderId, saved: xs.length, bytes: sum(xs) };
  });
  const topProjects = group(done, (r) => r.title).map(([title, xs]) => ({ title, saved: xs.length, bytes: sum(xs) }))
    .sort((a, b) => b.bytes - a.bytes).slice(0, 8);

  const conns = await listConnections(userId);
  const connections = await Promise.all(CLOUD_PROVIDERS.map(async (p) => {
    const c = conns.find((x) => x.provider === p);
    let quota: { used: number; total: number | null } | null = null;
    const q = provider(p).quota;
    if (c && q) {
      try { quota = await q(await accessToken(userId, p)); } catch { quota = null; }
    }
    return {
      provider: p, available: provider(p).configured(), connected: !!c, accountLabel: c?.accountLabel ?? null,
      health: (!c ? "off" : c.lastError ? "error" : "ok") as "ok" | "error" | "off", lastError: c?.lastError ?? null, quota,
    };
  }));

  return {
    days: d,
    asOf: new Date().toISOString(),
    totals: {
      saved: done.length, bytes: sum(done), failed, pending: rows.filter(isPending).length,
      successRate: done.length + failed ? done.length / (done.length + failed) : null, avgSeconds: avg(done.map(secs)), lastAt: last(done),
    },
    byProvider, byType, byFormat, daily, topProjects, connections,
  };
}

export async function getCloudStorage() { return toResult(() => getCloudStorageImpl()); }
export async function setCloudAutoSave(...a: Parameters<typeof setCloudAutoSaveImpl>) { return toResult(() => setCloudAutoSaveImpl(...a)); }
export async function setCloudFolderLayout(...a: Parameters<typeof setCloudFolderLayoutImpl>) { return toResult(() => setCloudFolderLayoutImpl(...a)); }
export async function disconnectCloud(...a: Parameters<typeof disconnectCloudImpl>) { return toResult(() => disconnectCloudImpl(...a)); }
export async function myCloudProviders() { return toResult(() => myCloudProvidersImpl()); }
export async function saveRenderToCloud(...a: Parameters<typeof saveRenderToCloudImpl>) { return toResult(() => saveRenderToCloudImpl(...a)); }
export async function getCloudRouting() { return toResult(() => getCloudRoutingImpl()); }
export async function saveCloudRouting(...a: Parameters<typeof saveCloudRoutingImpl>) { return toResult(() => saveCloudRoutingImpl(...a)); }
export async function previewRenderTargets(...a: Parameters<typeof previewRenderTargetsImpl>) { return toResult(() => previewRenderTargetsImpl(...a)); }
export async function setProjectCloudTargets(...a: Parameters<typeof setProjectCloudTargetsImpl>) { return toResult(() => setProjectCloudTargetsImpl(...a)); }
export async function getCloudAnalytics(...a: Parameters<typeof getCloudAnalyticsImpl>) { return toResult(() => getCloudAnalyticsImpl(...a)); }
