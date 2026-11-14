"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { toResult } from "@/lib/action-result";
import { requireSocial } from "@/lib/social/access";
import { deleteEpisode, saveShow, setShowActive, uploadCover, type ShowInput } from "@/lib/podcast/shows";
import { isAdminWorkspace, listRenderJobs, startExplainer, startShort, usableKeys, type RenderJobView } from "@/lib/social/render-jobs";
import { deleteShortRule, runShortRule, saveShortRule, type ShortRuleInput } from "@/lib/social/short-rules";

// Server actions for the P5 screens: Publish → Podcast, Shorts and Explainers. Every action re-checks the caller with
// requireSocial (flag, workspace membership, role) and scopes every read/write to that workspace.
//   editor+  make Shorts / explainers, manage Shorts rules
//   admin+   create / edit podcast shows (a show is a destination, like connecting a channel)

const touch = () => revalidatePath("/publish", "layout");

// ─── Podcast ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function savePodcastShow(input: ShowInput) {
  return toResult(async () => {
    const sc = await requireSocial(null, "admin");
    const r = await saveShow(sc.workspaceId, sc.userId, input);
    if (!r.ok) throw new Error(r.error);
    touch();
    return { id: r.id, slug: r.slug, feedUrl: r.feedUrl };
  });
}

export async function uploadPodcastCover(form: FormData) {
  return toResult(async () => {
    const sc = await requireSocial(null, "admin");
    const showId = String(form.get("showId") ?? "");
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a JPEG file.");
    const r = await uploadCover(sc.workspaceId, sc.userId, showId, new Uint8Array(await file.arrayBuffer()));
    if (!r.ok) throw new Error(r.error);
    touch();
    return true;
  });
}

export async function setPodcastShowActive(showId: string, active: boolean) {
  return toResult(async () => {
    const sc = await requireSocial(null, "admin");
    if (!(await setShowActive(sc.workspaceId, showId, active))) throw new Error("Show not found.");
    touch();
    return true;
  });
}

export async function removePodcastEpisode(episodeId: string) {
  return toResult(async () => {
    const sc = await requireSocial(null, "admin");
    if (!(await deleteEpisode(sc.workspaceId, episodeId))) throw new Error("Episode not found.");
    touch();
    return true;
  });
}

// ─── Shorts ──────────────────────────────────────────────────────────────────────────────────────────────────

export async function saveShortsRule(input: ShortRuleInput) {
  return toResult(async () => {
    const sc = await requireSocial(null, "editor");
    const r = await saveShortRule(sc.workspaceId, sc.userId, input);
    if (!r.ok) throw new Error(r.error);
    touch();
    return r.id;
  });
}

export async function removeShortsRule(id: string) {
  return toResult(async () => {
    const sc = await requireSocial(null, "editor");
    if (!(await deleteShortRule(sc.workspaceId, id))) throw new Error("Rule not found.");
    touch();
    return true;
  });
}

export async function setShortsRuleOn(id: string, active: boolean) {
  return toResult(async () => {
    const sc = await requireSocial(null, "editor");
    const r = await db
      .update(schema.shortRules)
      .set({ active, nextRunAt: null, updatedAt: new Date() })
      .where(and(eq(schema.shortRules.id, id), eq(schema.shortRules.workspaceId, sc.workspaceId)))
      .returning({ id: schema.shortRules.id });
    if (!r.length) throw new Error("Rule not found.");
    touch();
    return true;
  });
}

/** "Run now": one Short from a rule, outside its schedule. The caller pays the credits. */
export async function runShortsRuleNow(id: string) {
  return toResult(async () => {
    const sc = await requireSocial(null, "editor");
    const [rule] = await db
      .select()
      .from(schema.shortRules)
      .where(and(eq(schema.shortRules.id, id), eq(schema.shortRules.workspaceId, sc.workspaceId)))
      .limit(1);
    if (!rule) throw new Error("Rule not found.");
    if (rule.migrationHold) throw new Error("This rule was imported from Social Publishing and is on hold until the cut-over.");
    const r = await runShortRule(rule, sc.userId);
    if (!r.postId) throw new Error(r.error ?? "The Short couldn't be started.");
    touch();
    return r.postId;
  });
}

export interface MakeShortInput {
  topic: string;
  brief: string;
  providers: string[];
  reviewFirst: boolean;
  /** Admin workspace only: ground the script in this Workplace solution filter instead of the brief. */
  workplace?: { filter: string } | null;
}

export async function makeShortNow(input: MakeShortInput) {
  return toResult(async () => {
    const sc = await requireSocial(null, "editor");
    const keys = await usableKeys(input.providers, sc.workspaceId, { allowPodcast: false });
    if (!keys.length) throw new Error("Choose at least one connected channel.");
    const { postId } = await startShort({
      workspaceId: sc.workspaceId,
      userId: sc.userId,
      keys,
      source: input.workplace ? "workplace" : "seed",
      solutionFilter: input.workplace?.filter ?? "",
      seedPrompt: input.brief,
      topic: input.topic,
      reviewFirst: input.reviewFirst,
    });
    touch();
    return postId;
  });
}

// ─── Explainers ──────────────────────────────────────────────────────────────────────────────────────────────

export interface MakeExplainerInput {
  topic: string;
  brief: string;
  link?: string;
  providers: string[];
  reviewFirst: boolean;
}

export async function makeExplainerNow(input: MakeExplainerInput) {
  return toResult(async () => {
    const sc = await requireSocial(null, "editor");
    const keys = await usableKeys(input.providers, sc.workspaceId, { allowPodcast: true });
    if (!keys.length) throw new Error("Choose at least one connected channel or podcast show.");
    const link = (input.link ?? "").trim();
    if (link && !/^https?:\/\//i.test(link)) throw new Error("The link must start with http:// or https://.");
    const { postId } = await startExplainer({
      workspaceId: sc.workspaceId,
      userId: sc.userId,
      keys,
      topic: input.topic,
      seedPrompt: input.brief,
      link: link || null,
      reviewFirst: input.reviewFirst,
    });
    touch();
    return postId;
  });
}

/** Poll: recent jobs of one kind for the caller's workspace. */
export async function pollRenderJobs(kind: "explainer" | "short") {
  return toResult(async (): Promise<RenderJobView[]> => {
    const sc = await requireSocial(null, "viewer");
    return listRenderJobs(sc.workspaceId, kind);
  });
}

/** Is the caller's workspace the Phoenixtekk admin workspace (Workplace grounding + the owner's voice)? */
export async function workspaceIsAdmin() {
  return toResult(async () => {
    const sc = await requireSocial(null, "viewer");
    return isAdminWorkspace(sc.workspaceId);
  });
}
