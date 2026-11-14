import type { ProviderId } from "@/lib/social/publishing/types";

/**
 * Networks that accept a native video upload.
 *
 * Attaching an mp4 to anything outside this set fails at publish, so a shared
 * clip is withheld from the rest rather than sent and rejected. GIFs are not
 * listed here: they travel as images, which every media-capable network takes.
 */
export const VIDEO_NETWORKS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  "facebook",
  "bluesky",
  "threads",
  "instagram",
  "telegram",
  "discord",
  "slack",
  "youtube",
  "tiktok",
  // Both of these do take video and were missing, so a clip was withheld from
  // them and they silently never received one: Mastodon uploads through
  // `/api/v2/media` (its provider already branches on `kind === "video"`), and
  // Discourse through `/uploads.json`.
  //
  // ⚠️ Discourse will reject an mp4 unless the instance lists it in
  // `authorized_extensions`; the provider fails that destination with a message
  // saying so rather than publishing a topic with a missing attachment.
  "mastodon",
  "discourse",
]);

export function acceptsVideo(provider: string): boolean {
  return VIDEO_NETWORKS.has(provider as ProviderId);
}

// ─── What each network will actually accept ──────────────────────────────────
//
// ONE source of truth, read by BOTH the pre-flight checks in the composer and
// the adapters that publish. That is the whole point: before this, every limit
// lived as a private constant inside one of twenty-three provider files, which
// made them invisible to the UI and let the two drift. Every value below is the
// value its adapter already enforces — nothing here is aspirational.
//
// A network absent from a field has no limit worth checking, not an unknown one.

/**
 * Telegram's documented ceiling on a bot upload. Lives here rather than in the
 * render pipeline because it is a property of the NETWORK, and both the video
 * encoder and the composer's pre-flight checks need it.
 */
export const TELEGRAM_MAX_BYTES = 50 * 1024 * 1024;

export interface NetworkLimits {
  /**
   * Post body ceiling. `urlCost` is a flat per-URL charge where one applies.
   *
   * `autoTrims` records whether OUR adapter shortens the text to fit. It is the
   * difference between a pre-flight note that says "this will be trimmed" and
   * one that says "this will be rejected", and getting it wrong means promising
   * the user a rescue that never comes. It is set from what the adapters
   * actually do, not from what would be nice.
   */
  text?: { max: number; urlCost?: number; autoTrims?: boolean };
  /** Networks that take the post's FIRST LINE as a title. */
  title?: { max: number; min?: number };
  image?: { max: number; maxBytes?: number };
  video?: { max: number; maxBytes?: number };
  /** Cannot publish without media of this kind — the adapter refuses outright. */
  requires?: "image" | "video" | "image-or-video";
}

export const LIMITS: Partial<Record<ProviderId, NetworkLimits>> = {
  // ── Adapters that TRIM to fit ────────────────────────────────────────────
  bluesky: { text: { max: 300, autoTrims: true }, image: { max: 4, maxBytes: 2_000_000 }, video: { max: 1 } },
  // Mastodon bills every URL a flat 23 characters however long it really is.
  mastodon: { text: { max: 500, urlCost: 23, autoTrims: true }, image: { max: 4 }, video: { max: 1 } },
  threads: { text: { max: 500, autoTrims: true }, image: { max: 10 }, video: { max: 1 } },
  x: { text: { max: 280, autoTrims: true } },
  discord: { text: { max: 2000, autoTrims: true }, image: { max: 10 }, video: { max: 10 } },
  txtya: { text: { max: 2000, autoTrims: true } },

  // ── Real ceilings that NO adapter trims to ───────────────────────────────
  // Over these the network refuses the post, so pre-flight must say "blocked",
  // not "will be trimmed".
  linkedin: { text: { max: 3000 } },
  slack: { text: { max: 3000 } },
  facebook: { text: { max: 63206 } },
  facebook_group: { text: { max: 63206 } },
  pinterest: { text: { max: 800 }, image: { max: 1 }, requires: "image" },
  tumblr: { text: { max: 4096 } },
  teams: { text: { max: 4000 } },
  // Telegram's 4096 is for a text-only message; a photo/video CAPTION is 1024,
  // and a bot may not upload a file over 50 MB.
  telegram: { text: { max: 4096 }, image: { max: 10 }, video: { max: 1, maxBytes: TELEGRAM_MAX_BYTES } },

  // ── First line becomes a TITLE ───────────────────────────────────────────
  devto: { title: { max: 128 } },
  medium: { title: { max: 100 } },
  reddit: { title: { max: 300 } },
  discourse: { title: { max: 255, min: 15 } },
  podcast: { title: { max: 255 } },
  youtube: { title: { max: 100 }, text: { max: 5000 }, video: { max: 1 }, requires: "video" },

  // ── Media-only ───────────────────────────────────────────────────────────
  tiktok: { text: { max: 2200 }, video: { max: 1 }, requires: "video" },
  instagram: { text: { max: 2200 }, image: { max: 10 }, video: { max: 1 }, requires: "image-or-video" },
};

/** Telegram shortens a media caption to 1024 even though a bare message gets 4096. */
export const TELEGRAM_CAPTION_MAX = 1024;

export function limitsFor(provider: string): NetworkLimits {
  return LIMITS[provider as ProviderId] ?? {};
}
