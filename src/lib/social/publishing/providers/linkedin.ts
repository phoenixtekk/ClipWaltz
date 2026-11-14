import type { PublishProvider, PublishRequest, PublishResult } from "../types";

// LinkedIn Company Page adapter — posts to an organization feed via the
// versioned Posts API (part of the Community Management API product).
//
// Docs: https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
// Endpoint: POST https://api.linkedin.com/rest/posts
//   headers: Authorization: Bearer <token>
//            LinkedIn-Version: YYYYMM
//            X-Restli-Protocol-Version: 2.0.0
//   body (JSON):
//     { author: "urn:li:organization:<id>", commentary, visibility: "PUBLIC",
//       distribution: { feedDistribution: "MAIN_FEED", targetEntities: [],
//                       thirdPartyDistributionChannels: [] },
//       lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false }
// The created post URN is returned in the `x-restli-id` response header.

const POSTS_URL = "https://api.linkedin.com/rest/posts";

export class LinkedInOrgProvider implements PublishProvider {
  readonly id = "linkedin" as const;

  private readonly version = process.env.LINKEDIN_API_VERSION || "202401";

  isConfigured(): boolean {
    // Env-based config only (used by sync status). A stored OAuth connection is
    // resolved per-publish via req.credentials.
    return Boolean(process.env.LINKEDIN_ORG_ID && process.env.LINKEDIN_ACCESS_TOKEN);
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    // Prefer the stored OAuth connection; fall back to env.
    const cred = req.credentials?.linkedin;
    const orgId = cred?.externalId || process.env.LINKEDIN_ORG_ID || "";
    const token = cred?.accessToken || process.env.LINKEDIN_ACCESS_TOKEN || "";

    if (!orgId || !token) {
      return {
        provider: this.id,
        ok: false,
        error: "LinkedIn not connected — connect it from the Networks page.",
      };
    }

    // LinkedIn commentary supports plain text. When a link is present we append
    // it to the commentary so it renders as a clickable URL in the feed. (Rich
    // ARTICLE attachments require a separate content block + asset flow — see
    // ADMIN_DOCS "LinkedIn link posts" for the upgrade path.)
    const commentary = req.link ? `${req.text}\n\n${req.link}` : req.text;

    const payload = {
      author: `urn:li:organization:${orgId}`,
      commentary,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };

    try {
      const res = await fetch(POSTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "LinkedIn-Version": this.version,
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(payload),
      });

      if (res.status !== 201) {
        const detail = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        return {
          provider: this.id,
          ok: false,
          statusCode: res.status,
          error:
            detail.message ||
            `LinkedIn Posts API returned HTTP ${res.status}.`,
        };
      }

      const postUrn = res.headers.get("x-restli-id") || undefined;
      return {
        provider: this.id,
        ok: true,
        postId: postUrn,
        url: postUrn
          ? `https://www.linkedin.com/feed/update/${postUrn}`
          : undefined,
        statusCode: res.status,
      };
    } catch (err) {
      return {
        provider: this.id,
        ok: false,
        error: err instanceof Error ? err.message : "Network error calling LinkedIn.",
      };
    }
  }
}
