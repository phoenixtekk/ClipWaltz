import type { PublishProvider, PublishRequest, PublishResult } from "../types";

// Facebook Group — a HAND-OFF destination, not an API one.
//
// Why there is no API call in this file:
//
//   Meta's Graph API v19.0 changelog (announced 2026-01-23):
//     "Deprecated the following Groups API permissions and features:
//      publish_to_groups, groups_access_member_info, Groups API"
//   Removed from ALL API versions on 2026-04-22.
//
// There is no successor endpoint and no permission to apply for. Every
// scheduling tool lost group publishing at the same time; the ones that still
// advertise it either drive a logged-in browser session (against Meta's
// automated-behaviour terms) or, like this, prepare the post and ask a person
// to publish it.
//
// So this provider does the honest thing: it declines to invent a result. It
// returns `manual: true`, which the pipeline records as a `handoff` destination
// rather than a failure — never retried, never a reason to pause the
// connection — and the post surfaces in the "Post by hand" queue with its text,
// its image and a link straight to the group.
//
// If Meta ever restores group publishing, this is the only file that changes.

export class FacebookGroupProvider implements PublishProvider {
  readonly id = "facebook_group" as const;

  isConfigured(): boolean {
    // Connection-based: a group is "configured" once one is added on Networks.
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const cred = req.credentials?.facebook_group;
    const groupId = (cred?.externalId || "").trim();

    if (!groupId) {
      return {
        provider: this.id,
        ok: false,
        error: "No Facebook Group is connected — add one from the Networks page.",
      };
    }

    return {
      provider: this.id,
      ok: false,
      manual: true,
      manualUrl: groupUrl(groupId),
    };
  }
}

/**
 * A group id may be numeric or a vanity slug; both address the same URL shape.
 * A full URL pasted in by the user is passed straight through.
 */
export function groupUrl(idOrUrl: string): string {
  const v = idOrUrl.trim();
  if (/^https?:\/\//i.test(v)) return v;
  return `https://www.facebook.com/groups/${encodeURIComponent(v.replace(/^\/?groups\//i, ""))}`;
}

/** Pull the group id out of whatever the user pasted. */
export function parseGroupRef(input: string): string {
  const v = input.trim();
  const m = v.match(/facebook\.com\/groups\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]);
  return v.replace(/^\/?groups\//i, "").replace(/^\/+|\/+$/g, "");
}
