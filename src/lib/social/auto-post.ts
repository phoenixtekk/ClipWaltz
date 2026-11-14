import { randomUUID } from "crypto";
import { initialApprovalStatus, publishableApprovalSql } from "@/lib/social/approval";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { composeForNetwork } from "@/lib/social/ai";
import { parseLinks, nextLink, withUtm } from "@/lib/social/post-links";
import { listDestinations, parseKey } from "@/lib/social/destinations";
import { networkLimit } from "@/lib/social/network-limits";
import { readMedia, writeMedia } from "@/lib/social/media";
import { effectiveLimit } from "@/lib/social/post-limits";

// ─── Auto Post: writing the next post instead of only draining a queue ────────
// A rule in "generate" mode still prefers whatever is queued — nothing a human
// wrote should be stranded behind machine-written copy. Only when the queue is
// empty does it write a fresh post from the standing seed prompt, the next topic
// in the rotation, and (optionally) a product's positioning.
//
// Generation mirrors the funnel planner: one pass per destination through the
// self-hosted Ollama box, with recent posts from this rule fed in as `avoid` so
// the copy does not drift into repetition slot after slot.

// ClipWaltz port notes: rules belong to a WORKSPACE (SP: a user). Product grounding is not ported — products and funnels
// stay on SP (decision D3) — so `product` is always null here; the column is kept on the rule for row-copy fidelity.
// The "explainer" video mode (P5, decision D6) enqueues an episode on the render worker (src/lib/social/render-jobs.ts).

type Rule = typeof schema.socialAutoRules.$inferSelect;
/** SP's product shape, as far as the seed builder reads it. Always null in ClipWaltz until/unless D3 changes. */
type Product = {
  name: string;
  oneLiner?: string | null;
  positioning?: string | null;
  audience?: { who?: string; pain?: string; outcome?: string } | null;
  proofPoints?: string | null;
  siteUrl?: string | null;
  voice?: string | null;
};

/** Hard cap per sweep — the AI box is shared with funnels and the composer. */
const MAX_GENERATIONS_PER_RUN = 12;
/** How many of the rule's recent posts to show the model as "don't repeat these". */
const AVOID_WINDOW = 6;

export interface GeneratedPost {
  postId: string;
  text: string;
  destinations: string[];
  topic: string | null;
  imageAttached: boolean;
  autoImage: boolean;
  status: "queued-for-publish" | "draft" | "rendering";
}

export function parseTopics(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function parseIdList(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** The standing brief the model writes from, assembled for one slot. */
function buildSeed(rule: Rule, topic: string | null, product: Product | null, link: string | null): string {
  const bits = [
    rule.seedPrompt.trim(),
    topic ? `Today's topic: ${topic}.` : "",
    product ? `This is about ${product.name}${product.oneLiner ? ` — ${product.oneLiner}` : ""}.` : "",
    product?.positioning ? `Positioning: ${product.positioning}` : "",
    product?.audience?.who ? `Audience: ${product.audience.who}.` : "",
    product?.audience?.pain ? `Their pain: ${product.audience.pain}.` : "",
    product?.audience?.outcome ? `The outcome they want: ${product.audience.outcome}.` : "",
    product?.proofPoints ? `True proof points you may use verbatim:\n${product.proofPoints}` : "",
    // Naming the destination without pasting it stops the model inventing a
    // plausible-looking URL of its own, which is the usual failure here.
    link
      ? 'A link is attached to this post automatically. End with a call to action that points to it — say "the link" or "below". Do NOT write any URL yourself.'
      : "",
  ];
  return bits.filter(Boolean).join("\n");
}

/** Recent copy this rule produced, so the next slot reads differently. */
async function recentRuleText(ruleId: string, n: number): Promise<string[]> {
  const rows = await db
    .select({ text: schema.socialPosts.text })
    .from(schema.socialPosts)
    .where(eq(schema.socialPosts.autoPostRuleId, ruleId))
    .orderBy(desc(schema.socialPosts.createdAt))
    .limit(n);
  return rows.map((r) => r.text).filter(Boolean);
}

/**
 * Copy one library image into a post-owned media row. Publishing loads media by
 * `postId`, and the set's originals must stay in the library for the next
 * rotation, so the bytes are duplicated rather than the row reassigned.
 */
async function attachImageCopy(mediaId: string, postId: string, workspaceId: string, createdBy: string | null): Promise<boolean> {
  const src = await db.query.socialMedia.findFirst({ where: eq(schema.socialMedia.id, mediaId) });
  if (!src || src.workspaceId !== workspaceId) return false;
  try {
    const bytes = await readMedia(mediaId, workspaceId);
    const id = randomUUID();
    const storageKey = await writeMedia(workspaceId, id, bytes, src.mime);
    await db.insert(schema.socialMedia).values({
      id, workspaceId, createdBy, postId, kind: src.kind, filename: src.filename, mime: src.mime, size: src.size,
      storageKey, source: src.source,
    });
    return true;
  } catch {
    // A missing file must not sink the whole slot — post it without the image.
    return false;
  }
}

/**
 * Write and persist one post for a rule. Returns null when nothing could be
 * generated (no destinations, no seed, or the AI box refused every attempt) so
 * the caller can leave the slot empty rather than publish something broken.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `now` kept from SP's signature (callers pass the sweep time)
export async function generateForRule(rule: Rule, now: Date): Promise<GeneratedPost | null> {
  const keys = parseIdList(rule.providers);
  if (keys.length === 0) return null;

  const product = null as Product | null;
  // Without a seed or a product there is nothing to write about; refuse rather
  // than invent a subject.
  if (!rule.seedPrompt.trim() && !product) return null;

  const topics = parseTopics(rule.topics);
  const topic = topics.length ? topics[rule.topicCursor % topics.length] : null;

  // The rule's own links rotate; with none configured, a product's site is the
  // obvious fallback rather than promoting something that leads nowhere.
  const links = parseLinks(rule.links);
  const link = nextLink(links, rule.linkCursor) ?? (product?.siteUrl?.trim() || null);

  // ── An explainer episode takes a different road entirely ─────────────────
  //
  // The normal path asks the model for per-network copy and publishes it. An
  // episode instead writes a SCRIPT, narrates it, renders a video and derives
  // the copy from that — minutes of work across five stages. So this enqueues a
  // job and returns; the render queue drives the stages and fills the post in.
  if (rule.videoMode === "explainer") {
    return enqueueExplainer(rule, keys, topic, link, topics.length);
  }

  const seed = buildSeed(rule, topic, product, link);

  // The rule's workspace — Auto Post runs on the scheduler, with no session.
  const dests = await listDestinations(rule.workspaceId);
  const byKey = new Map(dests.map((d) => [d.key, d]));
  const avoid = await recentRuleText(rule.id, AVOID_WINDOW);

  const perNetwork: Record<string, { text: string; link?: string }> = {};
  const used: string[] = [];
  let budget = MAX_GENERATIONS_PER_RUN;

  for (const key of keys) {
    if (budget <= 0) break;
    const d = byKey.get(key);
    const provider = d?.provider ?? parseKey(key).provider;
    try {
      const text = await composeForNetwork({
        seed,
        networkLabel: d?.label ?? provider,
        context: d?.context || product?.voice || undefined,
        limit: await effectiveLimit(networkLimit(provider)),
        avoid,
      });
      budget--;
      if (text.trim()) {
        // With UTM tagging on, every destination carries the same link stamped
        // with its own source, so analytics can separate the traffic.
        const tagged =
          link && rule.linkUtm
            ? withUtm(link, { source: provider, campaign: rule.name, content: topic ?? undefined })
            : undefined;
        perNetwork[key] = { text: text.trim(), ...(tagged ? { link: tagged } : {}) };
        used.push(key);
      }
    } catch {
      budget--; // a single network failing is not fatal to the slot
    }
  }
  if (used.length === 0) return null;

  const postId = randomUUID();
  const first = perNetwork[used[0]].text;

  // "set" attaches the next image in the rotation; "generate" defers to the
  // existing publish-time render queue (autoImage only fires with no media).
  let imageAttached = false;
  const set = parseIdList(rule.imageSet);
  const nextImage = rule.imageMode === "set" && set.length ? set[rule.imageCursor % set.length] : null;

  await db.insert(schema.socialPosts).values({
    id: postId,
    workspaceId: rule.workspaceId,
    createdBy: rule.createdBy,
    text: first,
    providers: used.join(","),
    perNetwork,
    link: link ?? null,
    status: rule.reviewFirst ? "draft" : "queued",
    // G9: in a workspace that requires approval, a generated post waits for an approver.
    approvalStatus: await initialApprovalStatus(rule.workspaceId),
    autoImage: rule.imageMode === "generate",
    autoPostRuleId: rule.id,
  });

  if (nextImage) imageAttached = await attachImageCopy(nextImage, postId, rule.workspaceId, rule.createdBy);

  // Advance the rotations only once the slot actually produced something, so a
  // failed run does not silently skip a topic or an image.
  await db
    .update(schema.socialAutoRules)
    .set({
      topicCursor: topics.length ? (rule.topicCursor + 1) % topics.length : 0,
      imageCursor: set.length && rule.imageMode === "set" ? (rule.imageCursor + 1) % set.length : rule.imageCursor,
      linkCursor: links.length ? (rule.linkCursor + 1) % links.length : 0,
    })
    .where(eq(schema.socialAutoRules.id, rule.id));

  return {
    postId,
    text: first,
    destinations: used,
    topic,
    imageAttached,
    autoImage: rule.imageMode === "generate",
    status: rule.reviewFirst ? "draft" : "queued-for-publish",
  };
}

/**
 * Create the post and its render job for one explainer slot (SP enqueueExplainer). The post lands in `rendering`
 * with the topic as placeholder text; the episode's own copy replaces it when the job finishes, and review-first is
 * applied then (src/lib/social/render-jobs.ts finalizeRenderJobs). The rule's creator pays the credits; a slot they
 * can't afford (or one with no topic / brief) produces nothing and does not advance the topic.
 */
async function enqueueExplainer(
  rule: Rule,
  keys: string[],
  topic: string | null,
  link: string | null,
  topicCount: number,
): Promise<GeneratedPost | null> {
  if (!topic || !rule.seedPrompt.trim() || !rule.createdBy) return null;
  const { startExplainer, usableKeys } = await import("@/lib/social/render-jobs");
  const usable = await usableKeys(keys, rule.workspaceId, { allowPodcast: true });
  if (!usable.length) return null;
  let postId: string;
  try {
    ({ postId } = await startExplainer({
      workspaceId: rule.workspaceId,
      userId: rule.createdBy,
      keys: usable,
      topic,
      seedPrompt: rule.seedPrompt,
      link,
      reviewFirst: rule.reviewFirst,
      autoRuleId: rule.id,
    }));
  } catch (e) {
    console.warn(`[social] explainer slot for rule ${rule.id} skipped: ${(e as Error).message}`);
    return null;
  }
  // Advance the rotation only because a slot was genuinely produced — a failed render never skips a topic.
  await db
    .update(schema.socialAutoRules)
    .set({ topicCursor: topicCount ? (rule.topicCursor + 1) % topicCount : 0 })
    .where(eq(schema.socialAutoRules.id, rule.id));
  return { postId, text: topic, destinations: usable, topic, imageAttached: false, autoImage: false, status: "rendering" };
}

/** The post a rule should publish this slot: whatever is queued, else a fresh one. */
export async function nextPostForRule(rule: Rule, now: Date): Promise<{ postId: string; generated: boolean } | null> {
  const [queued] = await db
    .select()
    .from(schema.socialPosts)
    .where(
      and(
        eq(schema.socialPosts.workspaceId, rule.workspaceId),
        eq(schema.socialPosts.status, "queued"),
        isNull(schema.socialPosts.migrationHold),
        // G9: an unapproved post never blocks the queue — the next approved one goes instead.
        publishableApprovalSql(),
      ),
    )
    .orderBy(schema.socialPosts.createdAt)
    .limit(1);
  if (queued) return { postId: queued.id, generated: false };
  if (rule.mode !== "generate") return null;

  const gen = await generateForRule(rule, now);
  if (!gen) return null;
  // A review-first rule leaves the draft for a human; an explainer is still rendering (its job releases it later).
  return gen.status === "queued-for-publish" ? { postId: gen.postId, generated: true } : null;
}
