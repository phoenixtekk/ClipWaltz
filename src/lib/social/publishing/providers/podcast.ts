import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { siteOrigin } from "@/lib/podcast/serve";
import type { PublishProvider, PublishRequest, PublishResult } from "../types";

// Podcast adapter — "publishing" here means adding an episode to a feed we host (ported from Social Publishing in P5,
// decision D4).
//
// Every other adapter in this directory hands bytes to somebody else's API. This one writes a row, and the feed route
// (src/app/p/[slug]/rss.xml) renders it on demand. Modelling it as a provider anyway is what lets a podcast be chosen
// in the composer, targeted by an Auto Post rule, carry its own per-network copy, and appear in history beside the
// networks.
//
// The show is the destination: a `social_connections` row (provider 'podcast') whose `externalId` is the show id,
// created by the Podcast studio (src/lib/podcast/shows.ts).

/** What the explainer pipeline passes through `providerMeta.podcast`. */
export interface PodcastExtras {
  /** Episode title. Falls back to the first line of the text. */
  title?: string;
  /** Whole seconds. Apple recommends this form for `<itunes:duration>`. */
  durationSec?: number;
  /** Per-episode artwork (a social_media id of the show's workspace). */
  imageMediaId?: string;
}

export class PodcastProvider implements PublishProvider {
  readonly id = "podcast" as const;

  isConfigured(): boolean {
    // Connection-based only: a podcast exists because a show was created.
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const showId = req.credentials?.podcast?.externalId;
    if (!showId) {
      return { provider: this.id, ok: false, error: "No podcast show is attached to this destination." };
    }

    const [show] = await db.select().from(schema.podcastShows).where(eq(schema.podcastShows.id, showId)).limit(1);
    if (!show) return { provider: this.id, ok: false, error: "That podcast show no longer exists." };

    // The episode needs audio. Video is not a substitute: a podcast client downloads the enclosure and plays it, so
    // handing it an mp4 gives listeners a file their app may refuse.
    const audio = (req.media ?? []).find((m) => m.mime.startsWith("audio/") || /\.mp3$/i.test(m.filename));
    if (!audio) {
      return {
        provider: this.id,
        ok: false,
        error:
          "A podcast episode needs an audio file. This post has no audio attached — only episodes produced by the explainer pipeline carry one.",
      };
    }

    // The audio (and artwork) must be files of the show's own workspace: the feed serves them publicly.
    const owned = async (id: string | undefined) => {
      if (!id) return false;
      const [m] = await db
        .select({ id: schema.socialMedia.id })
        .from(schema.socialMedia)
        .where(and(eq(schema.socialMedia.id, id), eq(schema.socialMedia.workspaceId, show.workspaceId)))
        .limit(1);
      return Boolean(m);
    };
    if (!(await owned(audio.id))) {
      return { provider: this.id, ok: false, error: "The episode audio belongs to a different workspace than the show." };
    }

    const extras = (req.providerMeta?.podcast ?? {}) as PodcastExtras;
    const text = req.text.trim();
    const firstLine = text.split("\n")[0]?.trim() ?? "";
    const title = (extras.title || firstLine || "Untitled episode").slice(0, 255);
    // The title is usually also the first line of the body; repeating it in the description reads as a mistake.
    const description = (text.startsWith(firstLine) ? text.slice(firstLine.length) : text).trim() || title;
    const imageMediaId = extras.imageMediaId && (await owned(extras.imageMediaId)) ? extras.imageMediaId : null;

    const id = randomUUID();
    try {
      await db.insert(schema.podcastEpisodes).values({
        id,
        showId: show.id,
        guid: `urn:uuid:${id}`, // opaque, unique, and never rewritten
        title,
        description,
        audioMediaId: audio.id,
        durationSec: Math.max(1, Math.round(extras.durationSec ?? 0)),
        imageMediaId,
        link: req.link ?? null,
        publishedAt: new Date(),
      });
    } catch (e) {
      return { provider: this.id, ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Could not add the episode." };
    }

    return {
      provider: this.id,
      ok: true,
      postId: id,
      // The feed, not the audio: it is the thing a person is given to subscribe.
      url: `${siteOrigin()}/p/${show.slug}/rss.xml`,
    };
  }
}
