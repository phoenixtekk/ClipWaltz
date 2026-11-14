"use server";
import { revalidatePath } from "next/cache";
import { toResult } from "@/lib/action-result";
import { activeWorkspaceId } from "@/lib/active-workspace";
import { requireUserId } from "@/lib/auth";
import { appUrl } from "@/lib/social/app-url";
import {
  connectStore, disableWebhooks, disconnectStore, enableWebhooks, syncStore, type ConnectInput,
} from "@/lib/commerce/sync";
import { getWorkspaceRole, roleAtLeast, type WorkspaceRole } from "@/lib/workspace";

// G10 Store catalogs (Account → Store catalogs). Connect / disconnect / webhooks: owners and admins (they handle the
// store's keys). Sync: editors and up. Always the ACTIVE workspace; the role is re-checked here on every call.

async function ws(min: WorkspaceRole) {
  const userId = await requireUserId();
  const workspaceId = await activeWorkspaceId(userId);
  if (!roleAtLeast(await getWorkspaceRole(userId, workspaceId), min)) {
    throw new Error(min === "admin" ? "Only workspace owners and admins can connect or remove stores." : "Viewers can't sync stores.");
  }
  return { userId, workspaceId };
}

const done = <T,>(v: T) => {
  revalidatePath("/account/integrations");
  return v;
};

export async function connectCommerceStore(input: ConnectInput) {
  return toResult(async () => {
    const { userId, workspaceId } = await ws("admin");
    const c = await connectStore(workspaceId, userId, input);
    const s = await syncStore(workspaceId, c.id).catch((e: Error) => ({ error: e.message }));
    return done({ id: c.id, sync: s });
  });
}

export async function syncCommerceStore(id: string) {
  return toResult(async () => {
    const { workspaceId } = await ws("editor");
    return done(await syncStore(workspaceId, String(id)));
  });
}

export async function disconnectCommerceStore(id: string) {
  return toResult(async () => {
    const { workspaceId } = await ws("admin");
    if (!(await disconnectStore(workspaceId, String(id)))) throw new Error("That store is not connected to this workspace.");
    return done(true);
  });
}

export async function enableCommerceWebhooks(id: string, shopifySecret?: string | null) {
  return toResult(async () => {
    const { workspaceId } = await ws("admin");
    const r = await enableWebhooks(workspaceId, String(id), shopifySecret ?? null);
    return done({ secret: r.secret, url: `${appUrl()}${r.path}` });
  });
}

export async function disableCommerceWebhooks(id: string) {
  return toResult(async () => {
    const { workspaceId } = await ws("admin");
    await disableWebhooks(workspaceId, String(id));
    return done(true);
  });
}
