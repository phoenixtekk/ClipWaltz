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
import {
  MAX_PRESENTERS, MAX_PRESENTER_SUBMITS_PER_DAY, consentStatement, voiceConsentStatement, type PresenterStatus, type PresenterView,
} from "./presenters";

// Waltz Avatar — Your Presenter (Phase 1). Flow: startPresenter (a draft with a one-time code) → the browser uploads the
// footage and records the live consent clip (src/app/api/presenters/[id]/*) → submitPresenter queues the AISERVER job
// (consent check + presenter cache, worker/generation-worker.mjs → processPresenter) → ready | failed (with the reason).

type Row = typeof schema.presenters.$inferSelect;

function view(p: Row): PresenterView {
  return {
    id: p.id, name: p.name, status: p.status as PresenterStatus, voice: p.voice,
    hasFootage: !!p.footageKey, hasConsent: !!p.consentKey, error: p.error,
    thumbUrl: p.thumbKey ? `/api/presenters/${p.id}/thumb?v=${p.readyAt?.getTime() ?? 0}` : null,
    createdAt: p.createdAt.toISOString(), readyAt: p.readyAt?.toISOString() ?? null,
    meta: (p.meta ?? null) as PresenterView["meta"],
    voiceStatus: p.voiceStatus as PresenterView["voiceStatus"], voiceHasConsent: !!p.voiceConsentKey, voiceError: p.voiceError,
  };
}

async function own(userId: string, id: string): Promise<Row> {
  const [p] = await db.select().from(schema.presenters).where(and(eq(schema.presenters.id, id), eq(schema.presenters.userId, userId)));
  if (!p) throw new Error("Presenter not found");
  return p;
}

const newCode = () => String(randomInt(1000, 10000));

export async function listPresenters(): Promise<ActionResult<PresenterView[]>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const rows = await db.select().from(schema.presenters).where(eq(schema.presenters.userId, userId)).orderBy(schema.presenters.createdAt);
    return rows.map(view);
  });
}

/** A new draft presenter with its one-time consent code. */
export async function startPresenter(name: string): Promise<ActionResult<{ presenter: PresenterView; statement: string }>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const clean = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!clean) throw new Error("Give your presenter a name — usually your own");
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.presenters).where(eq(schema.presenters.userId, userId));
    if (n >= MAX_PRESENTERS) throw new Error(`You can keep up to ${MAX_PRESENTERS} presenters — delete one first`);
    const id = randomUUID();
    const code = newCode();
    const [p] = await db.insert(schema.presenters).values({ id, userId, name: clean, consentCode: code }).returning();
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
    await db.update(schema.presenters).set({ consentCode: code, consentKey: null, status: "draft", error: null, updatedAt: new Date() })
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
    if (!p.footageKey) throw new Error("Add a video of yourself talking first");
    if (!p.consentKey || !p.consentCode) throw new Error("Record the consent clip first");
    const since = new Date(Date.now() - 24 * 3600_000);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.presenterConsents)
      .where(and(eq(schema.presenterConsents.userId, userId), gte(schema.presenterConsents.createdAt, since)));
    if (n >= MAX_PRESENTER_SUBMITS_PER_DAY) throw new Error("That's a lot of attempts today — try again tomorrow");
    await db.insert(schema.presenterConsents).values({
      id: randomUUID(), userId, presenterId: p.id, kind: "likeness", subjectName: p.name,
      statement: consentStatement(p.name, p.consentCode), code: p.consentCode,
    });
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

/** Phase 2 — clone my voice: a new voice consent code (and the sentence to read). Only for a ready presenter. */
export async function startVoice(id: string): Promise<ActionResult<string>> {
  return toResult(async () => {
    const userId = await requireUserId();
    const p = await own(userId, id);
    if (p.status !== "ready") throw new Error("Finish the presenter first");
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
    const p = await own(userId, id);
    if (p.status === "queued" || p.status === "preparing") throw new Error("Wait until it's ready (or failed), then delete it");
    // Everything is under presenters/<userId>/<id>/ (footage, consent clip, thumbnail, cached lip-synced scene clips) —
    // purged with every stored version (the bucket is versioned: a plain delete would keep the data).
    await purgePrefix(`presenters/${userId}/${id}/`);
    await db.delete(schema.presenters).where(eq(schema.presenters.id, id));
    await enqueuePresenter({ presenterId: id, action: "delete" }).catch(() => {});
    revalidatePath("/avatars");
  });
}
