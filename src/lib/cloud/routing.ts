import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isCloudProvider, type CloudProviderId } from "./types";

// Which connected storage each finished video goes to. First answer wins:
//   1. the "Save to" picked when the render was started (renders.cloud_targets)
//   2. the project's own setting (projects.cloud_targets — Video properties)
//   3. the first of the user's rules that matches the video (type / category / format)
//   4. the user's default destinations (no cloud_prefs row = connections with auto_save on)
// Every answer is a list of providers; [] means "don't save". Providers that aren't connected are dropped.

export const VIDEO_TYPES = ["music", "ad", "slideshow", "presentation", "explainer", "campaign"] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];
export const VIDEO_TYPE_LABEL: Record<VideoType, string> = {
  music: "Music video (AutoWaltz)",
  ad: "Ad",
  slideshow: "Slideshow",
  presentation: "Presentation",
  explainer: "Explainer",
  campaign: "Campaign pack variant",
};
export const RULE_FIELDS = ["type", "category", "aspect"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];
export const RULE_FIELD_LABEL: Record<RuleField, string> = { type: "Video type", category: "Category", aspect: "Format" };

export type CloudRule = { id: string; field: RuleField; values: string[]; targets: CloudProviderId[] };
export type CloudPrefs = { defaultTargets: CloudProviderId[]; rules: CloudRule[]; saved: boolean };
export type VideoFacts = { type: VideoType; category: string | null; aspect: string };
export type TargetSource = "render" | "project" | "rule" | "default";
export type Resolved = { targets: CloudProviderId[]; source: TargetSource; rule?: CloudRule };

export const cleanTargets = (v: unknown): CloudProviderId[] =>
  Array.isArray(v) ? Array.from(new Set(v.filter(isCloudProvider))) : [];

export function cleanRules(v: unknown): CloudRule[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 30).flatMap((r) => {
    const x = r as Partial<CloudRule>;
    if (!x || !RULE_FIELDS.includes(x.field as RuleField)) return [];
    const values = Array.from(new Set((Array.isArray(x.values) ? x.values : []).map((s) => String(s).trim().slice(0, 60)).filter(Boolean))).slice(0, 20);
    if (!values.length) return [];
    return [{ id: String(x.id || crypto.randomUUID()).slice(0, 40), field: x.field as RuleField, values, targets: cleanTargets(x.targets) }];
  });
}

/** The type a render counts as, from its project (kind + WaltzDeck mode) and whether it's a campaign variant. */
export function videoType(kind: string, deck: unknown, campaignId: string | null): VideoType {
  if (campaignId) return "campaign";
  if (kind !== "deck") return "music";
  const mode = (deck as { mode?: string } | null)?.mode;
  return (["ad", "slideshow", "presentation", "explainer"] as const).find((m) => m === mode) ?? "ad";
}

export async function getPrefs(userId: string): Promise<CloudPrefs> {
  const [row] = await db.select().from(schema.cloudPrefs).where(eq(schema.cloudPrefs.userId, userId));
  if (row) return { defaultTargets: cleanTargets(row.defaultTargets), rules: cleanRules(row.rules), saved: true };
  const auto = await db
    .select({ provider: schema.oauthAccounts.provider })
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.autoSave, true)));
  return { defaultTargets: cleanTargets(auto.map((a) => a.provider)), rules: [], saved: false };
}

export function ruleMatches(rule: CloudRule, v: VideoFacts): boolean {
  const have = rule.field === "type" ? v.type : rule.field === "category" ? (v.category ?? "Uncategorized") : v.aspect;
  return rule.values.some((x) => x.toLowerCase() === have.toLowerCase());
}

/** Pure resolution (shared by the server and the "where will this go" previews). */
export function resolveTargets(
  prefs: Pick<CloudPrefs, "defaultTargets" | "rules">,
  v: VideoFacts,
  connected: CloudProviderId[],
  projectTargets: unknown,
  renderTargets: unknown,
): Resolved {
  const only = (t: CloudProviderId[]) => t.filter((p) => connected.includes(p));
  if (Array.isArray(renderTargets)) return { targets: only(cleanTargets(renderTargets)), source: "render" };
  if (Array.isArray(projectTargets)) return { targets: only(cleanTargets(projectTargets)), source: "project" };
  const rule = prefs.rules.find((r) => ruleMatches(r, v));
  if (rule) return { targets: only(rule.targets), source: "rule", rule };
  return { targets: only(prefs.defaultTargets), source: "default" };
}

/** A newly connected service joins the default destinations ("connect = save there"), when the user has saved prefs. */
export async function addDefaultTarget(userId: string, p: CloudProviderId) {
  const [row] = await db.select().from(schema.cloudPrefs).where(eq(schema.cloudPrefs.userId, userId));
  if (!row) return; // no prefs yet: the default is "every connection with auto_save on", which includes it
  const cur = cleanTargets(row.defaultTargets);
  if (cur.includes(p)) return;
  await db.update(schema.cloudPrefs).set({ defaultTargets: [...cur, p], updatedAt: new Date() }).where(eq(schema.cloudPrefs.userId, userId));
}
