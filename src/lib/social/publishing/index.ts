import type {
  MediaInput,
  ProviderId,
  PublishProvider,
  PublishRequest,
  PublishResult,
  PublishTarget,
} from "./types";
import { FacebookPageProvider } from "./providers/facebook";
import { FacebookGroupProvider } from "./providers/facebook-group";
import { DevToProvider } from "./providers/devto";
import { DiscourseProvider } from "./providers/discourse";
import { PodcastProvider } from "./providers/podcast";
import { LinkedInOrgProvider } from "./providers/linkedin";
import { BlueskyProvider } from "./providers/bluesky";
import { PinterestProvider } from "./providers/pinterest";
import { ThreadsProvider } from "./providers/threads";
import { InstagramProvider } from "./providers/instagram";
import { TelegramProvider } from "./providers/telegram";
import { DiscordProvider } from "./providers/discord";
import { SlackProvider } from "./providers/slack";
import { TxtYaProvider } from "./providers/txtya";
import { EmailProvider } from "./providers/email";
import { XProvider } from "./providers/x";
import { RedditProvider } from "./providers/reddit";
import { YouTubeProvider } from "./providers/youtube";
import { TikTokProvider } from "./providers/tiktok";
import { MastodonProvider } from "./providers/mastodon";
import { MediumProvider } from "./providers/medium";
import { TeamsProvider } from "./providers/teams";
import { TumblrProvider } from "./providers/tumblr";

// The publishing orchestrator. This is the ONE seam the app depends on.
// UI / API routes call `publish()` and `listProviders()`; they never import a
// provider adapter directly.

const ALL_PROVIDERS: Record<ProviderId, () => PublishProvider> = {
  facebook: () => new FacebookPageProvider(),
  facebook_group: () => new FacebookGroupProvider(),
  linkedin: () => new LinkedInOrgProvider(),
  devto: () => new DevToProvider(),
  discourse: () => new DiscourseProvider(),
  podcast: () => new PodcastProvider(),
  bluesky: () => new BlueskyProvider(),
  pinterest: () => new PinterestProvider(),
  threads: () => new ThreadsProvider(),
  instagram: () => new InstagramProvider(),
  telegram: () => new TelegramProvider(),
  discord: () => new DiscordProvider(),
  slack: () => new SlackProvider(),
  txtya: () => new TxtYaProvider(),
  email: () => new EmailProvider(),
  x: () => new XProvider(),
  reddit: () => new RedditProvider(),
  youtube: () => new YouTubeProvider(),
  tiktok: () => new TikTokProvider(),
  mastodon: () => new MastodonProvider(),
  medium: () => new MediumProvider(),
  teams: () => new TeamsProvider(),
  tumblr: () => new TumblrProvider(),
};

/**
 * Provider ids enabled via SOCIAL_ENABLED_PROVIDERS (defaults to all known). ClipWaltz namespaces SP's
 * `ENABLED_PROVIDERS` so it cannot collide with another feature's flag.
 */
function enabledIds(): ProviderId[] {
  const raw = (process.env.SOCIAL_ENABLED_PROVIDERS || "facebook,facebook_group,linkedin,bluesky,pinterest,threads,instagram,telegram,discord,slack,txtya,email,x,reddit,youtube,tiktok,mastodon,medium,teams,tumblr,discourse,podcast")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return (raw as ProviderId[]).filter((id) => id in ALL_PROVIDERS);
}

/** Instantiate the enabled providers. */
function providers(): PublishProvider[] {
  return enabledIds().map((id) => ALL_PROVIDERS[id]());
}

/** Lightweight status list for the UI: which providers exist and are ready. */
export function listProviders(): { id: ProviderId; configured: boolean }[] {
  return providers().map((p) => ({ id: p.id, configured: p.isConfigured() }));
}

/**
 * Publish a post to the requested providers (or all enabled ones).
 * Runs providers concurrently and always resolves with a result per provider —
 * a single provider failure never blocks the others.
 */
export async function publish(req: PublishRequest): Promise<PublishResult[]> {
  const text = req.text?.trim();
  if (!text) {
    return [];
  }

  const active = providers();
  const targetIds = req.providers?.length
    ? new Set<ProviderId>(req.providers)
    : null;

  const selected = targetIds
    ? active.filter((p) => targetIds.has(p.id))
    : active;

  // Each provider gets its own text/media override if set, else the shared values.
  return Promise.all(
    selected.map((p) =>
      p.publish({
        ...req,
        text: req.perProviderText?.[p.id]?.trim() || text,
        media: req.perProviderMedia?.[p.id] ?? req.media,
      })
    )
  );
}

/**
 * Publish to specific destination instances (one provider can appear multiple
 * times, e.g. two Facebook Pages). Each target carries its own credentials +
 * optional text/media override. Runs concurrently; always resolves per target.
 */
export async function publishToTargets(opts: {
  text: string;
  link?: string;
  media?: MediaInput[];
  targets: PublishTarget[];
}): Promise<PublishResult[]> {
  const text = opts.text?.trim();
  if (!text || opts.targets.length === 0) return [];

  const enabled = new Set(enabledIds());
  // ClipWaltz: a destination is ALWAYS a stored connection in the post's workspace. A target with no connection would
  // let an adapter fall back to server env credentials (facebook/instagram/linkedin still read FACEBOOK_PAGE_* /
  // LINKEDIN_* when no credentials are passed) — one tenant publishing through the installation's account. Refuse it.
  const refused = opts.targets.filter((t) => !t.connectionId || !t.credentials);
  const active = opts.targets.filter(
    (t) => t.connectionId && t.credentials && enabled.has(t.provider) && t.provider in ALL_PROVIDERS,
  );

  return Promise.all(
    active.map(async (t) => {
      const adapter = ALL_PROVIDERS[t.provider]();
      const result = await adapter.publish({
        text: t.text?.trim() || text,
        link: t.link ?? opts.link,
        media: t.media ?? opts.media,
        credentials: t.credentials ? ({ [t.provider]: t.credentials } as PublishRequest["credentials"]) : undefined,
        ...(t.meta !== undefined
          ? { providerMeta: { [t.provider]: t.meta } as PublishRequest["providerMeta"] }
          : {}),
      });
      // Stamp the destination identity onto the result.
      return { ...result, key: t.key, connectionId: t.connectionId, label: t.label };
    })
  ).then((results) => [
    ...results,
    ...refused.map((t) => ({
      provider: t.provider,
      key: t.key,
      connectionId: t.connectionId,
      label: t.label,
      ok: false,
      error: "This destination is not a connected channel of this workspace.",
    })),
  ]);
}
