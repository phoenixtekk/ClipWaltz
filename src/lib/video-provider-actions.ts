"use server";
import { randomUUID } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "./admin";
import { requireUserId } from "./auth";
import { toResult } from "./action-result";
import { encryptToken } from "./cloud/crypto";
import { getEffectiveTier, type Tier } from "./tier";
import { cloudOffersFor, creditsPerSec, dailyLimitOf, readVideoSettings, type StoredVideo } from "./video-providers";
import { VIDEO_MODELS, VIDEO_PROVIDERS, VIDEO_PROVIDER_IDS, VIDEO_SETTINGS_KEY, aspectsFor, type VideoProviderId } from "../../worker/video/catalog.mjs";
import { decryptSecret } from "../../worker/deck/llm.mjs";
import { testVideoKey, videoErrorText } from "../../worker/video/cloud.mjs";

// Cloud video models for Waltz AI (Phase C1): admin settings per vendor (on/off, plans, ClipWaltz's key, users' own
// keys, credits per second per model, daily clip cap) and each user's own vendor keys. Key checks are free (an
// invalid-task lookup), never a paid generation.

const TIERS: Tier[] = ["free", "plus", "pro"];
const KEY_RE = /^[\x21-\x7e]{16,400}$/;
const isProvider = (p: unknown): p is VideoProviderId => typeof p === "string" && (VIDEO_PROVIDER_IDS as string[]).includes(p);

function cleanKey(key: unknown): string {
  const k = typeof key === "string" ? key.trim() : "";
  if (!KEY_RE.test(k)) throw new Error("That doesn't look like an API key — paste the whole key, with no spaces.");
  return k;
}

// Key checks call the vendor: 5 per user per 10 minutes (per app instance).
const testLog = new Map<string, number[]>();
function limitTests(userId: string) {
  const now = Date.now();
  const recent = (testLog.get(userId) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 5) throw new Error("Too many key checks — wait a few minutes and try again.");
  recent.push(now);
  testLog.set(userId, recent);
}

async function check(provider: VideoProviderId, apiKey: string) {
  try {
    await testVideoKey(provider, apiKey);
  } catch (e) {
    throw new Error(`${VIDEO_PROVIDERS[provider].label}: ${videoErrorText(e, apiKey)}`);
  }
}

async function writeSettings(value: StoredVideo) {
  await db
    .insert(schema.appSettings)
    .values({ key: VIDEO_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
}

// ── Admin ────────────────────────────────────────────────────────────────────────────────────────

export type VideoAdminProvider = {
  id: VideoProviderId;
  label: string;
  vendor: string;
  credit: string | null;
  enabled: boolean;
  plans: Tier[];
  allowOwnKey: boolean;
  platformKeyLast4: string | null;
  dailyLimit: number;
  ownKeyUsers: number;
  models: { id: string; label: string; credits: number; defaultCredits: number; usdPerSec: number; enabled: boolean }[];
};

async function getVideoAdminImpl(): Promise<VideoAdminProvider[]> {
  await requireAdmin();
  const [stored, counts] = await Promise.all([
    readVideoSettings(),
    db
      .select({ provider: schema.userAiKeys.provider, n: sql<number>`count(*)::int` })
      .from(schema.userAiKeys)
      .where(inArray(schema.userAiKeys.provider, VIDEO_PROVIDER_IDS))
      .groupBy(schema.userAiKeys.provider),
  ]);
  const n = new Map(counts.map((c) => [c.provider, c.n]));
  return VIDEO_PROVIDER_IDS.map((id) => {
    const s = stored[id] ?? {};
    return {
      id,
      label: VIDEO_PROVIDERS[id].label,
      vendor: VIDEO_PROVIDERS[id].vendor,
      credit: VIDEO_PROVIDERS[id].credit ?? null,
      enabled: !!s.enabled,
      plans: s.plans ?? [],
      allowOwnKey: !!s.allowOwnKey,
      platformKeyLast4: s.platformKeyEnc ? (s.platformKeyLast4 ?? "••••") : null,
      dailyLimit: dailyLimitOf(s),
      ownKeyUsers: n.get(id) ?? 0,
      models: VIDEO_MODELS.filter((m) => m.provider === id).map((m) => ({
        id: m.id,
        label: m.label,
        credits: creditsPerSec(s, m),
        defaultCredits: m.defaultCredits,
        usdPerSec: m.usdPerSec,
        enabled: !(s.disabledModels ?? []).includes(m.id),
      })),
    };
  });
}

async function saveVideoProviderImpl(
  id: string,
  input: { enabled: boolean; plans: string[]; allowOwnKey: boolean; dailyLimit: number; credits: Record<string, number>; disabledModels: string[] },
) {
  await requireAdmin();
  if (!isProvider(id)) throw new Error("Unknown provider");
  const ids = VIDEO_MODELS.filter((m) => m.provider === id).map((m) => m.id);
  const credits: Record<string, number> = {};
  for (const m of ids) {
    const v = Number(input.credits?.[m]);
    if (Number.isFinite(v) && v >= 0 && v <= 100) credits[m] = Math.round(v * 10) / 10;
  }
  const stored = await readVideoSettings();
  stored[id] = {
    ...stored[id],
    enabled: !!input.enabled,
    plans: TIERS.filter((t) => input.plans.includes(t)),
    allowOwnKey: !!input.allowOwnKey,
    dailyLimit: Math.min(1000, Math.max(1, Math.round(Number(input.dailyLimit) || 10))),
    credits,
    disabledModels: ids.filter((m) => input.disabledModels.includes(m)),
  };
  await writeSettings(stored);
  revalidatePath("/admin/ai");
}

async function setVideoPlatformKeyImpl(id: string, key: string | null) {
  await requireAdmin();
  if (!isProvider(id)) throw new Error("Unknown provider");
  const stored = await readVideoSettings();
  if (key === null) stored[id] = { ...stored[id], platformKeyEnc: null, platformKeyLast4: null };
  else {
    const k = cleanKey(key);
    await check(id, k);
    stored[id] = { ...stored[id], platformKeyEnc: encryptToken(k), platformKeyLast4: k.slice(-4) };
  }
  await writeSettings(stored);
  revalidatePath("/admin/ai");
}

async function testVideoPlatformKeyImpl(id: string) {
  await requireAdmin();
  if (!isProvider(id)) throw new Error("Unknown provider");
  const k = decryptSecret((await readVideoSettings())[id]?.platformKeyEnc);
  if (!k) throw new Error("No ClipWaltz key saved for this provider");
  await check(id, k);
}

// ── Users ────────────────────────────────────────────────────────────────────────────────────────

export type MyVideoModels = {
  /** What the Generate tab offers now (ClipWaltz's key → credits per second; own key → free). */
  offers: { id: string; label: string; provider: VideoProviderId; source: "own" | "platform"; creditsPerSec: number; tasks: string[]; durations: number[]; t2vAspects: string[]; i2vAspects: string[] | null; credit: string | null }[];
  /** Vendors whose own keys this user may add, and the saved keys. */
  keys: { id: VideoProviderId; label: string; vendor: string; keyHint: string; myKey: { last4: string } | null }[];
};

async function getMyVideoModelsImpl(): Promise<MyVideoModels> {
  const userId = await requireUserId();
  const [tier, stored, offers, keys] = await Promise.all([
    getEffectiveTier(userId),
    readVideoSettings(),
    cloudOffersFor(userId),
    db.select().from(schema.userAiKeys).where(and(eq(schema.userAiKeys.userId, userId), inArray(schema.userAiKeys.provider, VIDEO_PROVIDER_IDS))),
  ]);
  const mine = new Map(keys.map((k) => [k.provider, k]));
  return {
    offers: offers.map((o) => ({
      id: o.model.id,
      label: o.model.label,
      provider: o.model.provider,
      source: o.source,
      creditsPerSec: o.creditsPerSec,
      tasks: o.model.tasks,
      durations: o.model.durations,
      t2vAspects: aspectsFor(o.model, "text_to_video") ?? [],
      i2vAspects: aspectsFor(o.model, "image_to_video"),
      credit: VIDEO_PROVIDERS[o.model.provider].credit ?? null,
    })),
    keys: VIDEO_PROVIDER_IDS.filter((id) => stored[id]?.enabled && stored[id]?.allowOwnKey && (stored[id]?.plans ?? []).includes(tier)).map((id) => ({
      id,
      label: VIDEO_PROVIDERS[id].label,
      vendor: VIDEO_PROVIDERS[id].vendor,
      keyHint: VIDEO_PROVIDERS[id].keyHint,
      myKey: mine.get(id) ? { last4: mine.get(id)!.keyLast4 } : null,
    })),
  };
}

async function saveMyVideoKeyImpl(provider: string, key: string) {
  const userId = await requireUserId();
  if (!isProvider(provider)) throw new Error("Unknown provider");
  const [tier, stored] = await Promise.all([getEffectiveTier(userId), readVideoSettings()]);
  const s = stored[provider];
  if (!s?.enabled || !s.allowOwnKey || !(s.plans ?? []).includes(tier)) throw new Error(`Your own ${VIDEO_PROVIDERS[provider].label} key isn't available on your plan.`);
  const k = cleanKey(key);
  limitTests(userId);
  await check(provider, k);
  await db
    .insert(schema.userAiKeys)
    .values({ id: randomUUID(), userId, provider, keyEnc: encryptToken(k)!, keyLast4: k.slice(-4) })
    .onConflictDoUpdate({
      target: [schema.userAiKeys.userId, schema.userAiKeys.provider],
      set: { keyEnc: encryptToken(k)!, keyLast4: k.slice(-4), lastError: null, lastErrorAt: null, updatedAt: new Date() },
    });
  revalidatePath("/account/ai");
}

async function deleteMyVideoKeyImpl(provider: string) {
  const userId = await requireUserId();
  if (!isProvider(provider)) throw new Error("Unknown provider");
  await db.delete(schema.userAiKeys).where(and(eq(schema.userAiKeys.userId, userId), eq(schema.userAiKeys.provider, provider)));
  revalidatePath("/account/ai");
}

export async function getVideoAdmin() { return toResult(() => getVideoAdminImpl()); }
export async function saveVideoProvider(...a: Parameters<typeof saveVideoProviderImpl>) { return toResult(() => saveVideoProviderImpl(...a)); }
export async function setVideoPlatformKey(...a: Parameters<typeof setVideoPlatformKeyImpl>) { return toResult(() => setVideoPlatformKeyImpl(...a)); }
export async function testVideoPlatformKey(...a: Parameters<typeof testVideoPlatformKeyImpl>) { return toResult(() => testVideoPlatformKeyImpl(...a)); }
export async function getMyVideoModels() { return toResult(() => getMyVideoModelsImpl()); }
export async function saveMyVideoKey(...a: Parameters<typeof saveMyVideoKeyImpl>) { return toResult(() => saveMyVideoKeyImpl(...a)); }
export async function deleteMyVideoKey(...a: Parameters<typeof deleteMyVideoKeyImpl>) { return toResult(() => deleteMyVideoKeyImpl(...a)); }
