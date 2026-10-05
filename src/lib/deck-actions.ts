"use server";
// WaltzDeck server actions (06_ClipWaltz_WaltzDeck_Feature_Spec.md). Planning and rewrites run on the
// generation worker (worker/deck/jobs.mjs) via the deck queue; the editor polls getDeck().
import { randomInt, randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { userCanAccessProject } from "./workspace";
import { enqueueDeck } from "./queue";
import { shouldWatermark } from "./watermark";
import { deleteObject } from "./storage";
import { toResult, unwrap, type ActionResult } from "./action-result";
import {
  CAMERA_MODES, DEFAULT_AUDIO, DUCK_MODES, MUSIC_TONES, VOICE_TONES, type DeckAudio,
  DECK_MODES, LANGUAGES, LAYOUTS, MAX_BRIEF_HISTORY, deckFillSeconds, MAX_BULLETS, MAX_BULLET_CHARS, MOTIONS, ROLES, VOICES, defaultBrief, defaultVoiceFor,
  type DeckBrief, type DeckExport, type DeckExportFormat, type DeckScene, type DeckState, type SceneText, type SceneTextMode,
  type ResolvedBackdrop, type SceneBackdrop, BACKDROP_PRESETS, type BackdropPresetKey, type LookKey,
} from "./deck/types";
import { normFrame, type SceneFrameBox } from "./deck/frame";
import { INTENSITIES, normBackdrop } from "../../worker/deck/backdrop.mjs";
import { LOOKS } from "../../worker/deck/motion.mjs";
const INTENSITY_KEYS: string[] = INTENSITIES;

/** The asset exists and belongs to this project (never trust a client-sent asset id). */
async function assertProjectAsset(projectId: string, assetId: string) {
  const [a] = await db.select({ id: schema.assets.id }).from(schema.assets)
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)));
  if (!a) throw new Error("That file isn't in this project");
}

/** A valid mix from whatever the client sent (levels clamped, unknown presets → defaults). */
function normAudio(a: Partial<DeckAudio> | null | undefined): DeckAudio {
  const n = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round((Number(v) || 0) * 2) / 2));
  const pick = <T extends string>(v: unknown, keys: readonly { key: T }[], d: T): T => (keys.some((k) => k.key === v) ? (v as T) : d);
  return {
    music: a?.music !== false,
    musicGainDb: n(a?.musicGainDb, -24, 6),
    voiceGainDb: n(a?.voiceGainDb, -12, 6),
    musicTone: pick(a?.musicTone, MUSIC_TONES, DEFAULT_AUDIO.musicTone),
    voiceTone: pick(a?.voiceTone, VOICE_TONES, DEFAULT_AUDIO.voiceTone),
    duck: pick(a?.duck, DUCK_MODES, DEFAULT_AUDIO.duck),
  };
}

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
  /** What the vision model saw (mood, summary, good-for, subject) — the text the camera's auto rules read. */
  seen: string;
};

export type DeckData = {
  project: { id: string; title: string; aspect: string; musicTrackId: string | null; status: string };
  deck: DeckState;
  scenes: DeckScene[];
  assets: DeckAsset[];
  /** Latest slide export per format (PDF / PPTX). */
  exports: DeckExport[];
  /** AI fill jobs per scene (the latest of the last day): running, or failed (credits refunded). */
  fills: Record<string, { status: string; progress: number; error: string | null }>;
  /** The deck's AI backdrop library, newest first. */
  backdropImages: { id: string; url: string; prompt: string; preset: string; tone: "light" | "dark"; grid?: number[]; createdAt: string }[];
  /** AI backdrops being made (or that failed in the last day — credits refunded). sceneId null = for the deck default. */
  backdropJobs: { id: string; sceneId: string | null; status: string; error: string | null }[];
};

/**
 * The backdrop a scene actually gets: its own, else the deck default, else the brand gradient — with an AI image
 * resolved to its URL and tone (an image that was deleted falls back to the brand gradient).
 */
function resolveBackdrop(projectId: string, own: unknown, deck: Partial<DeckState>): ResolvedBackdrop {
  const b = normBackdrop(own) ?? normBackdrop(deck.brief?.backdrop) ?? { style: "brand" as const, intensity: "balanced" as const, seed: 0 };
  if (b.style !== "ai") return b;
  const img = (deck.backdrops ?? []).find((x) => x.id === b.imageId);
  if (!img) return { style: "brand", intensity: b.intensity, seed: b.seed };
  return { ...b, imageUrl: `/api/projects/${projectId}/backdrops/${img.id}`, tone: img.tone, grid: img.grid };
}

const toScene = (r: typeof schema.deckScenes.$inferSelect, deck: Partial<DeckState>): DeckScene => ({
  id: r.id, orderIndex: r.orderIndex, role: r.role, assetId: r.assetId, inSec: r.inSec, outSec: r.outSec, frame: normFrame(r.frame),
  background: normBackdrop(r.background), backdrop: resolveBackdrop(r.projectId, r.background, deck),
  durationSec: r.durationSec, textMode: r.textMode as SceneTextMode, text: (r.text ?? {}) as SceneText,
  layout: r.layout, motion: r.motion, transition: r.transition, locked: r.locked, voice: r.voice, prompt: r.prompt, why: r.why,
});

/** Everything the WaltzDeck editor shows. Polled while a plan or rewrite is running. */
async function getDeckImpl(projectId: string): Promise<DeckData> {
  await assertAccess(projectId, "viewer");
  const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const scenes = await db.select().from(schema.deckScenes).where(eq(schema.deckScenes.projectId, projectId)).orderBy(asc(schema.deckScenes.orderIndex));
  const assets = await db.select().from(schema.assets)
    .where(and(eq(schema.assets.projectId, projectId), eq(schema.assets.hidden, false), eq(schema.assets.uploadState, "uploaded")))
    .orderBy(asc(schema.assets.orderIndex), asc(schema.assets.createdAt));
  const deck = (p.deck ?? {}) as Partial<DeckState>;
  const exportRows = await db.select().from(schema.deckExports).where(eq(schema.deckExports.projectId, projectId))
    .orderBy(desc(schema.deckExports.createdAt)).limit(20);
  const latest = (["pdf", "pptx"] as const).map((f) => exportRows.find((r) => r.format === f)).filter((r) => !!r);
  const fillRows = await db.select({
    sceneId: sql<string>`${schema.generationJobs.requestJson}->'deckFill'->>'sceneId'`, status: schema.generationJobs.status,
    progress: schema.generationJobs.progress, error: schema.generationJobs.errorMessage,
  }).from(schema.generationJobs)
    .where(and(eq(schema.generationJobs.projectId, projectId), sql`${schema.generationJobs.requestJson} ? 'deckFill'`,
      sql`${schema.generationJobs.createdAt} > now() - interval '1 day'`))
    .orderBy(desc(schema.generationJobs.createdAt));
  const fills: DeckData["fills"] = {};
  // Only each scene's LATEST fill job counts (an older failure is moot once a newer clip succeeded).
  const seenFill = new Set<string>();
  for (const f of fillRows) {
    if (!f.sceneId || seenFill.has(f.sceneId)) continue;
    seenFill.add(f.sceneId);
    if (!["completed", "retried"].includes(f.status)) fills[f.sceneId] = { status: f.status, progress: f.progress, error: f.error };
  }
  const bdRows = await db.select({
    id: schema.generationJobs.id, status: schema.generationJobs.status, error: schema.generationJobs.errorMessage,
    sceneId: sql<string | null>`${schema.generationJobs.requestJson}->'deckBackdrop'->>'sceneId'`,
  }).from(schema.generationJobs)
    .where(and(eq(schema.generationJobs.projectId, projectId), sql`${schema.generationJobs.requestJson} ? 'deckBackdrop'`,
      sql`${schema.generationJobs.createdAt} > now() - interval '1 day'`, sql`${schema.generationJobs.status} not in ('completed', 'retried')`))
    .orderBy(desc(schema.generationJobs.createdAt)).limit(10);
  return {
    project: { id: p.id, title: p.title, aspect: p.aspect, musicTrackId: p.musicTrackId, status: p.status },
    backdropImages: [...(deck.backdrops ?? [])].reverse().map((b) => ({
      id: b.id, url: `/api/projects/${projectId}/backdrops/${b.id}`, prompt: b.prompt, preset: b.preset, tone: b.tone, grid: b.grid, createdAt: b.createdAt,
    })),
    backdropJobs: bdRows.map((r) => ({ id: r.id, sceneId: r.sceneId, status: r.status, error: r.error })),
    deck: {
      brief: { ...defaultBrief(), ...(deck.brief ?? {}) }, plan: deck.plan ?? { status: "idle" }, import: deck.import ?? { status: "idle" },
      brandSuggestion: deck.brandSuggestion ?? { status: "idle" }, translation: deck.translation ?? { status: "idle" },
      chat: deck.chat ?? { status: "idle", messages: [] },
    },
    fills,
    exports: latest.map((r) => ({
      id: r.id, format: r.format as DeckExportFormat, status: r.status as DeckExport["status"], error: r.error,
      createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
    scenes: scenes.map((r) => toScene(r, deck)),
    assets: assets.map((a) => {
      const d = (a.aiDescription ?? null) as { summary?: string; mood?: string; goodFor?: string[]; subject?: string } | null;
      return {
        id: a.id, name: a.originalName ?? "file", kind: a.kind, durationSec: a.durationSec, note: a.note,
        rotation: a.rotation, described: !!d?.summary, summary: d?.summary ?? null,
        seen: [d?.mood, d?.summary, ...(d?.goodFor ?? []), d?.subject].filter(Boolean).join(" "),
      };
    }),
  };
}

/** Save the overall brief (mode, prompt, offer, CTA, length, text default). */
async function saveBriefImpl(projectId: string, input: Partial<DeckBrief>): Promise<void> {
  const userId = await assertAccess(projectId, "editor");
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
    voice: input.voice !== undefined
      ? {
          mode: ["off", "auto", "manual"].includes(input.voice?.mode ?? "") ? input.voice!.mode : "off",
          voiceId: VOICES.some((v) => v.id === input.voice?.voiceId) ? input.voice!.voiceId : "af_heart",
          speed: Math.max(0.8, Math.min(1.25, Number(input.voice?.speed) || 1)),
        }
      : cur.voice ?? defaultBrief().voice,
    captions: input.captions !== undefined ? { enabled: !!input.captions?.enabled } : cur.captions ?? defaultBrief().captions,
    language: input.language !== undefined ? (LANGUAGES.some((l) => l.code === input.language) ? input.language : "en") : cur.language,
    translatedFrom: cur.translatedFrom ?? null,
    audio: input.audio !== undefined ? normAudio(input.audio) : cur.audio,
    camera: input.camera !== undefined
      ? { mode: CAMERA_MODES.some((m) => m.key === input.camera?.mode) ? input.camera!.mode : "off" }
      : cur.camera,
    // Only setDeckBackdrop changes it (the editor's brief copy can be older than a backdrop the worker just made).
    backdrop: cur.backdrop,
    motion: cur.motion, // setDeckMotion / the planner own it
  };
  // A voice must speak the brief's language: switching language picks that language's first voice.
  if (next.voice && next.language && VOICES.find((v) => v.id === next.voice!.voiceId)?.lang !== next.language) {
    next.voice = { ...next.voice, voiceId: defaultVoiceFor(next.language) };
  }
  // Presentations are slides: switching a vertical project to Presentation makes it 16:9 (the aspect can
  // still be changed back in the project settings).
  const [pa] = await db.select({ aspect: schema.projects.aspect }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const toWide = next.mode === "presentation" && cur.mode !== "presentation" && pa?.aspect === "9:16";
  await db.update(schema.projects).set({
    deck: sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{brief}', ${JSON.stringify(next)}::jsonb)`,
    lengthSec: next.lengthSec,
    ...(toWide ? { aspect: "16:9" } : {}),
    updatedAt: new Date(),
  }).where(eq(schema.projects.id, projectId));
  if (input.prompt !== undefined && next.prompt !== cur.prompt) await rememberBrief(userId, next.prompt).catch(() => {});
  revalidatePath(`/projects/${projectId}/deck`);
}

/** The per-item prompt for one photo/video ("hero shot — say it's organic", "show this last"). */
async function setAssetNoteImpl(projectId: string, assetId: string, note: string): Promise<void> {
  await assertAccess(projectId, "editor");
  await db.update(schema.assets).set({ note: clip(note, 300) || null })
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)));
}

/** Warm the description cache for a just-uploaded file (planning later needs no wait for it). */
async function describeAssetImpl(projectId: string, assetId: string): Promise<void> {
  await assertAccess(projectId, "editor");
  await assertProjectAsset(projectId, assetId);
  await enqueueDeck({ name: "describe", data: { assetId } }, `describe-${assetId}`);
}

/** (Re)plan the storyboard. Locked scenes are kept; everything else is replaced. */
async function requestPlanImpl(projectId: string): Promise<void> {
  await assertAccess(projectId, "editor");
  const [p] = await db.select({ deck: schema.projects.deck }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const cur = ((p.deck ?? {}) as Partial<DeckState>).plan as { status?: string; startedAt?: string } | undefined;
  const busy = cur?.status === "queued" || cur?.status === "describing" || cur?.status === "planning";
  // A plan older than 20 min is stale (job lost in a redeploy / Redis hiccup) — let a new one start.
  const stale = !cur?.startedAt || Date.now() - Date.parse(cur.startedAt) > 20 * 60 * 1000;
  if (busy && !stale) throw new Error("Already planning — hang on a moment.");
  const brief = ((p.deck ?? {}) as Partial<DeckState>).brief;
  if (!brief?.prompt?.trim()) throw new Error("Write a short brief first — what is this video for?");
  await db.update(schema.projects).set({
    deck: sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{plan}', ${JSON.stringify({ status: "queued", startedAt: new Date().toISOString() })}::jsonb)`,
  }).where(eq(schema.projects.id, projectId));
  try {
    await enqueueDeck({ name: "plan", data: { projectId } }, `plan-${projectId}-${Date.now()}`);
  } catch {
    await db.update(schema.projects).set({
      deck: sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{plan}', ${JSON.stringify({ status: "failed", error: "Couldn't reach the planner — try again in a moment." })}::jsonb)`,
    }).where(eq(schema.projects.id, projectId));
    throw new Error("Couldn't reach the planner — try again in a moment.");
  }
}

export type ScenePatch = Partial<{
  text: SceneText; textMode: SceneTextMode; layout: string; durationSec: number; assetId: string | null; voice: string;
  inSec: number | null; outSec: number | null; locked: boolean; motion: string; transition: string; role: string;
  frame: SceneFrameBox | null;
  background: SceneBackdrop | null;
}>;

/** Edit one scene. Typing your own words makes the text Manual and locks the scene (re-plans keep it). */
async function updateSceneImpl(projectId: string, sceneId: string, patch: ScenePatch): Promise<void> {
  await assertAccess(projectId, "editor");
  const set: Partial<typeof schema.deckScenes.$inferInsert> = { updatedAt: new Date() };
  if (patch.text) {
    set.text = {
      headline: clip(patch.text.headline, 90),
      sub: clip(patch.text.sub, 140),
      bullets: (patch.text.bullets ?? []).map((b) => clip(b, MAX_BULLET_CHARS)).filter(Boolean).slice(0, MAX_BULLETS),
    };
    set.textMode = "manual";
    set.locked = true;
  }
  if (patch.voice !== undefined) {
    // Your own narration is kept by re-plans, like your own text.
    set.voice = clip(patch.voice, 400) || null;
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
  if (patch.frame !== undefined) set.frame = normFrame(patch.frame);
  if (patch.background !== undefined) set.background = normBackdrop(patch.background);
  if (patch.assetId !== undefined) {
    if (patch.assetId) await assertProjectAsset(projectId, patch.assetId);
    set.assetId = patch.assetId;
    set.inSec = null;
    set.outSec = null;
    set.frame = null;
  }
  await db.update(schema.deckScenes).set(set)
    .where(and(eq(schema.deckScenes.id, sceneId), eq(schema.deckScenes.projectId, projectId)));
}

/** Ask the AI to rewrite one scene's text: "rewrite" | "shorter" | "punchier" | the user's own instruction. */
async function rewriteSceneTextImpl(projectId: string, sceneId: string, instruction: string): Promise<void> {
  await assertAccess(projectId, "editor");
  const ins = clip(instruction, 600) || "rewrite";
  const [s] = await db.select({ id: schema.deckScenes.id }).from(schema.deckScenes)
    .where(and(eq(schema.deckScenes.id, sceneId), eq(schema.deckScenes.projectId, projectId)));
  if (!s) throw new Error("Scene not found");
  // (The instruction used to be kept in deck_scenes.prompt — that column is now the scene's suggested AI shot.)
  await db.update(schema.deckScenes).set({
    why: "Rewriting…", updatedAt: new Date(),
  }).where(eq(schema.deckScenes.id, sceneId));
  await enqueueDeck({ name: "scene", data: { sceneId, instruction: ins } });
}

/** New scene order (all scene ids of the project, in order). */
async function reorderScenesImpl(projectId: string, ids: string[]): Promise<void> {
  await assertAccess(projectId, "editor");
  const rows = await db.select({ id: schema.deckScenes.id }).from(schema.deckScenes).where(eq(schema.deckScenes.projectId, projectId));
  const known = new Set(rows.map((r) => r.id));
  const order = [...new Set(ids)].filter((id) => known.has(id));
  if (order.length !== known.size) throw new Error("The scene list changed — refresh and try again");
  await db.transaction(async (tx) => {
    for (const [i, id] of order.entries()) await tx.update(schema.deckScenes).set({ orderIndex: i }).where(eq(schema.deckScenes.id, id));
  });
}

/** What a new scene is: a title card, a slide, a call-to-action card, a scene showing a file, or a copy of a scene. */
export type NewScene =
  | { kind: "title" | "slide" | "cta"; write?: boolean }
  | { kind: "media"; assetId: string; write?: boolean }
  | { kind: "duplicate"; sceneId: string };

/**
 * Insert a scene at position `at` (0 = the very start, scenes.length = the end). With `write`, the AI writes its words
 * to fit between the scenes before and after it (the deck worker's scene rewrite). Returns the new scene id.
 */
async function insertSceneImpl(projectId: string, at: number, spec: NewScene): Promise<string> {
  await assertAccess(projectId, "editor");
  const rows = await db.select().from(schema.deckScenes)
    .where(eq(schema.deckScenes.projectId, projectId)).orderBy(asc(schema.deckScenes.orderIndex));
  const pos = Math.max(0, Math.min(rows.length, Math.trunc(Number(at)) || 0));
  const [p] = await db.select({ deck: schema.projects.deck }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const brief = { ...defaultBrief(), ...(((p?.deck ?? {}) as Partial<DeckState>).brief ?? {}) };
  const id = randomUUID();
  let values: typeof schema.deckScenes.$inferInsert;
  if (spec.kind === "duplicate") {
    const src = rows.find((r) => r.id === spec.sceneId);
    if (!src) throw new Error("Scene not found");
    const { id: _i, createdAt: _c, updatedAt: _u, orderIndex: _o, ...rest } = src;
    void _i; void _c; void _u; void _o;
    values = { ...rest, id, projectId, orderIndex: pos, why: `Copy of scene ${src.orderIndex + 1}.` };
  } else if (spec.kind === "media") {
    await assertProjectAsset(projectId, spec.assetId);
    values = {
      id, projectId, orderIndex: pos, role: "content", assetId: spec.assetId, durationSec: 3, textMode: "auto", text: {},
      layout: brief.mode === "presentation" ? "slide" : "headline-bottom", locked: false, why: "Added by you.",
    };
  } else {
    const kind = spec.kind;
    values = {
      id, projectId, orderIndex: pos, role: kind === "cta" ? "cta" : kind === "slide" ? "content" : "title", assetId: null,
      durationSec: kind === "slide" ? 5 : 3, textMode: "auto",
      // A call to action starts from the brief's CTA, so it's useful even before the AI writes.
      text: kind === "cta" && brief.cta?.text ? { headline: "", sub: brief.cta.text } : {},
      layout: kind === "cta" ? "cta-card" : kind === "slide" ? "slide" : "title-card", locked: false, why: "Added by you.",
    };
  }
  const write = spec.kind !== "duplicate" && !!spec.write;
  if (write) values.why = "Rewriting…";
  await db.transaction(async (tx) => {
    const shift = rows.slice(pos).map((r) => r.id);
    if (shift.length) await tx.update(schema.deckScenes).set({ orderIndex: sql`${schema.deckScenes.orderIndex} + 1` }).where(inArray(schema.deckScenes.id, shift));
    await tx.insert(schema.deckScenes).values(values);
  });
  if (write) {
    const say = (r: (typeof rows)[number] | undefined) => {
      const t = (r?.text ?? {}) as SceneText;
      return t.headline || t.sub || (t.bullets ?? [])[0] || "";
    };
    const before = say(rows[pos - 1]), after = say(rows[pos]);
    const where = !rows.length ? "the only scene" : pos === 0 ? "the opening scene" : pos === rows.length ? "the closing scene" : "a new scene in the middle";
    const instruction = clip(`This is ${where} of the video.${before ? ` The scene before says "${before}".` : ""}${after ? ` The scene after says "${after}".` : ""} Write it so the story flows.`, 300);
    try {
      await enqueueDeck({ name: "scene", data: { sceneId: id, instruction } });
    } catch {
      await db.update(schema.deckScenes).set({ why: "Added by you." }).where(eq(schema.deckScenes.id, id));
    }
  }
  return id;
}

/** Add a scene after `afterIndex` (-1 = at the start) showing `assetId`, or a title card when null. */
async function addSceneImpl(projectId: string, afterIndex: number, assetId: string | null): Promise<string> {
  return insertSceneImpl(projectId, afterIndex + 1, assetId ? { kind: "media", assetId } : { kind: "title" });
}

async function deleteSceneImpl(projectId: string, sceneId: string): Promise<void> {
  await assertAccess(projectId, "editor");
  await db.delete(schema.deckScenes).where(and(eq(schema.deckScenes.id, sceneId), eq(schema.deckScenes.projectId, projectId)));
}

// ── Slide exports (phase 3) ────────────────────────────────────────────────────────────────────────

/**
 * Queue a PDF or PowerPoint export of the storyboard. The render worker on the AI box builds it from the same
 * templates as the video (worker/deck/export.mjs); the editor polls getDeck(). One export per format at a time.
 */
async function requestDeckExportImpl(projectId: string, format: DeckExportFormat): Promise<void> {
  const userId = await assertAccess(projectId, "editor");
  if (format !== "pdf" && format !== "pptx") throw new Error("Unknown export format");
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.deckScenes).where(eq(schema.deckScenes.projectId, projectId));
  if (!n?.n) throw new Error("Plan the storyboard first — there are no slides yet.");
  const [busy] = await db.select({ id: schema.deckExports.id, createdAt: schema.deckExports.createdAt }).from(schema.deckExports)
    .where(and(eq(schema.deckExports.projectId, projectId), eq(schema.deckExports.format, format), inArray(schema.deckExports.status, ["queued", "running"])));
  // A job stuck for 30 min (worker restart mid-export) doesn't block a new one; the worker's reaper fails it.
  if (busy && Date.now() - busy.createdAt.getTime() < 30 * 60 * 1000) throw new Error("That export is already being made — hang on a moment.");
  await db.insert(schema.deckExports).values({
    id: randomUUID(), projectId, format, status: "queued", watermark: await shouldWatermark(userId), requestedBy: userId,
  });
  revalidatePath(`/projects/${projectId}/deck`);
}

// ── Import (phase 3) ───────────────────────────────────────────────────────────────────────────────

/**
 * Fill the brief from a public web page (a product page, a landing page). The deck worker fetches it with SSRF
 * guards (worker/deck/importer.mjs) and, when the project already has media and no storyboard, plans right away.
 * Files (PPTX / PDF) go through POST /api/projects/[id]/deck-import instead.
 */
async function importFromUrlImpl(projectId: string, rawUrl: string): Promise<void> {
  const userId = await assertAccess(projectId, "editor");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`);
  } catch {
    throw new Error("That doesn't look like a web address.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) throw new Error("That doesn't look like a web address.");
  const [p] = await db.select({ deck: schema.projects.deck }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const cur = ((p.deck ?? {}) as Partial<DeckState>).import as { status?: string; startedAt?: string } | undefined;
  if (cur && ["queued", "reading", "summarizing"].includes(cur.status ?? "") && cur.startedAt && Date.now() - Date.parse(cur.startedAt) < 15 * 60 * 1000) {
    throw new Error("An import is already running — hang on a moment.");
  }
  const name = url.toString().slice(0, 200);
  const setImport = (st: object) => db.update(schema.projects).set({
    deck: sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{import}', ${JSON.stringify(st)}::jsonb)`,
  }).where(eq(schema.projects.id, projectId));
  await setImport({ status: "queued", source: "url", name, startedAt: new Date().toISOString() });
  try {
    await enqueueDeck({ name: "import", data: { projectId, source: "url", url: url.toString(), name, userId } }, `import-${projectId}-${Date.now()}`);
  } catch {
    await setImport({ status: "failed", source: "url", name, error: "Couldn't reach the importer — try again in a moment." });
    throw new Error("Couldn't reach the importer — try again in a moment.");
  }
}

// ── AI fill (phase 5) ──────────────────────────────────────────────────────────────────────────────

/** Clip lengths Waltz AI makes (src/components/generation-panel.tsx DURATIONS); the scene gets the shortest that covers it. */
/** Waltz AI frame sizes (divisible by 16) per project shape; 4:5 is generated portrait and cropped by the render. */
const FILL_SIZE: Record<string, { w: number; h: number }> = {
  "16:9": { w: 1280, h: 720 }, "9:16": { w: 720, h: 1280 }, "1:1": { w: 768, h: 768 }, "4:5": { w: 720, h: 1280 },
};
const fillSeconds = deckFillSeconds;

/**
 * Make an AI clip for a scene and put it in the scene when it's ready (costs AI credits, refunded if it fails):
 *   "animate"  — bring the scene's photo to life (image-to-video)
 *   "generate" — a new shot from a description (text-to-video); `prompt` defaults to the scene's text + brief.
 */
export async function fillScene(projectId: string, sceneId: string, input: { mode: "animate" | "generate"; prompt?: string }): Promise<ActionResult<string>> {
  // Errors are returned, not thrown (src/lib/action-result.ts) — "not enough AI credits" must reach the user.
  return toResult(() => fillSceneImpl(projectId, sceneId, input));
}

async function fillSceneImpl(projectId: string, sceneId: string, input: { mode: "animate" | "generate"; prompt?: string }): Promise<string> {
  await assertAccess(projectId, "editor");
  const [sc] = await db.select().from(schema.deckScenes).where(and(eq(schema.deckScenes.id, sceneId), eq(schema.deckScenes.projectId, projectId)));
  if (!sc) throw new Error("Scene not found");
  const [p] = await db.select({ aspect: schema.projects.aspect, deck: schema.projects.deck }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const brief = { ...defaultBrief(), ...(((p.deck ?? {}) as Partial<DeckState>).brief ?? {}) };
  const text = (sc.text ?? {}) as SceneText;
  // One AI clip per scene at a time (a double click or a retried "Film all" would otherwise charge twice).
  const [running] = await db.select({ id: schema.generationJobs.id }).from(schema.generationJobs)
    .where(and(eq(schema.generationJobs.projectId, projectId), sql`${schema.generationJobs.requestJson}->'deckFill'->>'sceneId' = ${sceneId}`,
      sql`${schema.generationJobs.status} not in ('completed', 'failed', 'cancelled', 'retried')`,
      sql`${schema.generationJobs.createdAt} > now() - interval '6 hours'`)).limit(1); // the worker gives up after 3 h
  if (running) throw new Error("This scene already has an AI clip on the way.");
  const size = FILL_SIZE[p.aspect] ?? FILL_SIZE["9:16"];
  const durationSec = fillSeconds(sc.durationSec);
  const { createGenerationJob } = await import("./generation-actions");
  if (input.mode === "animate") {
    const [a] = sc.assetId ? await db.select().from(schema.assets).where(and(eq(schema.assets.id, sc.assetId), eq(schema.assets.projectId, projectId))) : [];
    if (!a || a.kind !== "photo") throw new Error("This scene needs a photo to bring to life.");
    const seen = ((a.aiDescription ?? {}) as { summary?: string }).summary;
    const prompt = clip([seen, text.headline, a.note, "Gentle, natural motion; the camera moves slowly; keep the subject as it is."].filter(Boolean).join(". "), 900);
    return unwrap(await createGenerationJob({
      projectId, jobType: "image_to_video", sourceAssetId: a.id, prompt, userPrompt: prompt, quality: "standard",
      durationSec, width: size.w, height: size.h, motion: "balanced", deckFill: { sceneId },
    }));
  }
  const prompt = clip(input.prompt, 900) || clip([text.headline, text.sub, `for ${brief.prompt}`].filter(Boolean).join(". "), 900);
  if (!prompt) throw new Error("Describe the shot you want.");
  return unwrap(await createGenerationJob({
    projectId, jobType: "text_to_video", prompt, userPrompt: prompt, quality: "standard",
    durationSec, width: size.w, height: size.h, motion: "balanced", deckFill: { sceneId },
  }));
}

// ── AI backdrops ───────────────────────────────────────────────────────────────────────────────────

/** A still per deck aspect (multiples of 32 for Wan 2.2; 1280×704 verified 2026-10-03, ~20 s on one RTX 3080). */
const BACKDROP_SIZE: Record<string, { w: number; h: number }> = {
  "16:9": { w: 1280, h: 704 }, "9:16": { w: 704, h: 1280 }, "1:1": { w: 960, h: 960 }, "4:5": { w: 832, h: 1024 },
};
const BACKDROP_NEGATIVE = "text, letters, words, watermark, logo, signature, people, faces, hands, clutter, busy, noisy, low quality, blurry, distorted, dark, underexposed";

/** The brand's main colour as a word the image model understands. */
function colorWord(hex: string | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "violet";
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.08) return max > 0.7 ? "soft white" : max < 0.25 ? "deep charcoal" : "silver grey";
  const h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  const hue = (h + 360) % 360;
  return hue < 15 ? "red" : hue < 40 ? "orange" : hue < 65 ? "golden yellow" : hue < 160 ? "green" : hue < 195 ? "teal"
    : hue < 250 ? "blue" : hue < 290 ? "violet" : hue < 330 ? "magenta" : "red";
}

/**
 * Make an AI backdrop (costs BACKDROP_COST credits, refunded if it fails). It joins the deck's backdrop library and is
 * applied to `sceneId`, or to the deck default (every text scene without its own backdrop) when sceneId is null.
 */
export async function generateBackdrop(projectId: string, input: { preset: BackdropPresetKey; prompt?: string; sceneId?: string | null; intensity?: string }): Promise<ActionResult<string>> {
  return toResult(async () => {
    await assertAccess(projectId, "editor");
    const [p] = await db.select({ aspect: schema.projects.aspect, brandKitId: schema.projects.brandKitId }).from(schema.projects).where(eq(schema.projects.id, projectId));
    let primary: string | undefined;
    if (p.brandKitId) {
      const [bk] = await db.select({ colors: schema.brandKits.colorsJson }).from(schema.brandKits).where(eq(schema.brandKits.id, p.brandKitId));
      primary = Array.isArray(bk?.colors) ? (bk.colors as string[])[0] : undefined;
    }
    const preset = BACKDROP_PRESETS.find((x) => x.key === input.preset);
    const own = clip(input.prompt, 400);
    const base = preset ? preset.prompt.replace("{color}", colorWord(primary)) : own;
    if (!base) throw new Error("Describe the backdrop you want, or pick a style.");
    const prompt = clip(`${base}${preset && own ? `. ${own}` : ""}. No text, no letters, no logos, no people, high quality, sharp`, 900);
    const size = BACKDROP_SIZE[p.aspect] ?? BACKDROP_SIZE["9:16"];
    const { createGenerationJob } = await import("./generation-actions");
    return unwrap(await createGenerationJob({
      projectId, jobType: "text_to_video", prompt, userPrompt: own || preset?.label || "", negativePrompt: BACKDROP_NEGATIVE,
      quality: "standard", width: size.w, height: size.h, durationSec: 1, motion: "balanced",
      deckBackdrop: { sceneId: input.sceneId ?? null, preset: preset?.key ?? "custom", intensity: INTENSITY_KEYS.includes(input.intensity ?? "") ? input.intensity : "balanced" },
    }));
  });
}

/** The deck default backdrop (every text scene without its own); null = the brand gradient. */
export async function setDeckBackdrop(projectId: string, backdrop: SceneBackdrop | null): Promise<ActionResult<void>> {
  return toResult(async () => {
    await assertAccess(projectId, "editor");
    const b = normBackdrop(backdrop);
    await db.update(schema.projects).set({
      deck: b
        ? sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{brief}',
            coalesce(${schema.projects.deck}->'brief', '{}'::jsonb) || jsonb_build_object('backdrop', ${JSON.stringify(b)}::jsonb))`
        : sql`coalesce(${schema.projects.deck}, '{}'::jsonb) #- '{brief,backdrop}'`,
      updatedAt: new Date(),
    }).where(eq(schema.projects.id, projectId));
  });
}

/**
 * The animated scenes' look (or "auto") and/or a new seed ("Shuffle": every animated scene gets a new variant; with
 * auto, a new look too). Returns the new setting.
 */
export async function setDeckMotion(projectId: string, input: { look?: string; shuffle?: boolean }): Promise<ActionResult<{ look: LookKey | "auto"; seed: number }>> {
  return toResult(async () => {
    await assertAccess(projectId, "editor");
    const [p] = await db.select({ deck: schema.projects.deck }).from(schema.projects).where(eq(schema.projects.id, projectId));
    const cur = ((p?.deck ?? {}) as Partial<DeckState>).brief?.motion;
    const look = input.look === "auto" || LOOKS.some((l) => l.key === input.look) ? (input.look as LookKey | "auto") : cur?.look ?? "auto";
    const seed = input.shuffle || !cur ? randomInt(1, 2 ** 31 - 1) : cur.seed;
    const motion = { look, seed };
    await db.update(schema.projects).set({
      deck: sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{brief}',
        coalesce(${schema.projects.deck}->'brief', '{}'::jsonb) || jsonb_build_object('motion', ${JSON.stringify(motion)}::jsonb))`,
      updatedAt: new Date(),
    }).where(eq(schema.projects.id, projectId));
    return motion;
  });
}

/** Remove an AI backdrop from the library; scenes (and the deck default) that used it go back to the deck default. */
export async function deleteBackdropImage(projectId: string, imageId: string): Promise<ActionResult<void>> {
  return toResult(async () => {
    await assertAccess(projectId, "editor");
    const key = await db.transaction(async (tx) => {
      const [p] = await tx.select({ deck: schema.projects.deck }).from(schema.projects).where(eq(schema.projects.id, projectId)).for("update");
      const deck = (p.deck ?? {}) as Partial<DeckState>;
      const img = (deck.backdrops ?? []).find((x) => x.id === imageId);
      if (!img) return null;
      const brief = deck.brief ? { ...deck.brief } : undefined;
      if (brief?.backdrop?.imageId === imageId) delete brief.backdrop;
      await tx.update(schema.projects).set({ deck: { ...deck, ...(brief ? { brief } : {}), backdrops: (deck.backdrops ?? []).filter((x) => x.id !== imageId) } })
        .where(eq(schema.projects.id, projectId));
      await tx.update(schema.deckScenes).set({ background: null, updatedAt: new Date() })
        .where(and(eq(schema.deckScenes.projectId, projectId), sql`${schema.deckScenes.background}->>'imageId' = ${imageId}`));
      return img.key;
    });
    // Translated copies share the file: only delete it when no other deck still lists it.
    if (key) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.projects)
        .where(sql`${schema.projects.deck}->'backdrops' @> ${JSON.stringify([{ key }])}::jsonb`);
      if (!n) await deleteObject(key).catch(() => {});
    }
  });
}

// ── Translate (phase 5) ────────────────────────────────────────────────────────────────────────────

/**
 * A translated copy of this deck: same clips (the same stored files), scenes, look and brand, with the words — scene
 * text, points, narration and brief — translated on the deck worker, voiced by a voice of that language and captioned
 * in it. The original is never touched. Returns the new project id (the editor opens it and shows the progress).
 */
/** "Edit with AI": add the owner's message to the deck chat and ask the deck worker to answer it (and change the storyboard). */
async function askDeckAiImpl(projectId: string, message: string): Promise<void> {
  await assertAccess(projectId, "editor");
  const text = clip(message, 1500);
  if (!text) throw new Error("Type what you'd like to change.");
  const [p] = await db.select({ deck: schema.projects.deck }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const deck = (p?.deck ?? {}) as Partial<DeckState>;
  const chat = deck.chat;
  // One message at a time; a turn older than 10 min is stale (job lost in a redeploy) and doesn't block.
  if (chat?.status === "thinking" && chat.startedAt && Date.now() - Date.parse(chat.startedAt) < 10 * 60 * 1000) throw new Error("Still working on your last message — one moment.");
  const plan = deck.plan as { status?: string } | undefined;
  if (plan?.status === "queued" || plan?.status === "describing" || plan?.status === "planning") throw new Error("The video is being planned — try again when it's ready.");
  const messages = [...(chat?.messages ?? []), { id: randomUUID(), role: "user" as const, text, at: new Date().toISOString() }].slice(-40);
  const next = { status: "thinking", error: null, startedAt: new Date().toISOString(), messages };
  await db.update(schema.projects).set({
    deck: sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{chat}', ${JSON.stringify(next)}::jsonb)`,
  }).where(eq(schema.projects.id, projectId));
  try {
    await enqueueDeck({ name: "chat", data: { projectId } }, `chat-${projectId}-${Date.now()}`);
  } catch {
    const failed = { ...next, status: "failed", error: "Couldn't reach the AI — try again in a moment." };
    await db.update(schema.projects).set({ deck: sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{chat}', ${JSON.stringify(failed)}::jsonb)` })
      .where(eq(schema.projects.id, projectId));
    throw new Error("Couldn't reach the AI — try again in a moment.");
  }
}

/** Start the chat over (the storyboard isn't touched). */
async function clearDeckChatImpl(projectId: string): Promise<void> {
  await assertAccess(projectId, "editor");
  await db.update(schema.projects).set({ deck: sql`coalesce(${schema.projects.deck}, '{}'::jsonb) #- '{chat}'` }).where(eq(schema.projects.id, projectId));
}

async function translateDeckImpl(projectId: string, lang: string): Promise<string> {
  const userId = await assertAccess(projectId, "editor");
  const L = LANGUAGES.find((l) => l.code === lang);
  if (!L) throw new Error("Pick a language");
  const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const deck = (p.deck ?? {}) as Partial<DeckState>;
  const brief = { ...defaultBrief(), ...(deck.brief ?? {}) };
  if ((brief.language ?? "en") === lang) throw new Error(`This deck is already in ${L.name}.`);
  const scenes = await db.select().from(schema.deckScenes).where(eq(schema.deckScenes.projectId, projectId)).orderBy(asc(schema.deckScenes.orderIndex));
  if (!scenes.length) throw new Error("Plan the storyboard first — there's nothing to translate yet.");
  const assets = await db.select().from(schema.assets).where(eq(schema.assets.projectId, projectId));
  const id = randomUUID();
  const assetMap = new Map(assets.map((a) => [a.id, randomUUID()]));
  const nextBrief = {
    ...brief, language: L.code, translatedFrom: { projectId, title: p.title },
    voice: { ...(brief.voice ?? defaultBrief().voice!), voiceId: defaultVoiceFor(L.code) },
  };
  await db.transaction(async (tx) => {
    const { id: _id, createdAt: _c, updatedAt: _u, deck: _d, title, ...rest } = p;
    void _id; void _c; void _u; void _d;
    await tx.insert(schema.projects).values({
      ...rest, id, ownerId: userId, title: `${title} (${L.label})`.slice(0, 120), status: "draft",
      deck: { brief: nextBrief, backdrops: deck.backdrops ?? [], plan: { status: "idle" }, translation: { status: "queued", lang: L.code, startedAt: new Date().toISOString() } },
    });
    // Clips point at the same stored files (the storage purge keeps a file while any row still uses it).
    // Keep createdAt: Free-plan retention ages an upload from when it was first added — a copy must not restart it.
    for (const a of assets) {
      const { id: aid, ...ar } = a;
      await tx.insert(schema.assets).values({ ...ar, id: assetMap.get(aid)!, projectId: id });
    }
    for (const sc of scenes) {
      const { id: _sid, createdAt: _sc, updatedAt: _su, ...sr } = sc;
      void _sid; void _sc; void _su;
      await tx.insert(schema.deckScenes).values({ ...sr, id: randomUUID(), projectId: id, assetId: sc.assetId ? assetMap.get(sc.assetId) ?? null : null });
    }
  });
  try {
    await enqueueDeck({ name: "translate", data: { projectId: id } });
  } catch {
    await db.update(schema.projects).set({
      deck: sql`jsonb_set(coalesce(${schema.projects.deck}, '{}'::jsonb), '{translation}', ${JSON.stringify({ status: "failed", lang: L.code, error: "Couldn't reach the translator — try again." })}::jsonb)`,
    }).where(eq(schema.projects.id, id));
  }
  revalidatePath("/projects");
  return id;
}

// ── Brief history ("What is this video for?") ──────────────────────────────────────────────────────

/** Remember a brief in the user's history (re-using one moves it to the top); keeps the newest MAX_BRIEF_HISTORY. */
async function rememberBrief(userId: string, text: string) {
  const t = clip(text, 2000);
  if (t.length < 10) return;
  await db.insert(schema.deckBriefHistory).values({ id: randomUUID(), userId, text: t, usedAt: new Date() })
    .onConflictDoUpdate({ target: [schema.deckBriefHistory.userId, schema.deckBriefHistory.text], set: { usedAt: new Date() } });
  const old = await db.select({ id: schema.deckBriefHistory.id }).from(schema.deckBriefHistory)
    .where(eq(schema.deckBriefHistory.userId, userId)).orderBy(desc(schema.deckBriefHistory.usedAt)).offset(MAX_BRIEF_HISTORY);
  if (old.length) await db.delete(schema.deckBriefHistory).where(inArray(schema.deckBriefHistory.id, old.map((o) => o.id)));
}

/** The signed-in user's recent briefs, newest first. */
async function getBriefHistoryImpl(): Promise<{ id: string; text: string }[]> {
  const userId = await requireUserId();
  return db.select({ id: schema.deckBriefHistory.id, text: schema.deckBriefHistory.text }).from(schema.deckBriefHistory)
    .where(eq(schema.deckBriefHistory.userId, userId)).orderBy(desc(schema.deckBriefHistory.usedAt)).limit(MAX_BRIEF_HISTORY);
}

async function removeBriefHistoryImpl(id: string): Promise<void> {
  const userId = await requireUserId();
  await db.delete(schema.deckBriefHistory).where(and(eq(schema.deckBriefHistory.id, id), eq(schema.deckBriefHistory.userId, userId)));
}

// Exported actions return ActionResult (action-result.ts — thrown messages are hidden in production builds).
// Client: unwrap(await action(...)).
export async function getDeck(...args: Parameters<typeof getDeckImpl>) { return toResult(() => getDeckImpl(...args)); }
export async function saveBrief(...args: Parameters<typeof saveBriefImpl>) { return toResult(() => saveBriefImpl(...args)); }
export async function setAssetNote(...args: Parameters<typeof setAssetNoteImpl>) { return toResult(() => setAssetNoteImpl(...args)); }
export async function describeAsset(...args: Parameters<typeof describeAssetImpl>) { return toResult(() => describeAssetImpl(...args)); }
export async function requestPlan(...args: Parameters<typeof requestPlanImpl>) { return toResult(() => requestPlanImpl(...args)); }
export async function updateScene(...args: Parameters<typeof updateSceneImpl>) { return toResult(() => updateSceneImpl(...args)); }
export async function rewriteSceneText(...args: Parameters<typeof rewriteSceneTextImpl>) { return toResult(() => rewriteSceneTextImpl(...args)); }
export async function reorderScenes(...args: Parameters<typeof reorderScenesImpl>) { return toResult(() => reorderScenesImpl(...args)); }
export async function addScene(...args: Parameters<typeof addSceneImpl>) { return toResult(() => addSceneImpl(...args)); }
export async function insertScene(...args: Parameters<typeof insertSceneImpl>) { return toResult(() => insertSceneImpl(...args)); }
export async function deleteScene(...args: Parameters<typeof deleteSceneImpl>) { return toResult(() => deleteSceneImpl(...args)); }
export async function requestDeckExport(...args: Parameters<typeof requestDeckExportImpl>) { return toResult(() => requestDeckExportImpl(...args)); }
export async function importFromUrl(...args: Parameters<typeof importFromUrlImpl>) { return toResult(() => importFromUrlImpl(...args)); }
export async function translateDeck(...args: Parameters<typeof translateDeckImpl>) { return toResult(() => translateDeckImpl(...args)); }
export async function askDeckAi(...args: Parameters<typeof askDeckAiImpl>) { return toResult(() => askDeckAiImpl(...args)); }
export async function clearDeckChat(...args: Parameters<typeof clearDeckChatImpl>) { return toResult(() => clearDeckChatImpl(...args)); }
export async function getBriefHistory(...args: Parameters<typeof getBriefHistoryImpl>) { return toResult(() => getBriefHistoryImpl(...args)); }
export async function removeBriefHistory(...args: Parameters<typeof removeBriefHistoryImpl>) { return toResult(() => removeBriefHistoryImpl(...args)); }
