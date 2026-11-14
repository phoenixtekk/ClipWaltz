"use server";
import { revalidatePath } from "next/cache";
import { toResult } from "@/lib/action-result";
import { activeWorkspaceId } from "@/lib/active-workspace";
import { createApiKey, revokeApiKey } from "@/lib/api-keys";
import { requireUserId } from "@/lib/auth";
import { getWorkspaceRole, roleAtLeast } from "@/lib/workspace";

// G12 key management for Account → API keys. Owners and admins of the ACTIVE workspace only; the server re-checks the
// role on every call (the page hiding the buttons is not the control).

async function adminWorkspace(): Promise<{ userId: string; workspaceId: string }> {
  const userId = await requireUserId();
  const workspaceId = await activeWorkspaceId(userId);
  if (!roleAtLeast(await getWorkspaceRole(userId, workspaceId), "admin")) throw new Error("Only workspace owners and admins can manage API keys.");
  return { userId, workspaceId };
}

async function createImpl(name: string, scopes: string[]) {
  const { userId, workspaceId } = await adminWorkspace();
  const k = await createApiKey(workspaceId, userId, name, scopes);
  revalidatePath("/account/api");
  return { id: k.id, secret: k.secret, prefix: k.prefix };
}
/** Create a key; the secret is returned this once and never again. */
export async function createWorkspaceApiKey(name: string, scopes: string[]) {
  return toResult(() => createImpl(name, scopes));
}

async function revokeImpl(id: string) {
  const { workspaceId } = await adminWorkspace();
  if (!(await revokeApiKey(workspaceId, String(id)))) throw new Error("That key is not active in this workspace.");
  revalidatePath("/account/api");
  return true;
}
export async function revokeWorkspaceApiKey(id: string) {
  return toResult(() => revokeImpl(id));
}
