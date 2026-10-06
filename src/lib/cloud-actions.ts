"use server";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { userCanAccessProject } from "./workspace";
import { toResult } from "./action-result";
import { provider } from "./cloud/providers";
import { disconnect, listConnections, updateConnection, type Connection } from "./cloud/store";
import { enqueueRenderSaves, resumeStale } from "./cloud/saves";
import { CLOUD_PROVIDERS, FOLDER_LAYOUTS, isCloudProvider, type CloudProviderId, type FolderLayout } from "./cloud/types";

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

export async function getCloudStorage() { return toResult(() => getCloudStorageImpl()); }
export async function setCloudAutoSave(...a: Parameters<typeof setCloudAutoSaveImpl>) { return toResult(() => setCloudAutoSaveImpl(...a)); }
export async function setCloudFolderLayout(...a: Parameters<typeof setCloudFolderLayoutImpl>) { return toResult(() => setCloudFolderLayoutImpl(...a)); }
export async function disconnectCloud(...a: Parameters<typeof disconnectCloudImpl>) { return toResult(() => disconnectCloudImpl(...a)); }
export async function myCloudProviders() { return toResult(() => myCloudProvidersImpl()); }
export async function saveRenderToCloud(...a: Parameters<typeof saveRenderToCloudImpl>) { return toResult(() => saveRenderToCloudImpl(...a)); }
