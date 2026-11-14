import type {
  PublishProvider,
  PublishRequest,
  PublishResult,
} from "../types";
import { pinterestAccessToken, missingScopes } from "@/lib/social/oauth/pinterest";

// Pinterest adapter (API v5). A Pin is created on a board and REQUIRES an image
// (no text-only Pins). Media is sent as base64, so no public URL is needed.
//
// Docs: https://developers.pinterest.com/docs/api/v5/pins-create/
//
// Access tokens here are short-lived, so the stored credential is a JSON blob
// carrying the refresh token and the expiry alongside it. A refreshed blob is
// returned as `updatedAccessToken`, which `commitPublish` persists — the same
// route TikTok uses. Without that the refresh would work for one publish and be
// discarded, which looks fine until the refresh token itself rotates.
const API = "https://api.pinterest.com/v5";

export class PinterestProvider implements PublishProvider {
  readonly id = "pinterest" as const;

  isConfigured(): boolean {
    return false; // connection-based (token + board id stored in social_connection)
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const cred = req.credentials?.pinterest;
    const boardId = cred?.externalId; // stored board id
    if (!cred?.accessToken) return this.fail("Pinterest not connected — connect it on the Networks page.");
    if (!boardId) return this.fail("No Pinterest board selected — choose one on the Networks page.");

    const { token, scopes, updated } = await pinterestAccessToken(cred.accessToken);
    if (!token) {
      return this.fail("Pinterest sign-in has expired and could not be renewed — reconnect on the Networks page.");
    }

    // Preflight. When the recorded grant is already short there is no point
    // sending the Pin: Pinterest will refuse it, and the post lands "partly
    // published" with an error only an API developer can read.
    const short = missingScopes(scopes);
    if (short.length) {
      return this.fail(
        `Pinterest is connected without the permissions needed to post: missing ${short.join(", ")}. ` +
          "Reconnect it on the Networks page to grant them.",
      );
    }
    // Carried onto every return below, success or failure: a refresh that
    // happened is worth keeping even when the Pin itself then fails.
    const rotated = updated ? { updatedAccessToken: updated } : {};

    const image = (req.media ?? []).find((m) => m.kind === "image");
    if (!image) return this.fail("Pinterest needs an image — add one to the post.");

    const body = {
      board_id: boardId,
      title: (req.text || "New Pin").slice(0, 100),
      description: req.text.slice(0, 800),
      link: req.link || undefined,
      media_source: {
        source_type: "image_base64",
        content_type: image.mime,
        data: Buffer.from(image.data).toString("base64"),
      },
    };

    try {
      const res = await fetch(`${API}/pins`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (res.status !== 201 || !data.id) {
        return { ...this.fail(this.reason(data.message, res.status), res.status), ...rotated };
      }
      return {
        provider: this.id,
        ok: true,
        postId: data.id,
        url: `https://www.pinterest.com/pin/${data.id}/`,
        statusCode: res.status,
        ...rotated,
      };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling Pinterest.");
    }
  }

  /**
   * Turn Pinterest's reply into something the operator can act on.
   *
   * Its permission error is precise but unreadable — it names the missing
   * scopes inside a Python-style list and says nothing about what to do:
   *
   *   "…Please ensure your token is authorized with the correct set of scopes.
   *    Missing: ['boards:write', 'pins:read']"
   *
   * The scopes are the useful part, so they are lifted out and paired with the
   * one action that fixes it.
   */
  private reason(message: string | undefined, status: number): string {
    const raw = message || `Pinterest API returned HTTP ${status}.`;
    const m = /Missing:\s*\[([^\]]*)\]/i.exec(raw);
    if (m) {
      const names = m[1].split(",").map((x) => x.replace(/['"\s]/g, "")).filter(Boolean);
      return `Pinterest refused the post — the connection is missing ${names.join(", ")}. ` +
        "Reconnect Pinterest on the Networks page to grant the extra permissions.";
    }
    // Trial-access apps cannot create real Pins on production — any Pin they make
    // is a private sandbox entity, so Pinterest rejects the production call
    // outright. This is an app-approval gate, not a connection or scope problem:
    // reconnecting will not clear it. The one fix is upgrading the app to
    // Standard access, which only the account owner can request.
    if (/trial access/i.test(raw) && /production/i.test(raw)) {
      return "Pinterest rejected the Pin because the app is on Trial access, which cannot " +
        "create real Pins. Upgrade the app to Standard access at developers.pinterest.com/apps " +
        "(open the app, click Upgrade, submit the required video of the OAuth + posting flow). " +
        "Reconnecting will not fix this.";
    }
    return raw;
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
