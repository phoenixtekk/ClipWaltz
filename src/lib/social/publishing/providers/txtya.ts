import type { PublishProvider, PublishRequest, PublishResult } from "../types";
import { signedMediaUrl } from "@/lib/social/media";

// TxtYa adapter (incoming webhook). A group webhook URL is the only credential.
// Verified payload: POST { text } → { ok, messageId, deliveredTo }.
// TxtYa is a texting/community platform (text-first); media is shared as a link.

const TEXT_MAX = 2000;

export class TxtYaProvider implements PublishProvider {
  readonly id = "txtya" as const;

  isConfigured(): boolean {
    return false; // connection-based (webhook URL stored via Networks)
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const webhook = req.credentials?.txtya?.accessToken;
    if (!webhook) return this.fail("TxtYa not connected — add a group webhook from the Networks page.");

    let text = req.text;
    if (req.link) text += `\n${req.link}`;
    // Text platform: share any media as public links appended to the message.
    for (const m of req.media ?? []) text += `\n${signedMediaUrl(m.id)}`;
    if ([...text].length > TEXT_MAX) text = [...text].slice(0, TEXT_MAX - 1).join("") + "…";

    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        messageId?: string;
        deliveredTo?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        return this.fail(data.error || `TxtYa returned HTTP ${res.status}.`, res.status);
      }
      return { provider: this.id, ok: true, postId: data.messageId, statusCode: res.status };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling TxtYa.");
    }
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
