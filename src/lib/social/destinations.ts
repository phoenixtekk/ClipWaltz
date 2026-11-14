import { getConnectionById, listConnections } from "@/lib/social/connections";
import { listProviders } from "@/lib/social/publishing";
import { emailConfigured } from "@/lib/social/publishing/providers/email";
import type { ProviderCredentials, ProviderId } from "@/lib/social/publishing/types";

// A "destination" is a single publishable target: a provider + a specific connection instance.
//
// Ported from SP `src/lib/destinations.ts`. In SP the PRIMARY instance of a provider used a bare key (the provider id)
// for backward compatibility with posts written before multi-instance support, and an env-configured Facebook Page
// could be a destination with no connection row at all. ClipWaltz has neither: every destination is a connection row
// in the post's workspace, keyed `${provider}#${connectionId}`. A bare key is still PARSED (rows copied from SP in P4
// may carry one) but it only resolves if a connection with that literal id exists in the workspace.
//
// SP also kept installation-wide default AI contexts per provider (`app_setting` `aicontext:<provider>`). Those were
// one tenant's brand voice applied to everybody, so they are not ported; the per-connection `aiContext` remains.

export interface Destination {
  key: string;
  provider: ProviderId;
  connectionId: string | null;
  label: string;
  configured: boolean;
  /** Parked by the operator — excluded from publishing. */
  paused?: boolean;
  context: string; // persistent per-network AI persona/brief
}

export const DEFAULT_LABEL: Record<string, string> = {
  facebook: "Facebook Page", facebook_group: "Facebook Group", linkedin: "LinkedIn Company Page", bluesky: "Bluesky",
  pinterest: "Pinterest", threads: "Threads", instagram: "Instagram",
  telegram: "Telegram", discord: "Discord", slack: "Slack", txtya: "TxtYa", email: "Email", x: "X (Twitter)",
  reddit: "Reddit", youtube: "YouTube", tiktok: "TikTok", mastodon: "Mastodon", medium: "Medium",
  teams: "Microsoft Teams", tumblr: "Tumblr", discourse: "Discourse", devto: "DEV (dev.to)", podcast: "Podcast",
};

export function destinationKey(provider: string, connId: string): string {
  return connId === provider ? provider : `${provider}#${connId}`;
}

export function parseKey(key: string): { provider: ProviderId; connId: string } {
  const i = key.indexOf("#");
  if (i === -1) return { provider: key as ProviderId, connId: key };
  return { provider: key.slice(0, i) as ProviderId, connId: key.slice(i + 1) };
}

/** All selectable destinations for the composer: this workspace's connection instances. */
export async function listDestinations(workspaceId: string): Promise<Destination[]> {
  const enabled = new Set(listProviders().map((p) => p.id));
  const conns = await listConnections(workspaceId);

  const out: Destination[] = [];
  for (const c of conns) {
    const provider = c.provider as ProviderId;
    if (!enabled.has(provider)) continue;
    // Email also needs server-side SES config to actually send.
    // A paused destination is never publishable, whatever its credentials say.
    const configured = c.paused
      ? false
      : provider === "email"
        ? emailConfigured() && Boolean(c.externalId)
        // A Facebook Group has no credential to hold — Meta removed the Groups API — so requiring an access token
        // here would make it permanently unselectable. The group's address is the whole connection; publishing to it
        // is a hand-off, not an API call.
        : provider === "facebook_group"
          ? Boolean(c.externalId)
          : Boolean(c.accessToken && c.externalId);
    out.push({
      key: destinationKey(provider, c.id),
      provider,
      connectionId: c.id,
      label: c.label || c.displayName || DEFAULT_LABEL[provider] || provider,
      configured,
      paused: c.paused,
      context: c.aiContext || "",
    });
  }
  return out;
}

export interface ResolvedTarget {
  /** True when this destination must not be published to (parked, disconnected, or not this workspace's). */
  paused?: boolean;
  key: string;
  provider: ProviderId;
  connectionId: string | null;
  label: string;
  credentials?: ProviderCredentials;
}

/**
 * Resolve a destination key to its provider + credentials for publishing.
 *
 * `workspaceId` is the workspace that OWNS the post being published, not whoever triggered it. Destination keys are
 * stored on the post as `provider#connectionId`, so the ownership check inside `getConnectionById` is what stops a post
 * naming somebody else's connection id and publishing to their channel.
 *
 * A key that matches no connection this workspace owns resolves PARKED with no credentials, and
 * `resolvePostTargets` drops it before it reaches a provider. (SP had to special-case env-credential fallbacks here —
 * a credential-less target could reach the installation owner's Facebook Page from another account. ClipWaltz has no
 * env-credential destinations, and `publishToTargets` additionally refuses any target without a connection.)
 */
export async function resolveTarget(key: string, workspaceId: string): Promise<ResolvedTarget> {
  const { provider, connId } = parseKey(key);
  const conn = await getConnectionById(connId, workspaceId);
  if (!conn || conn.provider !== provider) {
    return { key, provider, connectionId: null, label: DEFAULT_LABEL[provider] ?? provider, paused: true };
  }
  return {
    key,
    provider,
    connectionId: conn.id,
    label: conn.label || conn.displayName || DEFAULT_LABEL[provider] || provider,
    // A paused destination hands over no credentials, so publishing skips it rather than failing against it. This is
    // the backstop for keys already stored elsewhere — an Auto Post rule keeps its destination list, so pausing on the
    // Networks page has to hold here too.
    paused: conn.paused,
    credentials: conn.paused
      ? undefined
      : { accessToken: conn.accessToken, externalId: conn.externalId, scope: conn.scope },
  };
}
