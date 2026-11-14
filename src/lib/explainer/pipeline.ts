import { generateScript, type ExplainerScript } from "./script";
import { varyTemplates } from "./variety";
import { narrateScript, type SectionTiming, type WordTiming } from "./voice";
import {
  assembleEpisode, extractPodcastAudio, makeCompactVariant, makeVerticalVariant,
  TELEGRAM_MAX_BYTES, VERTICAL_NETWORKS,
} from "./assemble";
import { renderThumbnail } from "./thumbnail";
import { buildPerNetworkText, buildYouTubeMetadata } from "./metadata";
import type { ProviderId } from "@/lib/social/publishing/types";

// ─── The explainer pipeline, as a resumable state machine ────────────────────
//
//   scripting → voicing → assembling → meta → ready
//
// An episode is minutes of work and the stages are not equally replaceable.
// Re-running `scripting` costs ~2 minutes of the AI Box. Re-running `voicing`
// costs ElevenLabs CHARACTERS — real money against a 131,000/period allowance,
// for audio that already exists. So each stage writes its output into the job's
// payload and a resumed job skips whatever is already there.
//
// This module is deliberately free of database calls: it takes a payload, does
// the next thing, and hands back a new payload. The render queue owns
// persistence, which keeps the expensive logic testable without a database and
// keeps the queue's transaction boundaries its own business.

export type Stage = "scripting" | "voicing" | "assembling" | "meta" | "ready";

/** Everything the pipeline has produced so far. Serialised onto `render_job.payload`. */
export interface EpisodePayload {
  stage: Stage;
  seedPrompt: string;
  topic: string;
  link?: string;
  providers: ProviderId[];
  /**
   * The rule's review setting, carried here because the decision is made when
   * the rule fires but acted on minutes later, when the episode finishes.
   */
  reviewFirst?: boolean;
  /**
   * ClipWaltz: which voice narrates — "owner" (ELEVENLABS_VOICE_ID, the owner's clone: site-admin workspaces only) or
   * "stock" (ELEVENLABS_DEFAULT_VOICE_ID). Set when the job is created, resolved to an id on the render worker.
   */
  voice?: "owner" | "stock";

  script?: ExplainerScript;
  /**
   * Media ids of the per-section narration MP3s, in order.
   *
   * Same reasoning as the video: a full narration is several megabytes, and it
   * has to survive a crash between `voicing` and `assembling` — re-recording it
   * would re-spend ElevenLabs characters on audio that already exists.
   */
  narrationMediaIds?: string[];
  timings?: SectionTiming[];
  words?: WordTiming[];
  durationSec?: number;

  /**
   * Media ids, never bytes.
   *
   * The first version of this carried base64 video in the payload and the row
   * measured **46.5 MB** for a two-minute episode. That is a jsonb column the
   * render queue polls: every read and write would move the whole video, and
   * base64 defeats TOAST compression. Bytes go to media storage the moment they
   * exist and only the id comes back here.
   */
  videoMediaId?: string;
  compactMediaId?: string;
  thumbnailMediaId?: string;
  /**
   * The episode as audio, for the podcast feed. Extracted from the master in
   * the same stage that produces it, so the two can never drift apart.
   */
  audioMediaId?: string;
  /** The 9:16 cut, produced only when a vertical-first network is targeted. */
  verticalMediaId?: string;

  perNetworkText?: Partial<Record<ProviderId, string>>;
  youtube?: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
    privacyStatus: "private" | "unlisted" | "public";
  };

  /** Non-fatal notes, surfaced on the post the same way publish warnings are. */
  warnings?: string[];
}

export interface StepResult {
  payload: EpisodePayload;
  /** True when the pipeline has nothing left to do. */
  done: boolean;
  /**
   * Bytes this stage produced, for the caller to write to media storage.
   *
   * Handed out rather than stored here so this module stays free of database
   * and storage calls — it takes a payload, does the next thing, and returns
   * what it made. The caller persists, then records the ids on the payload.
   */
  artifacts?: {
    narration?: Buffer[];
    video?: Buffer;
    compactVideo?: Buffer;
    thumbnail?: Buffer;
    audio?: Buffer;
    verticalVideo?: Buffer;
  };
}

/**
 * Loads a stored artefact back. The caller supplies it because only the caller
 * knows about media storage; this keeps the pipeline itself dependency-free.
 */
export type LoadMedia = (mediaId: string) => Promise<Buffer>;

/**
 * Run exactly ONE stage and return the updated payload.
 *
 * One stage per call on purpose: the sweep that drives this has a time budget
 * and other work to do, and a five-minute assembly must not monopolise it. The
 * queue calls this repeatedly across sweeps, persisting between each.
 *
 * Throws only for genuinely unrecoverable problems. Anything the next attempt
 * could fix is returned as an error for the queue to record and retry.
 */
export async function runStage(
  payload: EpisodePayload,
  load: LoadMedia,
  opts: { voiceId?: string } = {},
): Promise<StepResult> {
  switch (payload.stage) {
    case "scripting": {
      const r = await generateScript({
        seedPrompt: payload.seedPrompt,
        topic: payload.topic,
      });
      if ("error" in r) throw new Error(`scripting: ${r.error}`);

      const warnings = [...(payload.warnings ?? [])];
      if (r.underTarget) {
        warnings.push(
          `The script came back short (${r.words} spoken words) after ${r.attempts} attempts; the fullest was used.`,
        );
      }
      // Re-assign the visual templates for variety before anything downstream
      // sees the script. Done here so the payload records what will actually be
      // drawn: a resumed job renders the same episode, and the choice is visible
      // on the row rather than being re-derived at render time.
      const script = varyTemplates(r.script, payload.topic);

      return { payload: { ...payload, stage: "voicing", script, warnings }, done: false };
    }

    case "voicing": {
      if (!payload.script) throw new Error("voicing: no script in the payload.");
      const r = await narrateScript(payload.script.sections, { voiceId: opts.voiceId });
      if ("error" in r) throw new Error(`voicing: ${r.error}`);

      return {
        payload: {
          ...payload,
          stage: "assembling",
          timings: r.narration.sections,
          words: r.narration.words,
          durationSec: r.narration.durationSec,
        },
        // The caller stores these and writes the ids back onto the payload.
        artifacts: { narration: r.parts },
        done: false,
      };
    }

    case "assembling": {
      if (!payload.script || !payload.narrationMediaIds?.length || !payload.timings || !payload.words) {
        throw new Error("assembling: the payload is missing narration output.");
      }
      const parts = await Promise.all(payload.narrationMediaIds.map(load));
      const master = await assembleEpisode({
        script: payload.script,
        narrationParts: parts,
        timings: payload.timings,
        words: payload.words,
        durationSec: payload.durationSec ?? 0,
      });

      const warnings = [...(payload.warnings ?? [])];
      const next: EpisodePayload = { ...payload, stage: "meta" };
      const artifacts: NonNullable<StepResult["artifacts"]> = {
        video: master.video,
        // Cheap next to the assembly that just ran (a copy of one stream, no
        // re-render), and taking it here guarantees the podcast audio matches
        // the video exactly.
        audio: await extractPodcastAudio(master.video),
      };

      // Only cut a vertical when something actually wants one — it is a full
      // re-encode, and most runs target neither TikTok nor Instagram.
      if (payload.providers.some((p) => VERTICAL_NETWORKS.has(p))) {
        artifacts.verticalVideo = (await makeVerticalVariant(master.video)).video;
      }

      // Only spend a transcode when the master would actually be refused. Most
      // short episodes fit, and an unnecessary second encode is 80 seconds of
      // CPU for nothing.
      if (master.video.length > TELEGRAM_MAX_BYTES) {
        const compact = await makeCompactVariant(master.video, master.durationSec);
        artifacts.compactVideo = compact.video;
        if (!compact.withinBudget) {
          warnings.push(
            `Even at the floor bitrate this episode is ${(compact.bytes / 1e6).toFixed(0)} MB, over the 50 MB ` +
              "limit some networks enforce. Those destinations will need a link instead of the file.",
          );
        }
      }
      next.warnings = warnings;
      return { payload: next, artifacts, done: false };
    }

    case "meta": {
      if (!payload.script || !payload.timings) throw new Error("meta: no script or timings.");
      const parts = {
        script: payload.script,
        timings: payload.timings,
        durationSec: payload.durationSec ?? 0,
        link: payload.link,
      };
      const yt = buildYouTubeMetadata(parts);

      return {
        payload: {
          ...payload,
          stage: "ready",
          perNetworkText: buildPerNetworkText({ ...parts, providers: payload.providers }),
          youtube: {
            title: yt.title,
            description: yt.description,
            tags: yt.tags,
            categoryId: yt.categoryId,
            privacyStatus: yt.privacyStatus,
          },
        },
        artifacts: { thumbnail: renderThumbnail(payload.script) },
        done: false,
      };
    }

    case "ready":
      return { payload, done: true };

    default:
      throw new Error(`Unknown explainer stage: ${String(payload.stage)}`);
  }
}

/** A fresh payload for a rule's slot. */
export function startPayload(input: {
  seedPrompt: string;
  topic: string;
  providers: ProviderId[];
  link?: string;
  reviewFirst?: boolean;
  voice?: "owner" | "stock";
}): EpisodePayload {
  return { stage: "scripting", ...input };
}

/** Human-readable progress for the polling UI. */
export const STAGE_LABEL: Record<Stage, string> = {
  scripting: "Writing the script",
  voicing: "Recording the narration",
  assembling: "Rendering the video",
  meta: "Building the thumbnail and description",
  ready: "Ready to publish",
};
