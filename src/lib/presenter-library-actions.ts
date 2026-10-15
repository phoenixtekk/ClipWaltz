"use server";
import { randomUUID } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "./admin";
import { requireUserId } from "./auth";
import { toResult, type ActionResult } from "./action-result";
import { enqueuePresenter } from "./queue";
import { purgePrefix } from "./storage";
import { VOICES } from "./deck/types";
import type { PresenterView } from "./presenters";

// Waltz Avatar Phase 2 — ClipWaltz's presenter library. Admins make fictional AI presenters (pick one of 3 generated faces
// → talking base footage → presenter) and licensed actors (uploaded footage + a signed release reference). Published
// (`library`) ready presenters can be used by every user; only admins create, publish or delete them.

export type LibraryPresenter = PresenterView & {
  kind: "ai" | "actor";
  library: boolean;
  description: string | null;
  releaseRef: string | null;
  portraits: string[]; // URLs of the face candidates (ai, before one is picked)
};

type Row = typeof schema.presenters.$inferSelect;

function libView(p: Row, admin: boolean): LibraryPresenter {
  return {
    id: p.id, name: p.name, status: p.status as PresenterView["status"], voice: p.voice,
    hasFootage: !!p.footageKey, hasConsent: true, error: p.error,
    thumbUrl: p.thumbKey ? `/api/presenters/${p.id}/thumb?v=${p.readyAt?.getTime() ?? p.updatedAt.getTime()}` : null,
    createdAt: p.createdAt.toISOString(), readyAt: p.readyAt?.toISOString() ?? null,
    meta: (p.meta ?? null) as PresenterView["meta"], voiceStatus: "none", voiceHasConsent: false, voiceError: null,
    kind: p.kind as "ai" | "actor", library: p.library, description: p.description, source: "ai", photoAt: null, consentRef: null,
    releaseRef: admin ? p.releaseRef : null,
    portraits: admin && Array.isArray(p.portraitKeys) ? (p.portraitKeys as string[]).map((_, n) => `/api/presenters/${p.id}/portrait/${n}`) : [],
  };
}

async function adminRow(id: string): Promise<Row> {
  const [p] = await db.select().from(schema.presenters).where(and(eq(schema.presenters.id, id), inArray(schema.presenters.kind, ["ai", "actor"])));
  if (!p) throw new Error("Presenter not found");
  return p;
}

/** Queue a presenter job for a row already set to "queued"; if the queue can't be reached, mark it failed so an admin can
 * retry or delete it (a row left "queued" would be stuck: every action refuses queued rows). */
async function queueOrFail(id: string, action: "portraits" | "ai_build" | "library_prepare"): Promise<void> {
  try {
    await enqueuePresenter({ presenterId: id, action });
  } catch (e) {
    console.error(`[presenter-library] enqueue ${action} ${id} failed:`, (e as Error).message);
    await db.update(schema.presenters).set({ status: "failed", error: "Couldn't reach the job queue — try again", updatedAt: new Date() })
      .where(eq(schema.presenters.id, id)).catch(() => {});
    throw new Error("Couldn't reach the job queue — try again in a moment");
  }
}

/** Atomically move a row from one of `from` to "queued" (a double-click or two admins start one job, not two). */
async function claim(id: string, from: string[], set: Partial<Row> = {}): Promise<boolean> {
  const r = await db.update(schema.presenters).set({ ...set, status: "queued", error: null, updatedAt: new Date() })
    .where(and(eq(schema.presenters.id, id), inArray(schema.presenters.status, from))).returning({ id: schema.presenters.id });
  return r.length > 0;
}

const cleanName = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
const voiceOf = (v?: string) => (VOICES.some((x) => x.id === v) ? v! : "af_heart");

/** Every user: the published, ready library presenters. */
export async function listLibraryPresenters(): Promise<ActionResult<LibraryPresenter[]>> {
  return toResult(async () => {
    await requireUserId();
    const rows = await db.select().from(schema.presenters)
      .where(and(eq(schema.presenters.library, true), eq(schema.presenters.status, "ready"))).orderBy(schema.presenters.name);
    return rows.map((p) => libView(p, false));
  });
}

/** Admin: every library presenter in any state. */
export async function adminListLibrary(): Promise<ActionResult<LibraryPresenter[]>> {
  return toResult(async () => {
    await requireAdmin();
    const rows = await db.select().from(schema.presenters).where(inArray(schema.presenters.kind, ["ai", "actor"])).orderBy(desc(schema.presenters.createdAt));
    return rows.map((p) => libView(p, true));
  });
}

/** Admin: a fictional presenter — 3 faces are generated from the description; pick one next. */
export async function adminCreateAiPresenter(input: { name: string; description: string; voice?: string }): Promise<ActionResult<LibraryPresenter>> {
  return toResult(async () => {
    const s = await requireAdmin();
    const name = cleanName(input.name);
    const description = String(input.description ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!name || !description) throw new Error("Give the presenter a name and describe how they look");
    const [p] = await db.insert(schema.presenters).values({
      id: randomUUID(), userId: s.user.id, name, kind: "ai", description, voice: voiceOf(input.voice), status: "queued",
    }).returning();
    await queueOrFail(p.id, "portraits");
    revalidatePath("/admin/avatars");
    return libView(p, true);
  });
}

/** Admin: new faces for an AI presenter that isn't built yet. */
export async function adminMoreFaces(id: string): Promise<ActionResult<void>> {
  return toResult(async () => {
    await requireAdmin();
    const p = await adminRow(id);
    if (p.kind !== "ai" || !["draft", "failed"].includes(p.status)) throw new Error("This presenter is already being built");
    if (!(await claim(id, ["draft", "failed"], { portraitKeys: null }))) throw new Error("This presenter is already being built");
    for (const k of (p.portraitKeys as string[] | null) ?? []) await purgePrefix(k).catch(() => {});
    await queueOrFail(id, "portraits");
    revalidatePath("/admin/avatars");
  });
}

/** Admin: build the AI presenter from the chosen face (≈ 15–20 min of GPU). */
export async function adminPickFace(id: string, n: number): Promise<ActionResult<void>> {
  return toResult(async () => {
    await requireAdmin();
    const p = await adminRow(id);
    const keys = (p.portraitKeys as string[] | null) ?? [];
    if (p.kind !== "ai" || p.status !== "draft" || !keys[n]) throw new Error("Pick one of the faces shown");
    if (!(await claim(id, ["draft"], { thumbKey: keys[n] }))) throw new Error("This presenter is already being built");
    await queueOrFail(id, "ai_build");
    revalidatePath("/admin/avatars");
  });
}

/** Admin: a licensed actor — upload their footage next (POST /api/presenters/:id/footage), then build. */
export async function adminCreateActor(input: { name: string; description?: string; releaseRef: string; voice?: string }): Promise<ActionResult<LibraryPresenter>> {
  return toResult(async () => {
    const s = await requireAdmin();
    const name = cleanName(input.name);
    const releaseRef = String(input.releaseRef ?? "").trim().slice(0, 200);
    if (!name) throw new Error("Give the actor's presenter name");
    if (!releaseRef) throw new Error("Enter the signed release's reference (it must cover AI likeness + voice, scope, territory and term)");
    const [p] = await db.insert(schema.presenters).values({
      id: randomUUID(), userId: s.user.id, name, kind: "actor", releaseRef, voice: voiceOf(input.voice),
      description: String(input.description ?? "").trim().slice(0, 300) || null,
    }).returning();
    revalidatePath("/admin/avatars");
    return libView(p, true);
  });
}

/** Admin: build an actor presenter from the uploaded footage. */
export async function adminBuildActor(id: string): Promise<ActionResult<void>> {
  return toResult(async () => {
    await requireAdmin();
    const p = await adminRow(id);
    if (p.kind !== "actor" || !["draft", "failed"].includes(p.status)) throw new Error("This presenter is already being built");
    if (!p.footageKey) throw new Error("Upload the actor's footage first");
    if (!p.releaseRef) throw new Error("The release reference is missing");
    if (!(await claim(id, ["draft", "failed"]))) throw new Error("This presenter is already being built");
    await queueOrFail(id, "library_prepare");
    revalidatePath("/admin/avatars");
  });
}

/** Admin: show / hide a ready presenter in every user's library. */
export async function adminSetPublished(id: string, on: boolean): Promise<ActionResult<void>> {
  return toResult(async () => {
    await requireAdmin();
    const p = await adminRow(id);
    if (on && p.status !== "ready") throw new Error("Only a ready presenter can be published");
    await db.update(schema.presenters).set({ library: !!on, updatedAt: new Date() }).where(eq(schema.presenters.id, id));
    revalidatePath("/admin/avatars");
    revalidatePath("/avatars");
  });
}

/** Admin: delete a library presenter for good (files purged; decks that used it can't render it any more). */
export async function adminDeleteLibraryPresenter(id: string): Promise<ActionResult<void>> {
  return toResult(async () => {
    await requireAdmin();
    const p = await adminRow(id);
    // A job that's been queued/building for over 2 hours is stuck (the longest build is ~20 min) — let it be deleted.
    const stuck = Date.now() - p.updatedAt.getTime() > 2 * 3600_000;
    if ((p.status === "queued" || p.status === "preparing") && !stuck) throw new Error("Wait until it's ready (or failed), then delete it");
    await purgePrefix(`presenters/${p.userId}/${id}/`);
    await db.delete(schema.presenters).where(eq(schema.presenters.id, id));
    await enqueuePresenter({ presenterId: id, action: "delete" }).catch(() => {});
    revalidatePath("/admin/avatars");
    revalidatePath("/avatars");
  });
}
