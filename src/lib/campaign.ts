// WaltzDeck campaign helpers shared by the server and the editor (phase 4).
import { MIN_VIEWS_FOR_WINNER, type CampaignVariant } from "./deck/types";

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "pack";

/**
 * The CTA link with UTM tags, so the owner's analytics show which variant sent each visitor:
 * utm_source=clipwaltz · utm_medium=video · utm_campaign=<pack name> · utm_content=<variant, e.g. b2-15s-9x16>.
 * Existing utm_* parameters on the owner's link are replaced; anything else is kept. Null for a non-http(s) link.
 */
export function utmUrl(ctaUrl: string | null | undefined, campaignName: string, v: { code: string; lengthSec: number; aspect: string }): string | null {
  if (!ctaUrl) return null;
  let u: URL;
  try { u = new URL(ctaUrl); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.searchParams.set("utm_source", "clipwaltz");
  u.searchParams.set("utm_medium", "video");
  u.searchParams.set("utm_campaign", slug(campaignName));
  u.searchParams.set("utm_content", `${v.code}-${Math.round(v.lengthSec)}s-${v.aspect.replace(":", "x")}`.toLowerCase());
  return u.toString();
}

/** http(s) link for the CTA button: the brief's URL, else a web address written in the CTA text. */
export function ctaLink(url: string | null | undefined, text: string | null | undefined): string | null {
  const pick = (url ?? "").trim() || (/\b((?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/\S*)?)/i.exec(text ?? "")?.[1] ?? "");
  if (!pick) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(pick) ? pick : `https://${pick}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export const rate = (n: number, d: number) => (d > 0 ? n / d : 0);

/**
 * The winner: best click rate (clicks ÷ views), ties broken by completion rate — only among finished variants with
 * at least MIN_VIEWS_FOR_WINNER views, and only when two or more qualify (one variant alone proves nothing).
 */
export function pickWinner(variants: CampaignVariant[]): string | null {
  const ok = variants.filter((v) => v.status === "done" && v.stats.views >= MIN_VIEWS_FOR_WINNER);
  if (ok.length < 2) return null;
  const score = (v: CampaignVariant) => [rate(v.stats.clicks, v.stats.views), rate(v.stats.completes, v.stats.plays)];
  const best = [...ok].sort((a, b) => { const [ca, pa] = score(a), [cb, pb] = score(b); return cb - ca || pb - pa; });
  const [top, next] = best;
  const [t1, t2] = score(top), [n1, n2] = score(next);
  return t1 === n1 && t2 === n2 ? null : top.renderId; // a dead heat has no winner
}
