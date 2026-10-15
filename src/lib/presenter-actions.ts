"use server";
import { randomInt, randomUUID } from "crypto";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { toResult, type ActionResult } from "./action-result";
import { enqueuePresenter } from "./queue";
import { purgePrefix } from "./storage";
import { VOICES } from "./deck/types";
import { spendCredits } from "./credits-server";
import { describesRealPerson } from "./persona-check";
import {
  CONSENT_MAX_SECONDS, MAX_FACE_ROUNDS, MAX_PRESENTERS, MAX_PRESENTER_SUBMITS_PER_DAY, PRESENTER_BUILD_CREDITS, consentStatement,
  voiceConsentStatement, type PresenterSource, type PresenterStatus, type PresenterView,
} from "./presenters";

// Waltz Avatar — Your Presenter (Phase 1). Flow: startPresenter (a draft with a one-time code) → the browser uploads the
// footage and records the live consent clip (src/app/api/presenters/[id]/*) → submitPresenter queues the AISERVER job
// (consent check + presenter cache, worker/generation-worker.mjs → processPresenter) → ready | failed (with the reason).
// Also made without footage (owner decision 2026-10-15, PRESENTER_BUILD_CREDITS per build, refunded on failure):
//   photo — the live consent clip as above, then the user picks a frame of it (the face is the consenting person by
//           construction; no face recognition) → animated like the library's AI presenters.
//   ai    — a fictional face: describe → 3 generated faces → pick one → animated. Descriptions naming a real person are refused.

type Row = typeof schema.presenters.$inferSelect;

function view(p: Row): PresenterView {
  return {
    id: p.id, name: p.name, status: p.status as PresenterStatus, voice: p.voice,
    hasFootage: !!p.footageKey, hasConsent: !!p.consentKey, error: p.error,
    thumbUrl: p.thumbKey ? `/api/presenters/${p.id}/thumb?v=${p.readyAt?.getTime() ?? 0}` : null,
    createdAt: p.createdAt.toISOString(), readyAt: p.readyAt?.toISOString() ?? null,
    meta: (p.meta ?? null) as PresenterView["meta"],
    voiceStatus: p.voiceStatus as PresenterView["voiceStatus"], voiceHasConsent: !!p.voiceConsentKey, voiceError: p.voiceError,
    source: p.source as PresenterSource, photoAt: p.photoAt, description: p.description, consentRef: p.consentKey?.slice(-12) ?? null,
    portraits: p.source === "ai" && Array.isArray(p.portraitKeys)
      ? (p.portraitKeys as string[]).map((_, n) => `/api/presenters/${p.id}/portrait/${n}?v=${p.updatedAt.getTime()}`) : [],
  };
}

async function own(userId: string, id: string): Promise<Row> {
  const [p] = await db.select().from(schema.presenters)
    .where(and(eq(schema.presenters.id, id), eq(schema.presenters.userId, userId), eq(schema.presenters.kind, "twin")));
  if (!p) throw new Error("Presenter not found");
  return p;
}

const newCode = () => String(randomInt(1000, 10000));

export async function listPresenters(): Promise<ActionResult<PresenterView[]>> {
  return toResult(async () => {
    const userId = await requireUserId();
    // The user's own presenters (an admin's library presenters live on /admin/avatars).
    const rows = await db.select().from(schema.presenters).where(and(eq(schema.presenters.userId, userId), eq(schema.presenters.kind, "twin")))
      .orderBy(schema.presenters.createdAt);
    return rows.map(view);
  });
}

async function roomForAnother(userId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.presenters)
    .where(and(eq(schema.presenters.userId, userId), eq(schema.presenters.kind, "twin")));
  if (n >= MAX_PRESENTERS) throw new Error(`You can keep up to ${MAX_PRESENTERS} presenters — delete one first`);
}

/** A new draft presenter with its one-time consent code — made from the user's video (footage) or photo (a frame of the
 *  consent clip). */
export async function startPresenter(name: string, source: "video" | "photo" = "video"): Promise<ActionResult<{ presenter: PresenterView; statement: string }>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const clean = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!clean) throw new Error("Give your presenter a name — usually your own");
    await roomForAnother(userId);
    const id = randomUUID();
    const code = newCode();
    const [p] = await db.insert(schema.presenters)
      .values({ id, userId, name: clean, consentCode: code, source: source === "photo" ? "photo" : "video" }).returning();
    revalidatePath("/avatars");
    return { presenter: view(p), statement: consentStatement(clean, code) };
  });
}

/** The consent sentence (with the current code) for a draft or failed presenter. */
export async function getConsentStatement(id: string): Promise<ActionResult<string>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const p = await own(userId, id);
    if (!p.consentCode) throw new Error("Start again to get a new code");
    return consentStatement(p.name, p.consentCode);
  });
}

/** After a failed check: a fresh code, and the old consent clip is discarded (it was read with the old code). */
export async function restartConsent(id: string): Promise<ActionResult<string>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const p = await own(userId, id);
    if (p.status !== "failed" && p.status !== "draft") throw new Error("This presenter is already being made");
    const code = newCode();
    if (p.consentKey) await purgePrefix(p.consentKey).catch(() => {});
    await db.update(schema.presenters).set({ consentCode: code, consentKey: null, photoAt: null, status: "draft", error: null, updatedAt: new Date() })
      .where(eq(schema.presenters.id, id));
    revalidatePath("/avatars");
    return consentStatement(p.name, code);
  });
}

/** Queue the consent check + presenter build. */
export async function submitPresenter(id: string): Promise<ActionResult<PresenterView>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const p = await own(userId, id);
    if (p.status !== "draft" && p.status !== "failed") throw new Error("This presenter is already being made");
    if (p.source === "ai") throw new Error("Pick one of the faces to build this presenter");
    const photo = p.source === "photo";
    if (!photo && !p.footageKey) throw new Error("Add a video of yourself talking first");
    if (!p.consentKey || !p.consentCode) throw new Error("Record the consent clip first");
    if (photo && p.photoAt == null) throw new Error("Pick the picture of you to use first");
    await attemptsLeftToday(userId);
    await db.insert(schema.presenterConsents).values({
      id: randomUUID(), userId, presenterId: p.id, kind: "likeness", subjectName: p.name,
      statement: consentStatement(p.name, p.consentCode), code: p.consentCode,
      ...(photo ? { method: "code+face (photo: a frame of this clip)" } : {}),
    });
    if (photo) {
      await chargeAndQueue(userId, p, ["draft", "failed"], "prepare");
      revalidatePath("/avatars");
      return view(await own(userId, id));
    }
    const [row] = await db.update(schema.presenters).set({ status: "queued", error: null, updatedAt: new Date() })
      .where(eq(schema.presenters.id, id)).returning();
    try {
      await enqueuePresenter({ presenterId: id, action: "prepare" });
    } catch {
      await db.update(schema.presenters).set({ status: "failed", error: "Couldn't reach the AI queue — try again" }).where(eq(schema.presenters.id, id));
      throw new Error("Couldn't reach the AI queue — try again in a moment");
    }
    revalidatePath("/avatars");
    return view(row);
  });
}

/** Presenter attempts (each runs a GPU job) per user per day. */
async function attemptsLeftToday(userId: string) {
  const since = new Date(Date.now() - 24 * 3600_000);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.presenterConsents)
    .where(and(eq(schema.presenterConsents.userId, userId), gte(schema.presenterConsents.createdAt, since)));
  if (n >= MAX_PRESENTER_SUBMITS_PER_DAY) throw new Error("That's a lot of attempts today — try again tomorrow");
}

/** Photo / AI builds: charge PRESENTER_BUILD_CREDITS and queue the build in one step. The charge is a generation_jobs row
 *  (no project) the worker marks completed when the presenter is ready, or failed — which refunds it — when it isn't. */
async function chargeAndQueue(userId: string, p: Row, from: string[], action: "prepare" | "ai_build", set: Partial<Row> = {}) {
  const chargeId = randomUUID();
  await spendCredits(userId, PRESENTER_BUILD_CREDITS, async (tx) => {
    const [row] = await tx.update(schema.presenters).set({ ...set, status: "queued", error: null, buildChargeId: chargeId, updatedAt: new Date() })
      .where(and(eq(schema.presenters.id, p.id), inArray(schema.presenters.status, from))).returning({ id: schema.presenters.id });
    if (!row) throw new Error("This presenter is already being made");
    await tx.insert(schema.generationJobs).values({
      id: chargeId, projectId: null, requestedBy: userId, credits: PRESENTER_BUILD_CREDITS, jobType: "presenter_build", status: "generating",
      progress: 0, modelName: "echomimic-v3", workflowName: "echomimic-talking-v1", requestJson: { presenterBuild: { presenterId: p.id, source: p.source } },
    });
  }, "Upgrade for more, or wait for the reset — nothing was charged.");
  try {
    await enqueuePresenter({ presenterId: p.id, action });
  } catch {
    await db.update(schema.presenters).set({ status: "failed", error: "Couldn't reach the AI queue — try again" }).where(eq(schema.presenters.id, p.id));
    await refundBuild(chargeId);
    throw new Error("Couldn't reach the AI queue — try again in a moment (your credits weren't used)");
  }
}

/** A build charge that never finished: refunded (failed rows don't count against the month's credits). */
async function refundBuild(chargeId: string | null) {
  if (!chargeId) return;
  await db.update(schema.generationJobs).set({ status: "failed", errorMessage: "Presenter build didn't finish — refunded", updatedAt: new Date() })
    .where(and(eq(schema.generationJobs.id, chargeId), eq(schema.generationJobs.jobType, "presenter_build"), eq(schema.generationJobs.status, "generating")));
}

/** Photo presenter: the frame of the consent clip to animate (seconds into it). */
export async function setPhotoFrame(id: string, at: number): Promise<ActionResult<PresenterView>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const p = await own(userId, id);
    if (p.source !== "photo") throw new Error("This presenter is made from a video");
    if (!p.consentKey) throw new Error("Record the consent clip first");
    const t = Number(at);
    if (!Number.isFinite(t) || t < 0 || t > CONSENT_MAX_SECONDS) throw new Error("Pick a moment in your recording");
    const [row] = await db.update(schema.presenters).set({ photoAt: Math.round(t * 100) / 100, updatedAt: new Date() })
      .where(and(eq(schema.presenters.id, id), inArray(schema.presenters.status, ["draft", "failed"]))).returning();
    if (!row) throw new Error("This presenter is already being made");
    revalidatePath("/avatars");
    return view(row);
  });
}

/** AI face rounds (3 generated faces each) in the last 24 h — a free GPU job each, so capped. */
const MAX_FACE_ROUNDS_PER_DAY = 8;
async function queueFaces(userId: string, id: string) {
  const since = new Date(Date.now() - 24 * 3600_000);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.generationJobs)
    .where(and(eq(schema.generationJobs.requestedBy, userId), eq(schema.generationJobs.jobType, "presenter_faces"), gte(schema.generationJobs.createdAt, since)));
  if (n >= MAX_FACE_ROUNDS_PER_DAY) {
    await db.update(schema.presenters).set({ status: "failed", error: "That's a lot of faces today — try again tomorrow" }).where(eq(schema.presenters.id, id));
    throw new Error("That's a lot of faces today — try again tomorrow");
  }
  // A free record (0 credits) of the round, for the daily cap above.
  await db.insert(schema.generationJobs).values({
    id: randomUUID(), projectId: null, requestedBy: userId, credits: 0, jobType: "presenter_faces", status: "completed", progress: 100,
    modelName: "wan", workflowName: "wan-text-to-video-v1", requestJson: { presenterFaces: { presenterId: id } },
  });
  try {
    await enqueuePresenter({ presenterId: id, action: "portraits" });
  } catch {
    await db.update(schema.presenters).set({ status: "failed", error: "Couldn't reach the AI queue — try again" }).where(eq(schema.presenters.id, id));
    throw new Error("Couldn't reach the AI queue — try again in a moment");
  }
}

/** A fictional AI presenter: 3 faces are generated from the description (free); building one costs PRESENTER_BUILD_CREDITS. */
export async function createAiPresenter(input: { name: string; description: string; voice?: string }): Promise<ActionResult<PresenterView>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const name = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    const description = String(input.description ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!name || description.length < 10) throw new Error("Give the presenter a name and describe how they look");
    await roomForAnother(userId);
    // Fictional only: never a real, identifiable person (a celebrity, a politician, someone you know).
    if (await describesRealPerson(`Name: ${name}. Look: ${description}`)) {
      throw new Error("Describe a made-up person — an AI presenter can't look like a real, named person. To be the presenter yourself, make one from your video or photo.");
    }
    const voice = VOICES.some((v) => v.id === input.voice) ? input.voice! : "af_heart";
    const [p] = await db.insert(schema.presenters).values({
      id: randomUUID(), userId, name, description, voice, source: "ai", status: "queued", meta: { faceRounds: 1 },
    }).returning();
    await queueFaces(userId, p.id);
    revalidatePath("/avatars");
    return view(p);
  });
}

/** AI presenter: 3 new faces (up to MAX_FACE_ROUNDS rounds per presenter). */
export async function moreFaces(id: string): Promise<ActionResult<void>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const p = await own(userId, id);
    if (p.source !== "ai") throw new Error("Only AI presenters have generated faces");
    const rounds = Number((p.meta as { faceRounds?: number } | null)?.faceRounds ?? 1);
    if (rounds >= MAX_FACE_ROUNDS) throw new Error("That's all the new faces for this presenter — pick one, or delete it and describe someone new");
    const [row] = await db.update(schema.presenters)
      .set({ status: "queued", error: null, portraitKeys: null, meta: { faceRounds: rounds + 1 }, updatedAt: new Date() })
      .where(and(eq(schema.presenters.id, id), inArray(schema.presenters.status, ["draft", "failed"]))).returning({ id: schema.presenters.id });
    if (!row) throw new Error("This presenter is already being made");
    for (const k of (p.portraitKeys as string[] | null) ?? []) await purgePrefix(k).catch(() => {});
    await queueFaces(userId, id);
    revalidatePath("/avatars");
  });
}

/** AI presenter: build it from face `n` (PRESENTER_BUILD_CREDITS; ≈ 15–20 min of GPU). */
export async function pickFace(id: string, n: number): Promise<ActionResult<void>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const p = await own(userId, id);
    const keys = (p.portraitKeys as string[] | null) ?? [];
    if (p.source !== "ai" || !Number.isInteger(n) || !keys[n]) throw new Error("Pick one of the faces shown");
    if (p.status !== "draft" && p.status !== "failed") throw new Error("This presenter is already being made");
    await chargeAndQueue(userId, p, ["draft", "failed"], "ai_build", { thumbKey: keys[n] });
    revalidatePath("/avatars");
  });
}

/** Phase 2 — clone my voice: a new voice consent code (and the sentence to read). Only for a ready presenter. */
export async function startVoice(id: string): Promise<ActionResult<string>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const p = await own(userId, id);
    if (p.status !== "ready") throw new Error("Finish the presenter first");
    // The voice check compares the voice consent with the footage's voice; photo / AI presenters' footage speaks a stock voice.
    if (p.source !== "video") throw new Error("Your own voice needs a presenter made from a video of you");
    if (p.voiceStatus === "queued") throw new Error("Your voice is being checked — wait a moment");
    const code = newCode();
    if (p.voiceConsentKey) await purgePrefix(p.voiceConsentKey).catch(() => {});
    await db.update(schema.presenters).set({ voiceStatus: "draft", voiceConsentCode: code, voiceConsentKey: null, voiceError: null, updatedAt: new Date() })
      .where(eq(schema.presenters.id, id));
    revalidatePath("/avatars");
    return voiceConsentStatement(p.name, code);
  });
}

/** The voice consent sentence for a voice being set up. */
export async function getVoiceStatement(id: string): Promise<ActionResult<string | null>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const p = await own(userId, id);
    return p.voiceConsentCode ? voiceConsentStatement(p.name, p.voiceConsentCode) : null;
  });
}

/** Queue the voice consent check (AISERVER) → the cloned voice is ready. */
export async function submitVoice(id: string): Promise<ActionResult<PresenterView>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const p = await own(userId, id);
    if (p.status !== "ready") throw new Error("Finish the presenter first");
    if (p.voiceStatus !== "draft" && p.voiceStatus !== "failed") throw new Error("Your voice is already being checked");
    if (!p.voiceConsentKey || !p.voiceConsentCode) throw new Error("Record the voice consent first");
    const since = new Date(Date.now() - 24 * 3600_000);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.presenterConsents)
      .where(and(eq(schema.presenterConsents.userId, userId), gte(schema.presenterConsents.createdAt, since)));
    if (n >= MAX_PRESENTER_SUBMITS_PER_DAY) throw new Error("That's a lot of attempts today — try again tomorrow");
    await db.insert(schema.presenterConsents).values({
      id: randomUUID(), userId, presenterId: p.id, kind: "voice", subjectName: p.name,
      statement: voiceConsentStatement(p.name, p.voiceConsentCode), code: p.voiceConsentCode,
    });
    const [row] = await db.update(schema.presenters).set({ voiceStatus: "queued", voiceError: null, updatedAt: new Date() })
      .where(and(eq(schema.presenters.id, id), inArray(schema.presenters.voiceStatus, ["draft", "failed"]))).returning();
    if (!row) throw new Error("Your voice is already being checked");
    try {
      await enqueuePresenter({ presenterId: id, action: "voice" });
    } catch {
      await db.update(schema.presenters).set({ voiceStatus: "failed", voiceError: "Couldn't reach the AI queue — try again" }).where(eq(schema.presenters.id, id));
      throw new Error("Couldn't reach the AI queue — try again in a moment");
    }
    revalidatePath("/avatars");
    return view(row);
  });
}

/** Stop using the cloned voice: the reference clip and voice consent clip are purged. */
export async function removeVoice(id: string): Promise<ActionResult<void>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const p = await own(userId, id);
    if (p.voiceStatus === "queued") throw new Error("Wait until the check is done");
    for (const k of [p.voiceRefKey, p.voiceConsentKey]) if (k) await purgePrefix(k).catch(() => {});
    await purgePrefix(`presenters/${userId}/${id}/voice/`).catch(() => {}); // cached lines in this voice
    await db.update(schema.presenters).set({ voiceStatus: "none", voiceConsentCode: null, voiceConsentKey: null, voiceRefKey: null, voiceError: null, updatedAt: new Date() })
      .where(eq(schema.presenters.id, id));
    revalidatePath("/avatars");
  });
}

export async function updatePresenter(id: string, input: { name?: string; voice?: string }): Promise<ActionResult<PresenterView>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const p = await own(userId, id);
    const name = input.name !== undefined ? String(input.name).replace(/\s+/g, " ").trim().slice(0, 60) : p.name;
    if (!name) throw new Error("The name can't be empty");
    const voice = input.voice !== undefined ? (VOICES.some((v) => v.id === input.voice) ? input.voice : p.voice) : p.voice;
    const [row] = await db.update(schema.presenters).set({ name, voice, updatedAt: new Date() }).where(eq(schema.presenters.id, id)).returning();
    revalidatePath("/avatars");
    return view(row);
  });
}

/** Delete a presenter: its footage, consent clip and thumbnail now; the AISERVER cache via the worker. The consent
 *  record (what was said, when, the check's scores) is kept without the clip. */
export async function deletePresenter(id: string): Promise<ActionResult<void>> {
  return toResult(async () => {
    const userId = await requireUserId();
    await own(userId, id);
    // Only while nothing is building — checked in the delete itself, so a build started at the same moment (and its
    // charge) can't slip between the check and the delete. A build queued / running for over 3 hours is stuck (the
    // longest takes ~20 min; the worker's sweep fails and refunds those too) — it may be deleted.
    const [gone] = await db.delete(schema.presenters)
      .where(and(eq(schema.presenters.id, id), sql`(${schema.presenters.status} not in ('queued', 'preparing') or ${schema.presenters.updatedAt} < now() - interval '3 hours')`))
      .returning({ buildChargeId: schema.presenters.buildChargeId });
    if (!gone) throw new Error("Wait until it's ready (or failed), then delete it");
    await refundBuild(gone.buildChargeId);
    // Everything is under presenters/<userId>/<id>/ (footage, consent clip, thumbnail, cached lip-synced scene clips) —
    // purged with every stored version (the bucket is versioned: a plain delete would keep the data).
    await purgePrefix(`presenters/${userId}/${id}/`);
    await enqueuePresenter({ presenterId: id, action: "delete" }).catch(() => {});
    revalidatePath("/avatars");
  });
}
