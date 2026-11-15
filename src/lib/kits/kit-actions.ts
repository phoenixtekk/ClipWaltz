"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { toResult } from "@/lib/action-result";
import { requireSocial } from "@/lib/social/access";
import { buildKit, createKit, deleteKit, getKitRow, kitView, markWriting, updateKitItem, type CreateKitInput, type ItemPatch } from "./kits";

// Post kits — server actions. Same access as the Publish area (requireSocial): viewers read, editors make and change.
// The captions are written on the AI Box after the response (after()), so a kit opens at once and fills in.

async function createImpl(input: CreateKitInput): Promise<{ id: string }> {
  const sc = await requireSocial(null, "editor");
  const id = await createKit(sc.userId, sc.workspaceId, input);
  after(() => buildKit(id));
  return { id };
}

async function kitImpl(id: string) {
  const sc = await requireSocial(null, "viewer");
  const row = await getKitRow(sc.workspaceId, id);
  if (!row) throw new Error("Kit not found.");
  return kitView(row, sc.role);
}

async function rewriteImpl(id: string, provider?: string) {
  const sc = await requireSocial(null, "editor");
  await markWriting(sc.workspaceId, id);
  after(() => buildKit(id, provider ? { only: provider } : {}));
  return { ok: true };
}

async function updateImpl(id: string, provider: string, patch: ItemPatch) {
  const sc = await requireSocial(null, "editor");
  return updateKitItem(sc.workspaceId, id, provider, patch);
}

async function deleteImpl(id: string) {
  const sc = await requireSocial(null, "editor");
  await deleteKit(sc.workspaceId, id);
  revalidatePath("/publish/kits");
  return { ok: true };
}

export async function createPostKit(input: CreateKitInput) { return toResult(() => createImpl(input)); }
export async function getPostKit(id: string) { return toResult(() => kitImpl(id)); }
export async function rewritePostKit(id: string, provider?: string) { return toResult(() => rewriteImpl(id, provider)); }
export async function updatePostKitItem(id: string, provider: string, patch: ItemPatch) { return toResult(() => updateImpl(id, provider, patch)); }
export async function deletePostKit(id: string) { return toResult(() => deleteImpl(id)); }
