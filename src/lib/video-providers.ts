// Cloud video models for Waltz AI (Phase C1) — server-side rules shared by the Generate action, retries and the
// pickers: is a model offered to this user, whose key pays (the user's own key → 0 credits; ClipWaltz's key →
// admin-set credits per second, capped per day), and what does a clip cost. Admin settings: app_settings
// "video_providers"; user keys: user_ai_keys (provider kling | runway | minimax), encrypted like the writing models.
import { and, eq, gte, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getEffectiveTier, type Tier } from "./tier";
import {
  DEFAULT_VIDEO_DAILY_LIMIT,
  VIDEO_MODELS,
  VIDEO_PROVIDERS,
  VIDEO_SETTINGS_KEY,
  aspectsFor,
  videoModel,
  type VideoModel,
  type VideoProviderId,
  type VideoTask,
} from "../../worker/video/catalog.mjs";

export type StoredVideoProvider = {
  enabled?: boolean;
  plans?: Tier[];
  allowOwnKey?: boolean;
  platformKeyEnc?: string | null;
  platformKeyLast4?: string | null;
  dailyLimit?: number;
  credits?: Record<string, number>;
  disabledModels?: string[];
};
export type StoredVideo = Partial<Record<VideoProviderId, StoredVideoProvider>>;

export async function readVideoSettings(): Promise<StoredVideo> {
  const [row] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, VIDEO_SETTINGS_KEY));
  return ((row?.value as StoredVideo) ?? {}) as StoredVideo;
}

export const creditsPerSec = (s: StoredVideoProvider | undefined, m: VideoModel) => {
  const v = Number(s?.credits?.[m.id]);
  return Number.isFinite(v) && v >= 0 ? v : m.defaultCredits;
};
export const dailyLimitOf = (s: StoredVideoProvider | undefined) =>
  Number(s?.dailyLimit) > 0 ? Number(s!.dailyLimit) : DEFAULT_VIDEO_DAILY_LIMIT;

type Q = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * ClipWaltz-key clips this user started today (UTC) for a vendor. Counts every clip that reached the vendor — including
 * failed ones (the vendor may still bill) — and everything still queued/running; cancelled-before-submit and retried
 * copies don't count. Call it inside spendCredits' per-user lock (with its tx) so parallel requests can't overrun the cap.
 */
export async function assertDailyCap(q: Q, userId: string, provider: VideoProviderId) {
  const limit = dailyLimitOf((await readVideoSettings())[provider]);
  const since = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const [{ n }] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.generationJobs)
    .where(and(
      eq(schema.generationJobs.requestedBy, userId),
      gte(schema.generationJobs.createdAt, since),
      notInArray(schema.generationJobs.status, ["cancelled", "retried"]),
      or(
        sql`${schema.generationJobs.status} <> 'failed'`,
        sql`${schema.generationJobs.requestJson}->'cloud' ? 'taskId'`,
      ),
      sql`${schema.generationJobs.requestJson}->'cloud'->>'source' = 'platform'`,
      sql`${schema.generationJobs.requestJson}->'cloud'->>'provider' = ${provider}`,
    ));
  if (n >= limit) throw new Error(`You've made today's ${limit} ${VIDEO_PROVIDERS[provider].label} clip${limit === 1 ? "" : "s"} — more tomorrow (UTC), or add your own key under AI models.`);
}

export type CloudOffer = {
  model: VideoModel;
  /** "own" = the user's key (free on ClipWaltz), "platform" = ClipWaltz's key (credits). */
  source: "own" | "platform";
  creditsPerSec: number;
};

/** The cloud models this user can pick right now, with whose key would pay. */
export async function cloudOffersFor(userId: string): Promise<CloudOffer[]> {
  const [tier, stored, keys] = await Promise.all([
    getEffectiveTier(userId),
    readVideoSettings(),
    db.select({ provider: schema.userAiKeys.provider }).from(schema.userAiKeys).where(eq(schema.userAiKeys.userId, userId)),
  ]);
  const own = new Set(keys.map((k) => k.provider));
  const out: CloudOffer[] = [];
  for (const m of VIDEO_MODELS) {
    const s = stored[m.provider];
    if (!s?.enabled || !(s.plans ?? []).includes(tier) || (s.disabledModels ?? []).includes(m.id)) continue;
    if (s.allowOwnKey && own.has(m.provider)) out.push({ model: m, source: "own", creditsPerSec: 0 });
    else if (s.platformKeyEnc) out.push({ model: m, source: "platform", creditsPerSec: creditsPerSec(s, m) });
  }
  return out;
}

/**
 * Validate a cloud request and price it. Throws a readable error when the model isn't offered, the length/shape isn't
 * supported, or the user has used today's clips on ClipWaltz's key.
 */
export async function resolveCloud(
  userId: string,
  modelId: string,
  task: VideoTask,
  durationSec: number,
  aspect: string | null,
): Promise<{ model: VideoModel; source: "own" | "platform"; credits: number }> {
  const m = videoModel(modelId);
  if (!m) throw new Error("Unknown video model");
  const offer = (await cloudOffersFor(userId)).find((o) => o.model.id === m.id);
  if (!offer) throw new Error(`${m.label} isn't available on your plan right now.`);
  if (!m.tasks.includes(task)) throw new Error(`${m.label} can't make ${task === "text_to_video" ? "text-to-video" : "image-to-video"} clips.`);
  if (!m.durations.includes(durationSec)) {
    throw new Error(`${m.label} makes clips of ${m.durations.length > 2 ? `${m.durations[0]}–${m.durations.at(-1)}` : m.durations.join(" or ")} seconds.`);
  }
  const aspects = aspectsFor(m, task);
  if (aspects && aspect && !aspects.includes(aspect)) throw new Error(`${m.label} doesn't make ${aspect} clips — pick ${aspects.join(", ")}.`);
  if (offer.source === "platform") await assertDailyCap(db, userId, m.provider); // early, friendly check (re-checked under the lock)
  return { model: m, source: offer.source, credits: offer.source === "own" ? 0 : Math.max(1, Math.ceil(durationSec * offer.creditsPerSec)) };
}
