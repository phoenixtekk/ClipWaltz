import type { PublishProvider, PublishRequest, PublishResult } from "../types";

// Podcast adapter — "publishing" here means adding an episode to a feed we host.
//
// Every other adapter in this directory hands bytes to somebody else's API. This
// one writes a row, and the feed route renders it on demand. Modelling it as a
// provider anyway is what lets a podcast be chosen in the composer, targeted by
// an Auto Post rule, carry its own per-network copy, and appear in history
// beside the networks — all machinery that already exists and would otherwise
// have to be duplicated for one destination type.
//
// The show is the destination: a `social_connection` row whose `externalId` is
// the show id, the same shape Discourse uses for a category.

/** What the explainer pipeline passes through `providerMeta.podcast`. */
export interface PodcastExtras {
  /** Episode title. Falls back to the first line of the text. */
  title?: string;
  /** Whole seconds. Apple recommends this form for `<itunes:duration>`. */
  durationSec?: number;
  /** Per-episode artwork. */
  imageMediaId?: string;
}

export class PodcastProvider implements PublishProvider {
  readonly id = "podcast" as const;

  isConfigured(): boolean {
    // Connection-based only: a podcast exists because a show was created.
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    // ClipWaltz P1: podcast hosting moves in P5 (decision D4 — feed moves with `itunes:new-feed-url` + a permanent
    // 301). Until the `podcast_shows` / `podcast_episodes` tables exist here there is no feed to add an episode to,
    // so this destination fails honestly instead of pretending. SP's implementation (insert a `podcast_episode` row
    // with a `urn:uuid:` guid, audio enclosure required, title from `providerMeta.podcast.title` or the first line)
    // is the spec for P5 — see SocialPublishing `src/lib/publishing/providers/podcast.ts`.
    void req;
    return {
      provider: this.id,
      ok: false,
      error: "Podcast hosting is not available in ClipWaltz yet — it moves over with the podcast feed (P5).",
    };
  }
}
