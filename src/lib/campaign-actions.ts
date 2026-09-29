"use server";
// WaltzDeck campaign packs (phase 4, 06_ClipWaltz_WaltzDeck_Feature_Spec.md §6): one storyboard → hooks × CTAs ×
// lengths × aspects. AI options and the batch of renders are built on the deck worker (worker/deck/jobs.mjs
// campaign_hooks / campaign_render); the render worker renders each variant's storyboard snapshot. Audience stats
// come from the public landing pages (/c/<renderId>, variant_events).
import { randomUUID } from "crypto";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { userCanAccessProject } from "./workspace";
import { enqueueDeck } from "./queue";
import { shouldWatermark } from "./watermark";
import { ctaLink, pickWinner } from "./campaign";
import {
  CAMPAIGN_ASPECTS, CAMPAIGN_LENGTHS, MAX_VARIANTS, defaultBrief,
  type Campaign, type CampaignConfig, type CampaignCta, type CampaignHook, type CampaignVariant, type DeckState, type VariantStats,
} from "./deck/types";

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

async function assertDeck(projectId: string, role: "viewer" | "editor") {
  const userId = await requireUserId();
  const [p] = await db.select({ kind: schema.projects.kind }).from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!p || p.kind !== "deck" || !(await userCanAccessProject(userId, projectId, role))) throw new Error("Project not found");
  return userId;
}

async function loadCampaign(projectId: string, campaignId: string) {
  const [c] = await db.select().from(schema.deckCampaigns)
    .where(and(eq(schema.deckCampaigns.id, campaignId), eq(schema.deckCampaigns.projectId, projectId)));
  if (!c) throw new Error("Pack not found");
  return c;
}

const count = (cfg: Pick<CampaignConfig, "hooks" | "ctas" | "lengths" | "aspects">) =>
  cfg.hooks.length * cfg.ctas.length * cfg.lengths.length * cfg.aspects.length;

/** The project's packs (newest first) with each variant's render status and audience stats. Polled by the editor. */
export async function getCampaigns(projectId: string): Promise<Campaign[]> {
  await assertDeck(projectId, "viewer");
  const rows = await db.select().from(schema.deckCampaigns).where(eq(schema.deckCampaigns.projectId, projectId))
    .orderBy(desc(schema.deckCampaigns.createdAt)).limit(10);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const renders = await db.select({
    id: schema.renders.id, campaignId: schema.renders.campaignId, status: schema.renders.status, aspect: schema.renders.aspect,
    variant: schema.renders.variant, version: schema.renders.version,
  }).from(schema.renders).where(and(isNotNull(schema.renders.campaignId), inArray(schema.renders.campaignId, ids)))
    .orderBy(schema.renders.version);
  const events = renders.length
    ? await db.select({ renderId: schema.variantEvents.renderId, type: schema.variantEvents.type, n: sql<number>`count(*)::int` })
      .from(schema.variantEvents).where(inArray(schema.variantEvents.campaignId, ids))
      .groupBy(schema.variantEvents.renderId, schema.variantEvents.type)
    : [];
  const stats = new Map<string, VariantStats>();
  for (const e of events) {
    const s = stats.get(e.renderId) ?? { views: 0, plays: 0, completes: 0, clicks: 0 };
    if (e.type === "view") s.views = e.n;
    else if (e.type === "play") s.plays = e.n;
    else if (e.type === "complete") s.completes = e.n;
    else if (e.type === "click") s.clicks = e.n;
    stats.set(e.renderId, s);
  }
  return rows.map((c) => {
    const variants: CampaignVariant[] = renders.filter((r) => r.campaignId === c.id).map((r) => {
      const v = (r.variant ?? {}) as Record<string, unknown>;
      return {
        renderId: r.id, code: String(v.code ?? ""), label: String(v.label ?? ""), status: r.status, aspect: r.aspect,
        lengthSec: Number(v.lengthSec) || 0, hookHeadline: String(v.hookHeadline ?? ""), ctaText: String(v.ctaText ?? ""),
        angle: String(v.angle ?? ""), stats: stats.get(r.id) ?? { views: 0, plays: 0, completes: 0, clicks: 0 },
      };
    });
    return {
      id: c.id, name: c.name, status: c.status as Campaign["status"], shared: c.shared, error: c.error, parentId: c.parentId,
      createdAt: c.createdAt.toISOString(), config: c.config as CampaignConfig, variants, winnerRenderId: pickWinner(variants),
    };
  });
}

export type NewCampaignInput = { aiHooks: number; aiCtas: number; extraCtas: string[]; lengths: number[]; aspects: string[] };

/** Start a pack from the current storyboard: the original hook + CTA, the owner's extra CTAs, and AI options. */
export async function createCampaign(projectId: string, input: NewCampaignInput): Promise<string> {
  const userId = await assertDeck(projectId, "editor");
  const [p] = await db.select({ deck: schema.projects.deck, aspect: schema.projects.aspect, lengthSec: schema.projects.lengthSec })
    .from(schema.projects).where(eq(schema.projects.id, projectId));
  const brief = { ...defaultBrief(), ...(((p.deck ?? {}) as Partial<DeckState>).brief ?? {}) };
  const scenes = await db.select().from(schema.deckScenes).where(eq(schema.deckScenes.projectId, projectId)).orderBy(schema.deckScenes.orderIndex);
  if (!scenes.length) throw new Error("Plan the storyboard first — a pack starts from it.");
  const hook = scenes.find((s) => s.role === "hook") ?? scenes[0];
  const ctaScene = [...scenes].reverse().find((s) => s.role === "cta");
  const ctaText = clip(brief.cta?.text, 120) || clip((ctaScene?.text as { sub?: string; headline?: string } | null)?.sub, 120)
    || clip((ctaScene?.text as { headline?: string } | null)?.headline, 120);
  const hooks: CampaignHook[] = [{
    id: randomUUID(), original: true, source: "original", assetId: hook.assetId, inSec: hook.inSec,
    headline: clip((hook.text as { headline?: string } | null)?.headline, 90), voice: hook.voice ?? "", angle: "original",
  }];
  const ctas: CampaignCta[] = [{ id: randomUUID(), original: true, source: "original", text: ctaText || "(no call to action)" }];
  for (const t of (input.extraCtas ?? []).map((x) => clip(x, 120)).filter(Boolean).slice(0, 3)) {
    if (!ctas.some((c) => c.text.toLowerCase() === t.toLowerCase())) ctas.push({ id: randomUUID(), source: "you", text: t });
  }
  const lengths = [...new Set((input.lengths ?? []).map(Number).filter((n) => (CAMPAIGN_LENGTHS as readonly number[]).includes(n)))];
  const aspects = [...new Set((input.aspects ?? []).filter((a) => (CAMPAIGN_ASPECTS as readonly string[]).includes(a)))];
  if (!lengths.length) lengths.push(p.lengthSec && (CAMPAIGN_LENGTHS as readonly number[]).includes(p.lengthSec) ? p.lengthSec : 15);
  if (!aspects.length) aspects.push(p.aspect);
  const aiHooks = Math.max(0, Math.min(3, Math.round(Number(input.aiHooks) || 0)));
  const aiCtas = ctaText ? Math.max(0, Math.min(2, Math.round(Number(input.aiCtas) || 0))) : 0;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.deckCampaigns).where(eq(schema.deckCampaigns.projectId, projectId));
  const config: CampaignConfig = { hooks, ctas, lengths, aspects, ctaUrl: ctaLink(brief.cta?.url, ctaText), aiHooks, aiCtas };
  const id = randomUUID();
  const drafting = aiHooks > 0 || aiCtas > 0;
  await db.insert(schema.deckCampaigns).values({
    id, projectId, name: `Pack ${(n ?? 0) + 1}`, status: drafting ? "drafting" : "draft", config, createdBy: userId,
  });
  if (drafting) {
    try {
      await enqueueDeck({ name: "campaign_hooks", data: { campaignId: id } });
    } catch {
      await db.update(schema.deckCampaigns).set({ status: "draft", error: "Couldn't reach the AI — add your own hooks, or try again." })
        .where(eq(schema.deckCampaigns.id, id));
    }
  }
  revalidatePath(`/projects/${projectId}/deck`);
  return id;
}

export type DraftPatch = {
  hooks?: { id: string; headline: string; sub?: string; voice?: string; assetId?: string | null }[];
  ctas?: { id: string; text: string }[];
  lengths?: number[]; aspects?: string[]; ctaUrl?: string | null; name?: string;
};

/** Edit a draft pack: hook wording / clip, CTA wording, which lengths and shapes, the button link, the name. */
export async function updateCampaignDraft(projectId: string, campaignId: string, patch: DraftPatch): Promise<void> {
  await assertDeck(projectId, "editor");
  const c = await loadCampaign(projectId, campaignId);
  if (c.status !== "draft") throw new Error("This pack can't be edited any more.");
  const cfg = { ...(c.config as CampaignConfig) };
  if (patch.hooks) {
    const known = new Map(cfg.hooks.map((h) => [h.id, h]));
    const assetIds = patch.hooks.map((h) => h.assetId).filter((a): a is string => !!a);
    const owned = assetIds.length
      ? new Set((await db.select({ id: schema.assets.id }).from(schema.assets)
        .where(and(eq(schema.assets.projectId, projectId), inArray(schema.assets.id, assetIds)))).map((a) => a.id))
      : new Set<string>();
    const next: CampaignHook[] = [];
    for (const h of patch.hooks.slice(0, 4)) {
      const prev = known.get(h.id);
      if (prev?.original) { next.push(prev); continue; } // the storyboard's own hook is edited in the storyboard
      const headline = clip(h.headline, 90);
      if (!headline) continue;
      const assetId = h.assetId === undefined ? prev?.assetId ?? null : h.assetId && owned.has(h.assetId) ? h.assetId : null;
      next.push({
        ...(prev ?? { id: randomUUID(), source: "you" as const }), id: prev?.id ?? randomUUID(), headline, sub: clip(h.sub, 140),
        voice: clip(h.voice, 300), assetId, inSec: assetId === prev?.assetId ? prev?.inSec ?? null : null,
      });
    }
    if (!next.some((h) => h.original)) next.unshift(cfg.hooks.find((h) => h.original)!);
    cfg.hooks = next.filter(Boolean);
  }
  if (patch.ctas) {
    const known = new Map(cfg.ctas.map((x) => [x.id, x]));
    const next: CampaignCta[] = [];
    for (const x of patch.ctas.slice(0, 4)) {
      const prev = known.get(x.id);
      if (prev?.original) { next.push(prev); continue; }
      const text = clip(x.text, 120);
      if (text && !next.some((y) => y.text.toLowerCase() === text.toLowerCase())) next.push({ ...(prev ?? { source: "you" as const }), id: prev?.id ?? randomUUID(), text });
    }
    if (!next.some((x) => x.original)) next.unshift(cfg.ctas.find((x) => x.original)!);
    cfg.ctas = next.filter(Boolean);
  }
  if (patch.lengths) cfg.lengths = [...new Set(patch.lengths.map(Number).filter((n) => (CAMPAIGN_LENGTHS as readonly number[]).includes(n)))];
  if (patch.aspects) cfg.aspects = [...new Set(patch.aspects.filter((a) => (CAMPAIGN_ASPECTS as readonly string[]).includes(a)))];
  if (patch.ctaUrl !== undefined) {
    const raw = clip(patch.ctaUrl, 500);
    cfg.ctaUrl = raw ? ctaLink(raw, null) : null;
    if (raw && !cfg.ctaUrl) throw new Error("That link isn't a web address (http or https).");
  }
  // Only while still a draft (a render started from another tab must not get its config rewritten).
  const [ok] = await db.update(schema.deckCampaigns).set({
    config: cfg, ...(patch.name !== undefined && clip(patch.name, 60) ? { name: clip(patch.name, 60) } : {}), updatedAt: new Date(),
  }).where(and(eq(schema.deckCampaigns.id, campaignId), eq(schema.deckCampaigns.status, "draft"))).returning({ id: schema.deckCampaigns.id });
  if (!ok) throw new Error("This pack can't be edited any more.");
}

/** Render every combination (at most MAX_VARIANTS). Watermark follows the video rule for whoever presses it. */
export async function renderCampaign(projectId: string, campaignId: string): Promise<void> {
  const userId = await assertDeck(projectId, "editor");
  const c = await loadCampaign(projectId, campaignId);
  if (c.status !== "draft") throw new Error("This pack is already rendering.");
  const cfg = c.config as CampaignConfig;
  const n = count(cfg);
  if (!n) throw new Error("Pick at least one length and one shape.");
  if (n > MAX_VARIANTS) throw new Error(`That's ${n} videos — a pack makes at most ${MAX_VARIANTS}. Remove a hook, CTA, length or shape.`);
  const watermark = await shouldWatermark(userId);
  const [done] = await db.update(schema.deckCampaigns).set({ status: "building", error: null, config: { ...cfg, watermark }, updatedAt: new Date() })
    .where(and(eq(schema.deckCampaigns.id, campaignId), eq(schema.deckCampaigns.status, "draft"))).returning({ id: schema.deckCampaigns.id });
  if (!done) throw new Error("This pack is already rendering.");
  try {
    // No fixed job id: a failed build returns the pack to draft, and a retry must not be dropped as a duplicate
    // (the conditional draft → building update above already prevents a double render).
    await enqueueDeck({ name: "campaign_render", data: { campaignId } });
  } catch {
    await db.update(schema.deckCampaigns).set({ status: "draft", error: "Couldn't reach the worker — try again." }).where(eq(schema.deckCampaigns.id, campaignId));
    throw new Error("Couldn't reach the worker — try again in a moment.");
  }
  revalidatePath(`/projects/${projectId}/deck`);
}

/** Share links on/off: on makes every variant's landing page (and video) reachable by link — never listed publicly. */
export async function setCampaignShared(projectId: string, campaignId: string, shared: boolean): Promise<void> {
  await assertDeck(projectId, "editor");
  await loadCampaign(projectId, campaignId);
  await db.update(schema.deckCampaigns).set({ shared: !!shared, updatedAt: new Date() }).where(eq(schema.deckCampaigns.id, campaignId));
  // Only private ↔ unlisted: a variant the owner deliberately made public stays public.
  await db.update(schema.renders)
    .set(shared ? { visibility: "unlisted", sharedAt: new Date() } : { visibility: "private" })
    .where(and(eq(schema.renders.campaignId, campaignId), inArray(schema.renders.visibility, shared ? ["private"] : ["unlisted"])));
}

/** Throw away a draft (nothing rendered yet). */
export async function discardCampaignDraft(projectId: string, campaignId: string): Promise<void> {
  await assertDeck(projectId, "editor");
  const c = await loadCampaign(projectId, campaignId);
  if (c.status !== "draft" && c.status !== "drafting") throw new Error("Only a draft can be discarded.");
  await db.delete(schema.deckCampaigns).where(eq(schema.deckCampaigns.id, campaignId));
}

/**
 * "Make more like this": a new draft pack that keeps this variant's hook, CTA, length and shape, and asks the AI for
 * new hooks in the same style (the other hooks of the pack are shown to it as what did worse).
 */
export async function moreLikeThis(projectId: string, renderId: string): Promise<string> {
  const userId = await assertDeck(projectId, "editor");
  const [r] = await db.select().from(schema.renders).where(and(eq(schema.renders.id, renderId), eq(schema.renders.projectId, projectId)));
  if (!r?.campaignId) throw new Error("That video isn't part of a pack.");
  const parent = await loadCampaign(projectId, r.campaignId);
  const pc = parent.config as CampaignConfig;
  const v = (r.variant ?? {}) as { hookId?: string; ctaId?: string; lengthSec?: number };
  const hook = pc.hooks.find((h) => h.id === v.hookId);
  const cta = pc.ctas.find((x) => x.id === v.ctaId);
  if (!hook || !cta) throw new Error("That variant's hook or CTA is missing.");
  const config: CampaignConfig = {
    hooks: [{ ...hook, id: randomUUID(), original: hook.original, source: hook.original ? "original" : "winner" }],
    ctas: [{ ...cta, id: randomUUID() }], lengths: [Number(v.lengthSec) || 15], aspects: [r.aspect],
    ctaUrl: pc.ctaUrl, aiHooks: 3, aiCtas: 0,
    winner: {
      renderId, headline: hook.headline, voice: hook.voice, angle: hook.angle,
      losers: pc.hooks.filter((h) => h.id !== hook.id).map((h) => h.headline).filter(Boolean).slice(0, 4),
    },
  };
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.deckCampaigns).where(eq(schema.deckCampaigns.projectId, projectId));
  const id = randomUUID();
  await db.insert(schema.deckCampaigns).values({
    id, projectId, name: `Pack ${(n ?? 0) + 1} (more like ${String((r.variant as { code?: string } | null)?.code ?? "the winner")})`,
    status: "drafting", config, parentId: parent.id, createdBy: userId,
  });
  try {
    await enqueueDeck({ name: "campaign_hooks", data: { campaignId: id } });
  } catch {
    await db.update(schema.deckCampaigns).set({ status: "draft", error: "Couldn't reach the AI — add your own hooks, or try again." }).where(eq(schema.deckCampaigns.id, id));
  }
  revalidatePath(`/projects/${projectId}/deck`);
  return id;
}
