import { isCloudProvider, type CloudProviderId } from "./types";

// Browser-safe half of cloud routing (no database imports — client components use this file).
// Server-side helpers (prefs, defaults) live in routing.ts, which re-exports everything here.

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
