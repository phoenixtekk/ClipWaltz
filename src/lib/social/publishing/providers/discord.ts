import type {
  MediaInput,
  PublishProvider,
  PublishRequest,
  PublishResult,
} from "../types";
import { markdownLink } from "../link-format";

// Discord adapter (Incoming Webhook). No OAuth / app review — a channel webhook
// URL (Channel → Integrations → Webhooks) is the only credential. We store the
// full webhook URL as the credential and the webhook id as externalId.
//
// Docs: https://discord.com/developers/docs/resources/webhook#execute-webhook

const CONTENT_MAX = 2000; // Discord message content cap
const MAX_FILES = 10;

export class DiscordProvider implements PublishProvider {
  readonly id = "discord" as const;

  isConfigured(): boolean {
    // Connection-based only (webhook URL stored via the Networks page).
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const webhook = req.credentials?.discord?.accessToken; // full webhook URL
    if (!webhook) {
      return this.fail("Discord not connected — add a channel webhook from the Networks page.");
    }

    // Discord renders markdown in webhook content, so the URL can be aliased.
    let content = req.link ? `${req.text}\n${markdownLink(req.link)}`.trim() : req.text;
    if ([...content].length > CONTENT_MAX) content = [...content].slice(0, CONTENT_MAX - 1).join("") + "…";

    // ?wait=true makes Discord return the created message (so we get its id).
    const url = webhook + (webhook.includes("?") ? "&" : "?") + "wait=true";
    const media = (req.media ?? []).slice(0, MAX_FILES);

    try {
      let res = await this.send(url, content, media);

      // A webhook attached to a forum or media channel cannot post a bare
      // message — every post there *is* a thread, so Discord demands a name for
      // it. Nothing in the webhook URL says which kind of channel it points at,
      // so rather than ask the operator to know, take Discord's word for it and
      // repeat the post as a named thread.
      if (!res.ok && (await this.needsThreadName(res))) {
        res = await this.send(url, content, media, this.threadName(req.text));
      }

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return this.fail(this.reason(t) || `Discord returned HTTP ${res.status}.`, res.status);
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return { provider: this.id, ok: true, postId: data.id, statusCode: res.status };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling Discord.");
    }
  }

  private async send(url: string, content: string, media: MediaInput[], threadName?: string): Promise<Response> {
    const payload: Record<string, unknown> = { content };
    if (threadName) payload.thread_name = threadName;

    if (media.length === 0) {
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    // Multipart: payload_json + files[n]. Discord renders images/video inline.
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    media.forEach((m, i) => {
      form.append(
        `files[${i}]`,
        new Blob([new Uint8Array(m.data)], { type: m.mime || "application/octet-stream" }),
        m.filename || `file${i}.bin`
      );
    });
    return fetch(url, { method: "POST", body: form });
  }

  /** Did Discord reject this because the channel is a forum? Reads a clone, so the caller can still read the body. */
  private async needsThreadName(res: Response): Promise<boolean> {
    const body = await res.clone().text().catch(() => "");
    return /thread_name|thread_id/i.test(body) && /forum|media/i.test(body);
  }

  /** Discord caps thread names at 100 characters. Use the post's opening line. */
  private threadName(text: string): string {
    const first = (text || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "New post";
    return first.length > 100 ? first.slice(0, 99).trimEnd() + "…" : first;
  }

  private reason(body: string): string | null {
    try {
      const d = JSON.parse(body) as { message?: string };
      return d.message ?? null;
    } catch {
      return body ? body.slice(0, 160) : null;
    }
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
