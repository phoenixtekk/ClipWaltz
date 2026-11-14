import { hashtagMax } from "@/lib/social/hashtags";
import { limitsFor } from "@/lib/social/network-capabilities";

// G8 checklist (pure, client-safe — the composer runs it on every keystroke). See score.ts for the calibration that
// decides whether the 0–100 estimate is shown at all.

export interface ScoreInput {
  text: string;
  link?: string | null;
  hasImage: boolean;
  hasVideo: boolean;
  providers: string[];
  /** Per network text (the composer's overrides), else `text`. */
  perNetwork?: Record<string, string>;
  /** Scheduled time, if any, and whether it matches a suggested slot (G6): personalised | general | other | none. */
  timing?: "personalised" | "general" | "other" | "none";
}

export interface ScoreReason {
  label: string;
  points: number;
  max: number;
  tip: string | null;
}

const CTA = /\b(learn more|sign up|subscribe|join|download|try|book|shop|buy|watch|read|register|get (?:it|yours|started)|comment|share|tell us|link in bio|dm us)\b/i;

function firstLine(text: string): string {
  return (text.split(/\n/).find((l) => l.trim()) ?? "").trim();
}

function hashtagCount(text: string): number {
  return [...text.matchAll(/#[\p{L}\p{N}_]+/gu)].length;
}

/** The checklist. Pure — runs in the composer, in calibration and in the self-test. */
export function scoreChecks(input: ScoreInput): { total: number; reasons: ScoreReason[] } {
  const reasons: ScoreReason[] = [];
  const hook = firstLine(input.text);
  const hookLen = [...hook].length;
  reasons.push({
    label: "Opening line",
    max: 20,
    points: hookLen === 0 ? 0 : hookLen <= 120 ? 20 : hookLen <= 200 ? 10 : 0,
    tip: hookLen === 0 ? "Start with a line that says why to read on." : hookLen > 120 ? "Shorten the first line — it is what people see before “more”." : null,
  });
  const media = input.hasVideo || input.hasImage;
  reasons.push({
    label: "Picture or video",
    max: 20,
    points: input.hasVideo ? 20 : input.hasImage ? 18 : 0,
    tip: media ? null : "Add an image or a video.",
  });
  // Fits every selected network's text limit.
  const over = input.providers.filter((p) => {
    const max = limitsFor(p).text?.max;
    const t = input.perNetwork?.[p] ?? input.text;
    return max !== undefined && [...t].length > max;
  });
  reasons.push({
    label: "Fits each network",
    max: 15,
    points: input.providers.length === 0 ? 8 : over.length === 0 ? 15 : Math.round(15 * (1 - over.length / input.providers.length)),
    tip: over.length ? `Too long for ${over.join(", ")} — give it a shorter version there.` : null,
  });
  // Hashtags within each network's count (G4 table); none needed where tags are not used.
  const tagged = input.providers.filter((p) => hashtagMax(p) > 0);
  const tagIssues = tagged.filter((p) => {
    const n = hashtagCount(input.perNetwork?.[p] ?? input.text);
    return n === 0 || n > hashtagMax(p);
  });
  reasons.push({
    label: "Hashtags",
    max: 15,
    points: tagged.length === 0 ? 15 : Math.round(15 * (1 - tagIssues.length / tagged.length)),
    tip: tagIssues.length ? `Check the hashtags for ${tagIssues.join(", ")} (none, or more than that network takes).` : null,
  });
  const cta = Boolean(input.link) || input.text.includes("?") || CTA.test(input.text);
  reasons.push({
    label: "Call to action or question",
    max: 10,
    points: cta ? 10 : 0,
    tip: cta ? null : "End with a question or tell people what to do next.",
  });
  const timing = input.timing ?? "none";
  reasons.push({
    label: "Posting time",
    max: 20,
    points: timing === "personalised" ? 20 : timing === "general" ? 12 : timing === "none" ? 10 : 6,
    tip:
      timing === "personalised" ? null
      : timing === "other" ? "Try one of the suggested times."
      : timing === "none" ? "Publishing now is fine; a suggested time may do better."
      : "This is a general-guidance slot, not one learnt from your posts.",
  });
  return { total: reasons.reduce((a, r) => a + r.points, 0), reasons };
}

/** Spearman rank correlation (average ranks for ties). Exported for the self-test. */
export function spearman(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs.slice(0, n));
  const ry = rank(ys.slice(0, n));
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

