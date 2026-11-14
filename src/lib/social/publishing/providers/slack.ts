import type {
  MediaInput,
  PublishProvider,
  PublishRequest,
  PublishResult,
} from "../types";
import { slackLink } from "../link-format";

// Slack adapter (Bot token). Auth is a bot user OAuth token (xoxb-…) from a
// Slack app with chat:write + files:write scopes, plus the target channel id.
// We store the bot token as the credential and the channel id as externalId.
// (The bot must be invited to the channel: /invite @YourApp.)
//
// Docs: https://api.slack.com/methods/chat.postMessage
//       https://api.slack.com/methods/files.completeUploadExternal

const API = "https://slack.com/api";

export class SlackProvider implements PublishProvider {
  readonly id = "slack" as const;

  isConfigured(): boolean {
    // Connection-based only (bot token + channel stored via the Networks page).
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const cred = req.credentials?.slack;
    const token = cred?.accessToken; // xoxb-…
    const channel = cred?.externalId; // channel id (C0…)
    if (!token || !channel) {
      return this.fail("Slack not connected — add it from the Networks page.");
    }

    // Slack renders `<url|label>`, so a tracked link shows as its domain.
    const text = req.link ? `${req.text}\n${slackLink(req.link)}`.trim() : req.text;
    const media = req.media ?? [];

    try {
      // With media: upload each file, then post them into the channel with the
      // text as the message (initial_comment). Otherwise a plain chat message.
      if (media.length > 0) {
        const uploaded: { id: string; title: string }[] = [];
        for (const m of media) {
          const up = await this.uploadFile(token, m);
          if (!up.id) return this.fail(up.error || "Slack file upload failed.");
          uploaded.push({ id: up.id, title: m.filename || "attachment" });
        }
        const res = await this.post(token, "files.completeUploadExternal", {
          files: uploaded,
          channel_id: channel,
          initial_comment: text,
        });
        if (!res.ok) return this.fail(this.slackError(res.error), 200);
        const perma = (res.files as { permalink?: string }[] | undefined)?.[0]?.permalink;
        return { provider: this.id, ok: true, postId: uploaded[0]?.id, url: perma, statusCode: 200 };
      }

      const res = await this.post(token, "chat.postMessage", { channel, text });
      if (!res.ok) return this.fail(this.slackError(res.error), 200);
      const ts = res.ts as string | undefined;
      let url: string | undefined;
      if (ts) {
        const link = await this.post(token, "chat.getPermalink", { channel, message_ts: ts });
        if (link.ok) url = link.permalink as string | undefined;
      }
      return { provider: this.id, ok: true, postId: ts, url, statusCode: 200 };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling Slack.");
    }
  }

  // 3-step external upload: reserve a URL, POST the bytes, return the file id.
  private async uploadFile(token: string, m: MediaInput): Promise<{ id?: string; error?: string }> {
    const length = m.data.byteLength;
    const reserve = await fetch(
      `${API}/files.getUploadURLExternal?filename=${encodeURIComponent(m.filename || "file")}&length=${length}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const rj = (await reserve.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      upload_url?: string;
      file_id?: string;
    };
    if (!rj.ok || !rj.upload_url || !rj.file_id) {
      // Surface the real reason (e.g. missing_scope needs files:write).
      return { error: this.slackError(rj.error) };
    }

    const up = await fetch(rj.upload_url, {
      method: "POST",
      headers: { "Content-Type": m.mime || "application/octet-stream" },
      body: new Uint8Array(m.data),
    });
    if (!up.ok) return { error: `Slack upload host returned HTTP ${up.status}.` };
    return { id: rj.file_id };
  }

  private async post(token: string, method: string, body: Record<string, unknown>) {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({ ok: false }))) as Record<string, unknown> & {
      ok: boolean;
      error?: string;
    };
  }

  private slackError(code?: string): string {
    const map: Record<string, string> = {
      not_in_channel: "The bot isn't in that channel — run /invite @YourApp in Slack.",
      channel_not_found: "Channel not found — check the channel id.",
      invalid_auth: "Slack token is invalid or revoked — reconnect.",
      missing_scope:
        "The Slack app is missing the files:write scope (needed to post images/video). Add it under OAuth & Permissions → Bot Token Scopes, reinstall the app, then reconnect with the new token.",
    };
    return (code && map[code]) || `Slack error: ${code || "unknown"}.`;
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
