"use server";
import { revalidatePath } from "next/cache";
import { toResult } from "@/lib/action-result";
import { requireSocial } from "@/lib/social/access";
import { addCompetitor, refreshCompetitor, removeCompetitor, summarizeCompetitor } from "@/lib/competitors";

// G7 Publish → Competitors. Editors and up, in the ACTIVE workspace, behind the Social Publishing flag (requireSocial).

const done = <T,>(v: T) => {
  revalidatePath("/publish/competitors");
  return v;
};

export async function addCompetitorSource(input: { name: string; kind: string; ref: string }) {
  return toResult(async () => {
    const sc = await requireSocial(null, "editor");
    return done(await addCompetitor(sc.workspaceId, sc.userId, input));
  });
}

export async function refreshCompetitorSource(id: string) {
  return toResult(async () => {
    const sc = await requireSocial(null, "editor");
    return done(await refreshCompetitor(sc.workspaceId, String(id)));
  });
}

export async function removeCompetitorSource(id: string) {
  return toResult(async () => {
    const sc = await requireSocial(null, "editor");
    if (!(await removeCompetitor(sc.workspaceId, String(id)))) throw new Error("That source isn't in this workspace.");
    return done(true);
  });
}

export async function summarizeCompetitorSource(id: string) {
  return toResult(async () => {
    const sc = await requireSocial(null, "editor");
    return done(await summarizeCompetitor(sc.workspaceId, String(id)));
  });
}
