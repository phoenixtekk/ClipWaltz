import { aiAssist, composeForNetwork } from "@/lib/social/ai";
import { limitsFor } from "@/lib/social/network-capabilities";
import { trimToLimit } from "@/lib/social/post-limits";
import { preflightTarget, type PreflightInput, type TargetPreflight } from "@/lib/social/publishing/preflight";
import { providerName } from "@/lib/social/ui-types";
import { hashtagMax, normalizeHashtags, withHashtags } from "@/lib/social/hashtags";

export { hashtagMax, normalizeHashtags, withHashtags };

// G4 hashtags & post copy on every render (plan §6 G4). One click in the composer (which every render / export /
// campaign variant / image design "Publish" button opens): for each selected network, a caption written for that
// network by the AI Box plus a hashtag set that is deduplicated, has no spaces and fits that network's count — then
// checked with the same pre-flight the composer shows, so nothing it writes is "blocked" for its text. 0 credits.
//
// Hashtag counts per network come from the plan (G4: Instagram up to 30 — Instagram's own maximum — LinkedIn 3–5, X
// 1–2); networks the plan does not name get 3. Networks that do not use hashtags get none.

export interface NetworkCopy {
  key: string;
  provider: string;
  text: string;
  hashtags: string[];
  preflight: TargetPreflight;
}

/**
 * Write a caption + hashtags for each destination. `brief` is the post text, or the video's title / description.
 * `media` is what the post will carry (for pre-flight). Throws when the AI Box is unreachable.
 */
export async function copyForNetworks(input: {
  brief: string;
  targets: { key: string; provider: string; label: string; context?: string | null }[];
  media: PreflightInput["media"];
  link?: string | null;
}): Promise<NetworkCopy[]> {
  const brief = input.brief.trim().slice(0, 4000);
  if (!brief) throw new Error("Write a line about the post (or attach a video) first.");
  const out: NetworkCopy[] = [];
  // One hashtag pool for the post, cut per network (keeps the tags consistent across networks).
  const rawTags = await aiAssist("hashtags", brief, "standard").catch(() => "");
  for (const t of input.targets) {
    const limit = limitsFor(t.provider).text?.max;
    const caption = await composeForNetwork({
      seed: brief,
      networkLabel: t.label || providerName(t.provider),
      context: t.context ?? undefined,
      // Leave room for the tags on short networks.
      limit: limit ? Math.max(80, limit - (hashtagMax(t.provider) ? Math.min(60, Math.round(limit * 0.2)) : 0)) : undefined,
    });
    const tags = normalizeHashtags(rawTags, hashtagMax(t.provider));
    const text = trimToLimit(withHashtags(caption, tags, limit), limit);
    const pf = preflightTarget(
      { text, media: input.media, link: input.link ?? undefined, targets: [t] },
      { key: t.key, provider: t.provider, label: t.label },
    );
    out.push({ key: t.key, provider: t.provider, text, hashtags: tags.filter((g) => text.includes(g)), preflight: pf });
  }
  return out;
}
