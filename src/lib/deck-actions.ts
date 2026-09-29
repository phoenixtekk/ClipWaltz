"use server";
// WaltzDeck server actions (06_ClipWaltz_WaltzDeck_Feature_Spec.md). Planning and rewrites run on the
// generation worker (worker/deck/jobs.mjs) via the deck queue; the editor polls getDeck().
import { randomUUID } from "crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { userCanAccessProject } from "./workspace";
import { enqueueDeck } from "./queue";
import {
  DECK_MODES, LAYOUTS, MOTIONS, ROLES, defaultBrief,
  type DeckBrief, type DeckScene, type DeckState, type SceneText, type SceneTextMode,
} from "./deck/types";

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

async function assertAccess(projectId: string, role: "viewer" | "editor") {
  const userId = await requireUserId();
  const [p] = await db.select({ id: schema.projects.id, kind: schema.projects.kind }).from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!p || p.kind !== "deck" || !(await userCanAccessProject(userId, projectId, role))) throw new Error("Project not found");
  return userId;
}

export type DeckAsset = {
  id: string; name: string; kind: string; durationSec: number | null; note: string | null;
  rotation: number; described: boolean; summary: string | null;
};

export type DeckData = {
  project: { id: string; title: string; aspect: string; musicTrackId: string | null; status: string };
  deck: DeckState;
  scenes: DeckScene[];
  assets: DeckAsset[];
};

const toScene = (r: typeof schema.deckScenes.$inferSelect): DeckScene => ({
  id: r.id, orderIndex: r.orderIndex, role: r.role, assetId: r.assetId, inSec: r.inSec, outSec: r.outSec,
  durationSec: r.durationSec, textMode: r.textMode as SceneTextMode, text: (r.text ?? {}) as SceneText,
  layout: r.layout, motion: r.motion, transition: r.transition, locked: r.locked, prompt: r.prompt, why: r.why,
});

/** Everything the WaltzDeck editor shows. Polled while a plan or rewrite is running. */
export async function getDeck(projectId: string): Promise<DeckData> {
  await assertAccess(projectId, "viewer");
  const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const scenes = await db.select().from(schema.deckScenes).where(eq(schema.deckScenes.projectId, projectId)).orderBy(asc(schema.deckScenes.orderIndex));
  const assets = await db.select().from(schema.assets)
    .where(and(eq(schema.assets.projectId, projectId), eq(schema.assets.hidden, false), eq(schema.assets.uploadState, "uploaded")))
    .orderBy(asc(schema.assets.orderIndex), asc(schema.assets.createdAt));
  const deck = (p.deck ?? {}) as Partial<DeckState>;
  return {
    project: { id: p.id, title: p.title, aspect: p.aspect, musicTrackId: p.musicTrackId, status: p.status },
    deck: { brief: { ...defaultBrief(), ...(deck.brief ?? {}) }, plan: deck.plan ?? { status: "idle" } },
    scenes: scenes.map(toScene),
    assets: assets.map((a) => {
      const d = (a.aiDescription ?? null) as { summary?: string } | null;
      return {
        id: a.id, name: a.originalName ?? "file", kind: a.kind, durationSec: a.durationSec, note: a.note,
        rotation: a.rotation, described: !!d?.summary, summary: d?.summary ?? null,
      };
    }),
  };
}

/** Save the overall brief (mode, prompt, offer, CTA, length, text default). */
export async function saveBrief(projectId: string, input: Partial<DeckBrief>): Promise<void> {
  await assertAccess(projectId, "editor");
  const [p] = await db.select({ deck: schema.projects.deck }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const cur = { ...defaultBrief(), ...(((p.deck ?? {}) as Partial<DeckState>).brief ?? {}) };
  const mode = DECK_MODES.some((m) => m.key === input.mode) ? input.mode! : cur.mode;
  const next: DeckBrief = {
    mode,
    prompt: input.prompt !== undefined ? clip(input.prompt, 2000) : cur.prompt,
    goal: input.goal !== undefined ? clip(input.goal, 200) : cur.goal,
    audience: input.audience !== undefined ? clip(input.audience, 200) : cur.audience,
    tone: input.tone !== undefined ? clip(input.tone, 100) : cur.tone,
    offer: input.offer !== undefined ? clip(input.offer, 200) : cur.offer,
    cta: input.cta !== undefined
      ? (input.cta && clip(input.cta.text, 120) ? { text: clip(input.cta.text, 120), url: clip(input.cta.url, 300) || undefined } : null)
      : cur.cta,
    lengthSec: input.lengthSec !== undefined ? Math.max(6, Math.min(180, Math.round(Number(input.lengthSec) || cur.lengthSec))) : cur.lengthSec,
    textMode: input.textMode && ["auto", "manual", "off"].includes(input.textMode) ? input.textMode : cur.textMode,
  };
  await db.update(schema.projects).set({
    deck: sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{brief}', ${JSON.stringify(next)}::jsonb)`,
    lengthSec: next.lengthSec,
    updatedAt: new Date(),
  }).where(eq(schema.projects.id, projectId));
  revalidatePath(`/projects/${projectId}/deck`);
}

/** The per-item prompt for one photo/video ("hero shot — say it's organic", "show this last"). */
export async function setAssetNote(projectId: string, assetId: string, note: string): Promise<void> {
  await assertAccess(projectId, "editor");
  await db.update(schema.assets).set({ note: clip(note, 300) || null })
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)));
}

/** Warm the description cache for a just-uploaded file (planning later needs no wait for it). */
export async function describeAsset(projectId: string, assetId: string): Promise<void> {
  await assertAccess(projectId, "editor");
  await enqueueDeck({ name: "describe", data: { assetId } }, `describe-${assetId}`);
}

/** (Re)plan the storyboard. Locked scenes are kept; everything else is replaced. */
export async function requestPlan(projectId: string): Promise<void> {
  await assertAccess(projectId, "editor");
  const [p] = await db.select({ deck: schema.projects.deck }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const st = ((p.deck ?? {}) as Partial<DeckState>).plan?.status;
  if (st === "queued" || st === "describing" || st === "planning") throw new Error("Already planning — hang on a moment.");
  const brief = ((p.deck ?? {}) as Partial<DeckState>).brief;
  if (!brief?.prompt?.trim()) throw new Error("Write a short brief first — what is this video for?");
  await db.update(schema.projects).set({
    deck: sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{plan}', ${JSON.stringify({ status: "queued", startedAt: new Date().toISOString() })}::jsonb)`,
  }).where(eq(schema.projects.id, projectId));
  await enqueueDeck({ name: "plan", data: { projectId } }, `plan-${projectId}-${Date.now()}`);
}

export type ScenePatch = Partial<{
  text: SceneText; textMode: SceneTextMode; layout: string; durationSec: number; assetId: string | null;
  inSec: number | null; outSec: number | null; locked: boolean; motion: string; transition: string; role: string;
}>;

/** Edit one scene. Typing your own words makes the text Manual and locks the scene (re-plans keep it). */
export async function updateScene(projectId: string, sceneId: string, patch: ScenePatch): Promise<void> {
  await assertAccess(projectId, "editor");
  const set: Partial<typeof schema.deckScenes.$inferInsert> = { updatedAt: new Date() };
  if (patch.text) {
    set.text = {
      headline: clip(patch.text.headline, 90),
      sub: clip(patch.text.sub, 140),
      bullets: (patch.text.bullets ?? []).map((b) => clip(b, 60)).filter(Boolean).slice(0, 4),
    };
    set.textMode = "manual";
    set.locked = true;
  }
  if (patch.textMode && ["auto", "manual", "none"].includes(patch.textMode)) set.textMode = patch.textMode;
  if (patch.layout && LAYOUTS.some((l) => l.key === patch.layout)) set.layout = patch.layout;
  if (patch.role && (ROLES as readonly string[]).includes(patch.role)) set.role = patch.role;
  if (patch.motion && (MOTIONS as readonly string[]).includes(patch.motion)) set.motion = patch.motion;
  if (patch.transition && ["cut", "crossfade"].includes(patch.transition)) set.transition = patch.transition;
  if (patch.durationSec !== undefined) set.durationSec = Math.round(Math.max(0.8, Math.min(15, Number(patch.durationSec) || 3)) * 10) / 10;
  if (patch.locked !== undefined) set.locked = !!patch.locked;
  if (patch.inSec !== undefined) set.inSec = patch.inSec == null ? null : Math.max(0, Number(patch.inSec) || 0);
  if (patch.outSec !== undefined) set.outSec = patch.outSec == null ? null : Math.max(0, Number(patch.outSec) || 0);
  if (patch.assetId !== undefined) {
    if (patch.assetId) {
      const [a] = await db.select({ id: schema.assets.id }).from(schema.assets)
        .where(and(eq(schema.assets.id, patch.assetId), eq(schema.assets.projectId, projectId)));
      if (!a) throw new Error("That file isn't in this project");
    }
    set.assetId = patch.assetId;
    set.inSec = null;
    set.outSec = null;
  }
  await db.update(schema.deckScenes).set(set)
    .where(and(eq(schema.deckScenes.id, sceneId), eq(schema.deckScenes.projectId, projectId)));
}

/** Ask the AI to rewrite one scene's text: "rewrite" | "shorter" | "punchier" | the user's own instruction. */
export async function rewriteSceneText(projectId: string, sceneId: string, instruction: string): Promise<void> {
  await assertAccess(projectId, "editor");
  const ins = clip(instruction, 300) || "rewrite";
  const [s] = await db.select({ id: schema.deckScenes.id }).from(schema.deckScenes)
    .where(and(eq(schema.deckScenes.id, sceneId), eq(schema.deckScenes.projectId, projectId)));
  if (!s) throw new Error("Scene not found");
  await db.update(schema.deckScenes).set({
    prompt: ["rewrite", "shorter", "punchier"].includes(ins) ? undefined : ins,
    why: "Rewriting…", updatedAt: new Date(),
  }).where(eq(schema.deckScenes.id, sceneId));
  await enqueueDeck({ name: "scene", data: { sceneId, instruction: ins } });
}

/** New scene order (all scene ids of the project, in order). */
export async function reorderScenes(projectId: string, ids: string[]): Promise<void> {
  await assertAccess(projectId, "editor");
  const rows = await db.select({ id: schema.deckScenes.id }).from(schema.deckScenes).where(eq(schema.deckScenes.projectId, projectId));
  const known = new Set(rows.map((r) => r.id));
  const order = ids.filter((id) => known.has(id));
  if (order.length !== known.size) throw new Error("The scene list changed — refresh and try again");
  await db.transaction(async (tx) => {
    for (const [i, id] of order.entries()) await tx.update(schema.deckScenes).set({ orderIndex: i }).where(eq(schema.deckScenes.id, id));
  });
}

/** Add a scene after `afterIndex` (-1 = at the start) showing `assetId`, or a text card when null. */
export async function addScene(projectId: string, afterIndex: number, assetId: string | null): Promise<string> {
  await assertAccess(projectId, "editor");
  const rows = await db.select({ id: schema.deckScenes.id, orderIndex: schema.deckScenes.orderIndex })
    .from(schema.deckScenes).where(eq(schema.deckScenes.projectId, projectId)).orderBy(asc(schema.deckScenes.orderIndex));
  const at = Math.max(0, Math.min(rows.length, afterIndex + 1));
  const id = randomUUID();
  await db.transaction(async (tx) => {
    const shift = rows.slice(at).map((r) => r.id);
    if (shift.length) await tx.update(schema.deckScenes).set({ orderIndex: sql`${schema.deckScenes.orderIndex} + 1` }).where(inArray(schema.deckScenes.id, shift));
    await tx.insert(schema.deckScenes).values({
      id, projectId, orderIndex: at, role: assetId ? "content" : "title", assetId,
      durationSec: 3, textMode: "auto", text: {}, layout: assetId ? "headline-bottom" : "title-card", locked: false, why: "Added by you.",
    });
  });
  return id;
}

export async function deleteScene(projectId: string, sceneId: string): Promise<void> {
  await assertAccess(projectId, "editor");
  await db.delete(schema.deckScenes).where(and(eq(schema.deckScenes.id, sceneId), eq(schema.deckScenes.projectId, projectId)));
}
