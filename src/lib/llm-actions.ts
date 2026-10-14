"use server";
import { randomUUID } from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "./admin";
import { requireUserId } from "./auth";
import { toResult } from "./action-result";
import { encryptToken } from "./cloud/crypto";
import { getEffectiveTier, type Tier } from "./tier";
import { ONLINE_MS, normalizeUserCode } from "./connector";
import {
  LLM_PROVIDERS,
  LLM_IDS,
  LLM_SETTINGS_KEY,
  DEFAULT_DAILY_LIMIT,
  CONNECTOR_ID,
  TIERS,
  decryptSecret,
  testLlm,
  llmErrorText,
  type LlmProviderId,
} from "../../worker/deck/llm.mjs";

// AI models for writing & planning: admin turns each outside provider on per plan, adds ClipWaltz's own key and/or
// lets users bring theirs; users pick which model writes their scripts. The generation worker reads the same
// settings at job time (worker/deck/llm.mjs resolveLlm), so changes apply to the next AI job.

type StoredProvider = {
  enabled?: boolean;
  plans?: Tier[];
  allowOwnKey?: boolean;
  model?: string;
  visionModel?: string;
  platformKeyEnc?: string | null;
  platformKeyLast4?: string | null;
  dailyLimit?: number;
};
type Stored = Partial<Record<LlmProviderId, StoredProvider>> & { connector?: { enabled?: boolean; plans?: Tier[] } };
type Status = Partial<Record<LlmProviderId, { lastError?: string; at?: string; lastOkAt?: string }>>;

export type LlmAdminProvider = {
  id: LlmProviderId;
  label: string;
  vendor: string;
  defaultModel: string;
  enabled: boolean;
  plans: Tier[];
  allowOwnKey: boolean;
  model: string;
  visionModel: string;
  dailyLimit: number;
  platformKeyLast4: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastOkAt: string | null;
  ownKeyUsers: number;
};

export type ConnectorAdmin = { enabled: boolean; plans: Tier[]; paired: number; online: number };

export type MyComputer = {
  id: string;
  name: string;
  platform: string | null;
  version: string | null;
  online: boolean;
  models: string[];
  model: string | null;
  lastSeenAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastUsedAt: string | null;
  /** Connector v0.2: the GPU and what its local ComfyUI can render (template id → label in the UI). */
  gpu: { name: string; vramMb: number } | null;
  video: { ok: boolean; error: string | null; ready: string[]; missing: Record<string, string[]> } | null;
};

export type MyAiModels = {
  tier: Tier;
  choice: { provider: "builtin" | "connector" | LlmProviderId; source: "platform" | "own" | "computer" };
  /** The ClipWaltz Connector (your own computer's Ollama): offered on your plan? + your paired computers. */
  computer: { available: boolean; computers: MyComputer[] };
  /** Why the saved choice isn't in use right now (provider turned off, plan, key missing), else null. */
  choiceInactive: string | null;
  providers: {
    id: LlmProviderId;
    label: string;
    vendor: string;
    keyHint: string;
    defaultModel: string;
    /** Turned on for the user's plan. */
    available: boolean;
    platform: boolean;
    /** Jobs a day on ClipWaltz's key, and how many the user ran today. */
    dailyLimit: number;
    usedToday: number;
    allowOwnKey: boolean;
    myKey: { last4: string; model: string | null; lastError: string | null; lastErrorAt: string | null; lastUsedAt: string | null } | null;
  }[];
};

// Key tests make a real vendor call: at most 5 per user per 10 minutes (per app instance), so the test buttons
// can't be used to check stolen keys in bulk.
const testLog = new Map<string, number[]>();
function limitTests(userId: string) {
  const now = Date.now();
  const recent = (testLog.get(userId) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 5) throw new Error("Too many key tests — wait a few minutes and try again.");
  recent.push(now);
  testLog.set(userId, recent);
}
const limitOf = (s: StoredProvider | undefined) => (Number(s?.dailyLimit) > 0 ? Number(s!.dailyLimit) : DEFAULT_DAILY_LIMIT);

const isProvider = (p: unknown): p is LlmProviderId => typeof p === "string" && (LLM_IDS as string[]).includes(p);
const KEY_RE = /^[\x21-\x7e]{16,400}$/; // printable, no spaces
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

function cleanKey(key: unknown): string {
  const k = typeof key === "string" ? key.trim() : "";
  if (!KEY_RE.test(k)) throw new Error("That doesn't look like an API key — paste the whole key, with no spaces.");
  return k;
}
function cleanModel(model: unknown): string | null {
  const m = typeof model === "string" ? model.trim() : "";
  if (!m) return null;
  if (!MODEL_RE.test(m)) throw new Error("Model names use letters, numbers, dots, dashes, slashes and colons only.");
  return m;
}

async function readSetting<T>(key: string): Promise<T> {
  const [row] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, key));
  return ((row?.value as T) ?? {}) as T;
}
async function writeProviders(value: Stored) {
  await db
    .insert(schema.appSettings)
    .values({ key: LLM_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
}

/** Test a key with a tiny real call; throws a readable message. */
async function check(provider: LlmProviderId, apiKey: string, model: string | null) {
  try {
    await testLlm({ provider, apiKey, model: model ?? undefined });
  } catch (e) {
    throw new Error(`${LLM_PROVIDERS[provider].label} rejected the test: ${llmErrorText(e)}`);
  }
}

// ── Admin ────────────────────────────────────────────────────────────────────────────────────────

async function getLlmAdminImpl(): Promise<LlmAdminProvider[]> {
  await requireAdmin();
  const [stored, status, counts] = await Promise.all([
    readSetting<Stored>(LLM_SETTINGS_KEY),
    readSetting<Status>("llm_provider_status"),
    db
      .select({ provider: schema.userAiKeys.provider, n: sql<number>`count(*)::int` })
      .from(schema.userAiKeys)
      .groupBy(schema.userAiKeys.provider),
  ]);
  const n = new Map(counts.map((c) => [c.provider, c.n]));
  return LLM_IDS.map((id) => {
    const s = stored[id] ?? {};
    const meta = LLM_PROVIDERS[id];
    return {
      id,
      label: meta.label,
      vendor: meta.vendor,
      defaultModel: meta.model,
      enabled: !!s.enabled,
      plans: s.plans ?? [],
      allowOwnKey: !!s.allowOwnKey,
      model: s.model || meta.model,
      visionModel: s.visionModel || s.model || meta.model,
      dailyLimit: limitOf(s),
      platformKeyLast4: s.platformKeyEnc ? (s.platformKeyLast4 ?? "••••") : null,
      lastError: status[id]?.lastError ?? null,
      lastErrorAt: status[id]?.at ?? null,
      lastOkAt: status[id]?.lastOkAt ?? null,
      ownKeyUsers: n.get(id) ?? 0,
    };
  });
}

async function saveLlmProviderImpl(
  id: string,
  input: { enabled: boolean; plans: string[]; allowOwnKey: boolean; model: string; visionModel: string; dailyLimit: number },
) {
  await requireAdmin();
  if (!isProvider(id)) throw new Error("Unknown provider");
  const plans = (TIERS as string[]).filter((t) => input.plans.includes(t)) as Tier[];
  const stored = await readSetting<Stored>(LLM_SETTINGS_KEY);
  stored[id] = {
    ...stored[id],
    enabled: !!input.enabled,
    plans,
    allowOwnKey: !!input.allowOwnKey,
    model: cleanModel(input.model) ?? LLM_PROVIDERS[id].model,
    visionModel: cleanModel(input.visionModel) ?? cleanModel(input.model) ?? LLM_PROVIDERS[id].model,
    dailyLimit: Math.min(10000, Math.max(1, Math.round(Number(input.dailyLimit) || DEFAULT_DAILY_LIMIT))),
  };
  await writeProviders(stored);
  revalidatePath("/admin/ai");
}

/** Save (after a successful test) or remove ClipWaltz's own key for a provider. */
async function setLlmPlatformKeyImpl(id: string, key: string | null) {
  await requireAdmin();
  if (!isProvider(id)) throw new Error("Unknown provider");
  const stored = await readSetting<Stored>(LLM_SETTINGS_KEY);
  const cur = stored[id] ?? {};
  if (key === null) {
    stored[id] = { ...cur, platformKeyEnc: null, platformKeyLast4: null };
  } else {
    const k = cleanKey(key);
    await check(id, k, cur.model ?? null);
    stored[id] = { ...cur, platformKeyEnc: encryptToken(k), platformKeyLast4: k.slice(-4) };
  }
  await writeProviders(stored);
  revalidatePath("/admin/ai");
}

async function testLlmPlatformKeyImpl(id: string): Promise<number> {
  await requireAdmin();
  if (!isProvider(id)) throw new Error("Unknown provider");
  const cur = (await readSetting<Stored>(LLM_SETTINGS_KEY))[id];
  const apiKey = decryptSecret(cur?.platformKeyEnc);
  if (!apiKey) throw new Error("No ClipWaltz key saved for this provider");
  const t0 = Date.now();
  await check(id, apiKey, cur?.model ?? null);
  return Date.now() - t0;
}

// ── Users ────────────────────────────────────────────────────────────────────────────────────────

async function getMyAiModelsImpl(): Promise<MyAiModels> {
  const userId = await requireUserId();
  const [tier, stored, keys, [pref], computerRows] = await Promise.all([
    getEffectiveTier(userId),
    readSetting<Stored>(LLM_SETTINGS_KEY),
    db.select().from(schema.userAiKeys).where(eq(schema.userAiKeys.userId, userId)),
    db.select().from(schema.aiPrefs).where(eq(schema.aiPrefs.userId, userId)),
    db
      .select()
      .from(schema.connectors)
      .where(and(eq(schema.connectors.userId, userId), isNull(schema.connectors.revokedAt)))
      .orderBy(schema.connectors.createdAt),
  ]);
  const byProvider = new Map(keys.map((k) => [k.provider, k]));
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = pref?.platformDay === today ? pref.platformJobs : 0;
  const providers = LLM_IDS.map((id) => {
    const s = stored[id] ?? {};
    const k = byProvider.get(id);
    const available = !!s.enabled && (s.plans ?? []).includes(tier);
    return {
      id,
      label: LLM_PROVIDERS[id].label,
      vendor: LLM_PROVIDERS[id].vendor,
      keyHint: LLM_PROVIDERS[id].keyHint,
      defaultModel: s.model || LLM_PROVIDERS[id].model,
      available,
      platform: available && !!s.platformKeyEnc,
      dailyLimit: limitOf(s),
      usedToday: pref?.writingProvider === id && pref.source === "platform" ? usedToday : 0,
      allowOwnKey: available && !!s.allowOwnKey,
      myKey: k
        ? {
            last4: k.keyLast4,
            model: k.model,
            lastError: k.lastError,
            lastErrorAt: k.lastErrorAt?.toISOString() ?? null,
            lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          }
        : null,
    };
  });
  const computerAvailable = !!stored.connector?.enabled && (stored.connector.plans ?? []).includes(tier);
  const computers: MyComputer[] = computerRows.map((c) => ({
    id: c.id,
    name: c.name,
    platform: c.platform,
    version: c.version,
    online: !!c.lastSeenAt && Date.now() - c.lastSeenAt.getTime() < ONLINE_MS,
    models: (c.models as string[]) ?? [],
    model: c.model,
    lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
    lastError: c.lastError,
    lastErrorAt: c.lastErrorAt?.toISOString() ?? null,
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    gpu: (c.gpu ?? null) as MyComputer["gpu"],
    video: (c.comfy ?? null) as MyComputer["video"],
  }));
  if (pref?.writingProvider === CONNECTOR_ID) {
    const online = computers.filter((c) => c.online && (c.model || c.models.length));
    const choiceInactive = !computerAvailable
      ? "Your own computer isn't available on your plan right now — the built-in model is writing for you."
      : !online.length
        ? "None of your computers is online with a model — start the ClipWaltz Connector. Until then the built-in model is writing for you."
        : null;
    return { tier, choice: { provider: CONNECTOR_ID, source: "computer" }, computer: { available: computerAvailable, computers }, choiceInactive, providers };
  }
  const provider = pref && isProvider(pref.writingProvider) ? pref.writingProvider : "builtin";
  const source = pref?.source === "own" ? "own" : "platform";
  let choiceInactive: string | null = null;
  if (provider !== "builtin") {
    const p = providers.find((x) => x.id === provider)!;
    if (!p.available) choiceInactive = `${p.label} isn't available on your plan right now — the built-in model is writing for you.`;
    else if (source === "own" && (!p.allowOwnKey || !p.myKey)) choiceInactive = `Add your ${p.label} key below — until then the built-in model is writing for you.`;
    else if (source === "platform" && !p.platform) choiceInactive = `${p.label} needs your own key on your plan — until then the built-in model is writing for you.`;
  }
  return { tier, choice: { provider, source }, computer: { available: computerAvailable, computers }, choiceInactive, providers };
}

async function allowedForMe(userId: string, provider: LlmProviderId) {
  const [tier, stored] = await Promise.all([getEffectiveTier(userId), readSetting<Stored>(LLM_SETTINGS_KEY)]);
  const s = stored[provider];
  if (!s?.enabled || !(s.plans ?? []).includes(tier)) throw new Error(`${LLM_PROVIDERS[provider].label} isn't available on your plan.`);
  return s;
}

/** Save the user's own key (tested first) and optional model. */
async function saveMyAiKeyImpl(provider: string, key: string, model: string | null) {
  const userId = await requireUserId();
  if (!isProvider(provider)) throw new Error("Unknown provider");
  const s = await allowedForMe(userId, provider);
  if (!s.allowOwnKey) throw new Error(`Using your own ${LLM_PROVIDERS[provider].label} key isn't turned on.`);
  const k = cleanKey(key);
  const m = cleanModel(model);
  limitTests(userId);
  await check(provider, k, m ?? s.model ?? null);
  const now = new Date();
  await db
    .insert(schema.userAiKeys)
    .values({ id: randomUUID(), userId, provider, keyEnc: encryptToken(k)!, keyLast4: k.slice(-4), model: m })
    .onConflictDoUpdate({
      target: [schema.userAiKeys.userId, schema.userAiKeys.provider],
      set: { keyEnc: encryptToken(k)!, keyLast4: k.slice(-4), model: m, lastError: null, lastErrorAt: null, updatedAt: now },
    });
  revalidatePath("/account/ai");
}

async function setMyAiKeyModelImpl(provider: string, model: string | null) {
  const userId = await requireUserId();
  if (!isProvider(provider)) throw new Error("Unknown provider");
  await db
    .update(schema.userAiKeys)
    .set({ model: cleanModel(model), updatedAt: new Date() })
    .where(and(eq(schema.userAiKeys.userId, userId), eq(schema.userAiKeys.provider, provider)));
  revalidatePath("/account/ai");
}

async function deleteMyAiKeyImpl(provider: string) {
  const userId = await requireUserId();
  if (!isProvider(provider)) throw new Error("Unknown provider");
  await db.delete(schema.userAiKeys).where(and(eq(schema.userAiKeys.userId, userId), eq(schema.userAiKeys.provider, provider)));
  revalidatePath("/account/ai");
}

async function testMyAiKeyImpl(provider: string): Promise<number> {
  const userId = await requireUserId();
  if (!isProvider(provider)) throw new Error("Unknown provider");
  const s = await allowedForMe(userId, provider);
  const [k] = await db
    .select()
    .from(schema.userAiKeys)
    .where(and(eq(schema.userAiKeys.userId, userId), eq(schema.userAiKeys.provider, provider)));
  if (!k) throw new Error("No key saved");
  limitTests(userId);
  const t0 = Date.now();
  await check(provider, decryptSecret(k.keyEnc)!, k.model ?? s.model ?? null);
  await db.update(schema.userAiKeys).set({ lastError: null, lastErrorAt: null, lastUsedAt: new Date() }).where(eq(schema.userAiKeys.id, k.id));
  return Date.now() - t0;
}

// ── Your own computer (ClipWaltz Connector) ──────────────────────────────────────────────────────

async function computerAllowed(userId: string) {
  const [tier, stored] = await Promise.all([getEffectiveTier(userId), readSetting<Stored>(LLM_SETTINGS_KEY)]);
  if (!stored.connector?.enabled || !(stored.connector.plans ?? []).includes(tier)) {
    throw new Error("Using your own computer isn't available on your plan.");
  }
}

// Code checks (look up + approve): 10 per user per 10 minutes, so user codes can't be guessed in bulk.
const pairLog = new Map<string, number[]>();
function limitPairing(userId: string) {
  const now = Date.now();
  const recent = (pairLog.get(userId) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 10) throw new Error("Too many codes tried — wait a few minutes.");
  recent.push(now);
  pairLog.set(userId, recent);
}

async function pendingPairing(userId: string, code: string) {
  await computerAllowed(userId);
  limitPairing(userId);
  const userCode = normalizeUserCode(code ?? "");
  if (!userCode) throw new Error("Enter the 8-character code shown by the Connector.");
  const [p] = await db.select().from(schema.connectorPairings).where(eq(schema.connectorPairings.userCode, userCode));
  if (!p || p.expiresAt.getTime() < Date.now() || (p.approvedBy && p.approvedBy !== userId)) {
    throw new Error("That code is wrong, expired or already used — run pair again on your computer.");
  }
  return p;
}

export type PendingComputer = { code: string; name: string; platform: string | null; version: string | null; origin: string | null; minutesAgo: number };

/** Step 1: show which computer is asking (name, system, where from, when) before the user approves it. */
async function lookupPairingImpl(code: string): Promise<PendingComputer> {
  const p = await pendingPairing(await requireUserId(), code);
  const minutesAgo = Math.max(0, Math.round((Date.now() - p.createdAt.getTime()) / 60_000));
  return { code: p.userCode, name: p.name, platform: p.platform, version: p.version, origin: p.origin, minutesAgo };
}

/** Step 2: the signed-in user approves; the Connector then receives its token. */
async function approvePairingImpl(code: string): Promise<{ name: string }> {
  const userId = await requireUserId();
  const p = await pendingPairing(userId, code);
  const mine = await db.select({ id: schema.connectors.id }).from(schema.connectors)
    .where(and(eq(schema.connectors.userId, userId), isNull(schema.connectors.revokedAt)));
  if (mine.length >= 5) throw new Error("You can connect up to 5 computers — disconnect one first.");
  const [done] = await db
    .update(schema.connectorPairings)
    .set({ approvedBy: userId })
    .where(and(eq(schema.connectorPairings.id, p.id), isNull(schema.connectorPairings.approvedBy)))
    .returning({ id: schema.connectorPairings.id });
  if (!done) throw new Error("That code was already used — run pair again on your computer.");
  revalidatePath("/account/ai");
  return { name: p.name };
}

async function setComputerModelImpl(id: string, model: string | null) {
  const userId = await requireUserId();
  const [c] = await db.select().from(schema.connectors).where(and(eq(schema.connectors.id, id), eq(schema.connectors.userId, userId)));
  if (!c) throw new Error("Computer not found");
  const m = cleanModel(model);
  if (m && !((c.models as string[]) ?? []).includes(m)) throw new Error("That model isn't installed on this computer.");
  await db.update(schema.connectors).set({ model: m }).where(eq(schema.connectors.id, id));
  revalidatePath("/account/ai");
}

/** Disconnect a computer: its token stops working at once. */
async function removeComputerImpl(id: string) {
  const userId = await requireUserId();
  await db.delete(schema.connectors).where(and(eq(schema.connectors.id, id), eq(schema.connectors.userId, userId)));
  revalidatePath("/account/ai");
}

async function getConnectorAdminImpl(): Promise<ConnectorAdmin> {
  await requireAdmin();
  const [stored, [counts]] = await Promise.all([
    readSetting<Stored>(LLM_SETTINGS_KEY),
    db
      .select({
        paired: sql<number>`count(*)::int`,
        online: sql<number>`(count(*) filter (where ${schema.connectors.lastSeenAt} > now() - interval '90 seconds'))::int`,
      })
      .from(schema.connectors)
      .where(isNull(schema.connectors.revokedAt)),
  ]);
  return { enabled: !!stored.connector?.enabled, plans: stored.connector?.plans ?? [], paired: counts?.paired ?? 0, online: counts?.online ?? 0 };
}

async function saveConnectorAdminImpl(input: { enabled: boolean; plans: string[] }) {
  await requireAdmin();
  const stored = await readSetting<Stored>(LLM_SETTINGS_KEY);
  stored.connector = { enabled: !!input.enabled, plans: (TIERS as string[]).filter((t) => input.plans.includes(t)) as Tier[] };
  await writeProviders(stored);
  revalidatePath("/admin/ai");
}

/** Which model writes the user's scripts and plans. */
async function setMyAiModelImpl(provider: string, source: string) {
  const userId = await requireUserId();
  if (provider === CONNECTOR_ID) {
    await computerAllowed(userId);
    source = "computer";
  } else if (provider !== "builtin") {
    if (!isProvider(provider)) throw new Error("Unknown provider");
    const s = await allowedForMe(userId, provider);
    if (source === "own" && !s.allowOwnKey) throw new Error(`Using your own ${LLM_PROVIDERS[provider].label} key isn't turned on.`);
    if (source !== "own" && !s.platformKeyEnc) throw new Error(`${LLM_PROVIDERS[provider].label} needs your own key.`);
  }
  const value = { writingProvider: provider, source: source === "own" || source === "computer" ? source : "platform", updatedAt: new Date() };
  await db
    .insert(schema.aiPrefs)
    .values({ userId, ...value })
    .onConflictDoUpdate({ target: schema.aiPrefs.userId, set: value });
  revalidatePath("/account/ai");
}

export async function getLlmAdmin() { return toResult(() => getLlmAdminImpl()); }
export async function getConnectorAdmin() { return toResult(() => getConnectorAdminImpl()); }
export async function saveConnectorAdmin(...a: Parameters<typeof saveConnectorAdminImpl>) { return toResult(() => saveConnectorAdminImpl(...a)); }
export async function approvePairing(...a: Parameters<typeof approvePairingImpl>) { return toResult(() => approvePairingImpl(...a)); }
export async function lookupPairing(...a: Parameters<typeof lookupPairingImpl>) { return toResult(() => lookupPairingImpl(...a)); }
export async function setComputerModel(...a: Parameters<typeof setComputerModelImpl>) { return toResult(() => setComputerModelImpl(...a)); }
export async function removeComputer(...a: Parameters<typeof removeComputerImpl>) { return toResult(() => removeComputerImpl(...a)); }
export async function saveLlmProvider(...a: Parameters<typeof saveLlmProviderImpl>) { return toResult(() => saveLlmProviderImpl(...a)); }
export async function setLlmPlatformKey(...a: Parameters<typeof setLlmPlatformKeyImpl>) { return toResult(() => setLlmPlatformKeyImpl(...a)); }
export async function testLlmPlatformKey(...a: Parameters<typeof testLlmPlatformKeyImpl>) { return toResult(() => testLlmPlatformKeyImpl(...a)); }
export async function getMyAiModels() { return toResult(() => getMyAiModelsImpl()); }
export async function saveMyAiKey(...a: Parameters<typeof saveMyAiKeyImpl>) { return toResult(() => saveMyAiKeyImpl(...a)); }
export async function setMyAiKeyModel(...a: Parameters<typeof setMyAiKeyModelImpl>) { return toResult(() => setMyAiKeyModelImpl(...a)); }
export async function deleteMyAiKey(...a: Parameters<typeof deleteMyAiKeyImpl>) { return toResult(() => deleteMyAiKeyImpl(...a)); }
export async function testMyAiKey(...a: Parameters<typeof testMyAiKeyImpl>) { return toResult(() => testMyAiKeyImpl(...a)); }
export async function setMyAiModel(...a: Parameters<typeof setMyAiModelImpl>) { return toResult(() => setMyAiModelImpl(...a)); }
