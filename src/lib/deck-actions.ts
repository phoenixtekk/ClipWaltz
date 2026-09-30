"use server";
// WaltzDeck server actions (06_ClipWaltz_WaltzDeck_Feature_Spec.md). Planning and rewrites run on the
// generation worker (worker/deck/jobs.mjs) via the deck queue; the editor polls getDeck().
import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { userCanAccessProject } from "./workspace";
import { enqueueDeck } from "./queue";
import { shouldWatermark } from "./watermark";
import { toResult, unwrap, type ActionResult } from "./action-result";
import {
  CAMERA_MODES, DEFAULT_AUDIO, DUCK_MODES, MUSIC_TONES, VOICE_TONES, type DeckAudio,
  DECK_MODES, LANGUAGES, LAYOUTS, MAX_BRIEF_HISTORY, MAX_BULLETS, MAX_BULLET_CHARS, MOTIONS, ROLES, VOICES, defaultBrief, defaultVoiceFor,
  type DeckBrief, type DeckExport, type DeckExportFormat, type DeckScene, type DeckState, type SceneText, type SceneTextMode,
} from "./deck/types";

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
};

const toScene = (r: typeof schema.deckScenes.$inferSelect): DeckScene => ({
  id: r.id, orderIndex: r.orderIndex, role: r.role, assetId: r.assetId, inSec: r.inSec, outSec: r.outSec,
  durationSec: r.durationSec, textMode: r.textMode as SceneTextMode, text: (r.text ?? {}) as SceneText,
  layout: r.layout, motion: r.motion, transition: r.transition, locked: r.locked, voice: r.voice, prompt: r.prompt, why: r.why,
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
  return {
    project: { id: p.id, title: p.title, aspect: p.aspect, musicTrackId: p.musicTrackId, status: p.status },
    deck: {
      brief: { ...defaultBrief(), ...(deck.brief ?? {}) }, plan: deck.plan ?? { status: "idle" }, import: deck.import ?? { status: "idle" },
      brandSuggestion: deck.brandSuggestion ?? { status: "idle" }, translation: deck.translation ?? { status: "idle" },
    },
    fills,
    exports: latest.map((r) => ({
      id: r.id, format: r.format as DeckExportFormat, status: r.status as DeckExport["status"], error: r.error,
      createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
    scenes: scenes.map(toScene),
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
export async function saveBrief(projectId: string, input: Partial<DeckBrief>): Promise<void> {
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
export async function setAssetNote(projectId: string, assetId: string, note: string): Promise<void> {
  await assertAccess(projectId, "editor");
  await db.update(schema.assets).set({ note: clip(note, 300) || null })
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)));
}

/** Warm the description cache for a just-uploaded file (planning later needs no wait for it). */
export async function describeAsset(projectId: string, assetId: string): Promise<void> {
  await assertAccess(projectId, "editor");
  await assertProjectAsset(projectId, assetId);
  await enqueueDeck({ name: "describe", data: { assetId } }, `describe-${assetId}`);
}

/** (Re)plan the storyboard. Locked scenes are kept; everything else is replaced. */
export async function requestPlan(projectId: string): Promise<void> {
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
}>;

/** Edit one scene. Typing your own words makes the text Manual and locks the scene (re-plans keep it). */
export async function updateScene(projectId: string, sceneId: string, patch: ScenePatch): Promise<void> {
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
  if (patch.assetId !== undefined) {
    if (patch.assetId) await assertProjectAsset(projectId, patch.assetId);
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
  const order = [...new Set(ids)].filter((id) => known.has(id));
  if (order.length !== known.size) throw new Error("The scene list changed — refresh and try again");
  await db.transaction(async (tx) => {
    for (const [i, id] of order.entries()) await tx.update(schema.deckScenes).set({ orderIndex: i }).where(eq(schema.deckScenes.id, id));
  });
}

/** Add a scene after `afterIndex` (-1 = at the start) showing `assetId`, or a text card when null. */
export async function addScene(projectId: string, afterIndex: number, assetId: string | null): Promise<string> {
  await assertAccess(projectId, "editor");
  if (assetId) await assertProjectAsset(projectId, assetId);
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

// ── Slide exports (phase 3) ────────────────────────────────────────────────────────────────────────

/**
 * Queue a PDF or PowerPoint export of the storyboard. The render worker on the AI box builds it from the same
 * templates as the video (worker/deck/export.mjs); the editor polls getDeck(). One export per format at a time.
 */
export async function requestDeckExport(projectId: string, format: DeckExportFormat): Promise<void> {
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
export async function importFromUrl(projectId: string, rawUrl: string): Promise<void> {
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
const FILL_DURATIONS = [3, 5, 8];
/** Waltz AI frame sizes (divisible by 16) per project shape; 4:5 is generated portrait and cropped by the render. */
const FILL_SIZE: Record<string, { w: number; h: number }> = {
  "16:9": { w: 1280, h: 720 }, "9:16": { w: 720, h: 1280 }, "1:1": { w: 768, h: 768 }, "4:5": { w: 720, h: 1280 },
};
const fillSeconds = (sceneSec: number) => FILL_DURATIONS.find((d) => d >= sceneSec) ?? FILL_DURATIONS[FILL_DURATIONS.length - 1];

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

// ── Translate (phase 5) ────────────────────────────────────────────────────────────────────────────

/**
 * A translated copy of this deck: same clips (the same stored files), scenes, look and brand, with the words — scene
 * text, points, narration and brief — translated on the deck worker, voiced by a voice of that language and captioned
 * in it. The original is never touched. Returns the new project id (the editor opens it and shows the progress).
 */
export async function translateDeck(projectId: string, lang: string): Promise<string> {
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
      deck: { brief: nextBrief, plan: { status: "idle" }, translation: { status: "queued", lang: L.code, startedAt: new Date().toISOString() } },
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
export async function getBriefHistory(): Promise<{ id: string; text: string }[]> {
  const userId = await requireUserId();
  return db.select({ id: schema.deckBriefHistory.id, text: schema.deckBriefHistory.text }).from(schema.deckBriefHistory)
    .where(eq(schema.deckBriefHistory.userId, userId)).orderBy(desc(schema.deckBriefHistory.usedAt)).limit(MAX_BRIEF_HISTORY);
}

export async function removeBriefHistory(id: string): Promise<void> {
  const userId = await requireUserId();
  await db.delete(schema.deckBriefHistory).where(and(eq(schema.deckBriefHistory.id, id), eq(schema.deckBriefHistory.userId, userId)));
}
