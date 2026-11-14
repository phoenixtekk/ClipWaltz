// Internal domain types for the publishing layer.
//
// App code speaks ONLY in these types. Provider-specific payload shapes
// (Graph API, LinkedIn Posts API, ...) never leak past a provider adapter.
// Adding or swapping a network means adding/editing one file under
// `providers/` — nothing else in the app changes.

export type ProviderId =
  | "facebook"
  // Meta removed the Groups API on 2026-04-22 (v19.0 changelog: "Deprecated the
  // following Groups API permissions and features: publish_to_groups,
  // groups_access_member_info, Groups API"). There is no endpoint to call and no
  // permission to apply for, so this destination is HAND-OFF only: the app
  // prepares the post and a person publishes it. See `providers/facebook-group.ts`.
  | "facebook_group"
  | "linkedin"
  | "bluesky"
  | "pinterest"
  | "threads"
  | "instagram"
  | "telegram"
  | "discord"
  | "slack"
  | "txtya"
  | "email"
  | "x"
  | "reddit"
  | "youtube"
  | "tiktok"
  | "mastodon"
  | "medium"
  | "devto"
  | "discourse"
  | "teams"
  | "tumblr"
  // Not somebody else's network: a feed this app hosts. Modelled as a provider
  // so a show is a destination like any other — see `providers/podcast.ts`.
  | "podcast";

/** A media attachment, already read into memory, handed to a provider. */
export interface MediaInput {
  /** Media id (used to build signed public URLs for networks that fetch by URL). */
  id: string;
  kind: "image" | "video";
  mime: string;
  filename: string;
  data: Buffer;
}

/** A platform-neutral post request coming from the app/UI. */
export interface PublishRequest {
  /** The post body text. Required. */
  text: string;
  /**
   * Optional link to attach. Facebook renders a link preview; LinkedIn is
   * posted as an ARTICLE share when present.
   */
  link?: string;
  /** Which providers to publish to. Defaults to all enabled providers. */
  providers?: ProviderId[];
  /** Media attachments (images / video) to include. */
  media?: MediaInput[];
  /** Per-provider OAuth credentials (from the DB connection), overriding env. */
  credentials?: Partial<Record<ProviderId, ProviderCredentials>>;
  /** Per-provider text overrides; a provider uses its own text if present. */
  perProviderText?: Partial<Record<ProviderId, string>>;
  /** Per-provider media overrides; a provider uses its own media set if present. */
  perProviderMedia?: Partial<Record<ProviderId, MediaInput[]>>;
  /**
   * An opaque per-provider bag of extras — tags, a category, a thumbnail.
   *
   * Deliberately `unknown`: the whole point of this file is that provider
   * payload shapes never leak past their adapter, so the shared type carries a
   * slot and only the adapter that owns it knows what is inside. Callers that
   * need to fill one import the adapter's own metadata type.
   */
  providerMeta?: Partial<Record<ProviderId, unknown>>;
}

/** Resolved credentials for a provider (from a stored OAuth connection). */
export interface ProviderCredentials {
  accessToken: string;
  /** Org id (LinkedIn) / page id (Facebook) / tag list (dev.to). */
  externalId?: string | null;
  /** Free-form per-connection mode, e.g. dev.to's "draft" vs published. */
  scope?: string | null;
}

/** Normalized outcome for a single destination. Never throws to the caller. */
export interface PublishResult {
  provider: ProviderId;
  /** Destination key (provider or provider#connId); set by the orchestrator. */
  key?: string;
  /** The connection instance this result is for (null = provider default/env). */
  connectionId?: string | null;
  /** Instance label at publish time. */
  label?: string | null;
  ok: boolean;
  /** Provider-native id of the created post, when ok. */
  postId?: string;
  /** Best-effort permalink to the published post, when derivable. */
  url?: string;
  /** Human-readable error, when !ok. */
  error?: string;
  /**
   * True when this destination cannot be published to by machine and the post
   * is waiting for a person. Distinct from `ok: false`, which means it was
   * attempted and failed: a hand-off is not an error, is never retried, and
   * never pauses the destination.
   */
  manual?: boolean;
  /** Where the person should go to post it, for hand-off destinations. */
  manualUrl?: string;
  /** Raw provider status code, for diagnostics. */
  statusCode?: number;
  /** New credential blob to persist for this connection (e.g. X's rotated OAuth2 refresh token). */
  updatedAccessToken?: string;
}

/** A resolved destination to publish to (provider + connection credentials). */
export interface PublishTarget {
  key: string;
  provider: ProviderId;
  connectionId: string | null;
  label: string;
  credentials?: ProviderCredentials;
  /** Per-destination text/media/link overrides (fall back to the shared values). */
  text?: string;
  media?: MediaInput[];
  /** Destination-specific link — used for per-network UTM tagging. */
  link?: string;
  /** Extras for this destination's adapter; see `PublishRequest.providerMeta`. */
  meta?: unknown;
}

/** The contract every network adapter implements. */
export interface PublishProvider {
  readonly id: ProviderId;
  /** True when this provider has the config it needs to publish. */
  isConfigured(): boolean;
  /** Publish one post. Implementations must resolve, not reject. */
  publish(req: PublishRequest): Promise<PublishResult>;
}

/** Thrown only for programmer/config errors, never for provider failures. */
export class PublishConfigError extends Error {}
