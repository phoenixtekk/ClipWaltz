import type {
  MediaInput,
  PublishProvider,
  PublishRequest,
  PublishResult,
} from "../types";
import { escapeTelegramHtml, htmlLink, linkLabel } from "../link-format";

// Telegram adapter (Bot API). No OAuth / app review — auth is a bot token
// (from @BotFather) plus the target chat id (a channel @username or numeric id).
// We store the bot token as the credential and the chat id as externalId.
//
// Docs: https://core.telegram.org/bots/api

const API = "https://api.telegram.org";
const TEXT_MAX = 4096; // Telegram message body cap
const CAPTION_MAX = 1024; // Telegram media caption cap

// Uploading ~1 MB to api.telegram.org occasionally dies mid-flight, and undici
// surfaces every one of those as the bare string "fetch failed". A single reset
// used to lose the whole post, so transport failures are retried.
//
// Retrying a POST can duplicate it if the server already acted on the request.
// That is safe enough here: Telegram only creates a message once it has the
// whole multipart body, so a connection that broke while uploading did not
// post. Attempts are capped, and API-level rejections (a bot that isn't an
// admin, a bad token) are never retried — they would fail identically forever.
// Timeouts, measured against real uploads — not against a rejected request.
//
// An earlier version used 30s, on the basis that "a healthy 1 MB upload takes
// ~1.4s". That figure was wrong: it came from posting to a non-existent chat id,
// and Telegram rejects those on the chat id *before* reading the body, so the
// measurement never uploaded anything. Probing real chats with a body Telegram
// must actually ingest gives a very different picture — 500 kB took 3s to one
// channel, 67s to another and 121s to a third, from the same host at the same
// moment. Telegram's own gateway gives up around 120s.
//
// So a 30s ceiling was severing uploads that were merely slow, and the failures
// it produced were self-inflicted. Uploads now get longer than Telegram's own
// gateway timeout, and fewer in-request attempts: with deferred retries
// scheduled after a failure (see retry-targets), the request no longer has to
// win on its own, and hanging on to a doomed publish for ten minutes helps
// nobody.
const TEXT_ATTEMPTS = 4;
const UPLOAD_ATTEMPTS = 2;
const BACKOFF_MS = [1_000, 3_000, 8_000];
const TEXT_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 150_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Turn undici's opaque transport errors into something an operator can act on. */
function transportMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: { code?: string } })?.cause?.code;
  if (raw.includes("timed out") || raw.includes("aborted") || cause === "UND_ERR_HEADERS_TIMEOUT") {
    return "Telegram did not respond in time while the image was uploading.";
  }
  if (cause === "ECONNRESET" || cause === "UND_ERR_SOCKET") {
    return "The connection to Telegram dropped while the image was uploading.";
  }
  if (cause === "ENOTFOUND" || cause === "EAI_AGAIN") {
    return "Could not resolve api.telegram.org — the server's DNS lookup failed.";
  }
  if (raw === "fetch failed") return "Could not reach Telegram — the upload failed at the network level.";
  return raw;
}

export class TelegramProvider implements PublishProvider {
  readonly id = "telegram" as const;

  isConfigured(): boolean {
    // Connection-based only (bot token + chat id stored via the Networks page).
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const cred = req.credentials?.telegram;
    const token = cred?.accessToken; // bot token (123456:ABC-...)
    const chatId = cred?.externalId; // @channelusername or numeric id
    if (!token || !chatId) {
      return this.fail("Telegram not connected — add it from the Networks page.");
    }

    const base = `${API}/bot${token}`;
    const media = req.media ?? [];

    // ── Showing the link as its domain ──────────────────────────────────────
    //
    // A tracked URL is a wall of UTM parameters in a channel. Telegram can show
    // it as "txtya.com" with the tracking intact, but only through `parse_mode`,
    // which means the post body has to be escaped.
    //
    // So HTML mode is used ONLY when there is a link to alias. A post without
    // one goes out exactly as it always has — plain text, no parse_mode, nothing
    // to escape, and no way for a stray "<" in the body to break anything.
    const linkUrl = req.link?.trim() ?? "";
    const useHtml = Boolean(linkUrl);
    const label = linkUrl ? linkLabel(linkUrl) : "";
    // What the appended link line costs the reader: a blank line plus the label.
    // Both Telegram limits are counted "after entities parsing" (Bot API), so the
    // markup itself is free and only this visible text has to be budgeted for.
    const tail = linkUrl ? 2 + [...label].length : 0;

    /**
     * The body as Telegram receives it, trimmed to `budget` VISIBLE characters.
     *
     * Trimming happens before escaping and before the anchor is attached, so a
     * cut can never land inside `&amp;` or inside a tag — which is exactly how a
     * naive truncation of already-marked-up text corrupts a message.
     */
    const compose = (budget: number): string => {
      let visible = req.text;
      const room = Math.max(0, budget - tail);
      if ([...visible].length > room) {
        visible = [...visible].slice(0, Math.max(0, room - 1)).join("") + "…";
      }
      if (!linkUrl) return visible.trim();
      return `${escapeTelegramHtml(visible.trim())}\n\n${htmlLink(linkUrl, escapeTelegramHtml)}`;
    };

    /** `parse_mode` only when there is markup to parse. */
    const mode = useHtml ? { parse_mode: "HTML" as const } : {};

    // Set once the caption-splitting message has actually been delivered, so a
    // later media failure can say the words are already in the channel instead
    // of reporting a flat "failed" for a post that is half published.
    let textAlreadySent = false;

    try {
      // No media → a plain message.
      if (media.length === 0) {
        return await this.send(base, chatId, "sendMessage", {
          chat_id: chatId,
          text: compose(TEXT_MAX),
          disable_web_page_preview: false,
          ...mode,
        });
      }

      // Caption only fits ~1024 chars; longer text goes as a separate message first.
      let caption = compose(CAPTION_MAX);
      // Compare the VISIBLE length, not the rendered HTML — the markup does not
      // count against Telegram's cap and would otherwise trigger a needless split.
      if ([...req.text].length + tail > CAPTION_MAX) {
        const pre = await this.send(base, chatId, "sendMessage", {
          chat_id: chatId,
          text: compose(TEXT_MAX),
          ...mode,
        });
        // If the words themselves could not be sent there is nothing to salvage
        // — report that rather than pressing on and failing again on the image.
        if (!pre.ok) return pre;
        textAlreadySent = true;
        caption = "";
      }

      // Single attachment → sendPhoto / sendVideo (multipart with the bytes).
      if (media.length === 1) {
        const m = media[0];
        const method = m.kind === "video" ? "sendVideo" : "sendPhoto";
        const field = m.kind === "video" ? "video" : "photo";
        return await this.sendForm(base, chatId, method, () => {
          const form = new FormData();
          form.append("chat_id", chatId);
          if (caption) {
            form.append("caption", caption);
            if (useHtml) form.append("parse_mode", "HTML");
          }
          form.append(field, this.blob(m), m.filename || `${field}.bin`);
          return form;
        });
      }

      // Multiple attachments → an album (sendMediaGroup, up to 10).
      const group = media.slice(0, 10);
      // sendMediaGroup returns an array of messages — normalize to the first.
      return await this.sendForm(base, chatId, "sendMediaGroup", () => {
        const form = new FormData();
        form.append("chat_id", chatId);
        const inputMedia = group.map((m, i) => {
          const key = `file${i}`;
          form.append(key, this.blob(m), m.filename || `${key}.bin`);
          return {
            type: m.kind === "video" ? "video" : "photo",
            media: `attach://${key}`,
            // The caption rides on the first item; so must its parse_mode —
            // sendMediaGroup takes it per-item, not as a top-level field.
            ...(i === 0 && caption ? { caption, ...mode } : {}),
          };
        });
        form.append("media", JSON.stringify(inputMedia));
        return form;
      });
    } catch (err) {
      const why = transportMessage(err);
      return this.fail(
        textAlreadySent
          ? `${why} The post text was delivered, but the image was not — re-send just the image, or delete the text message in Telegram before publishing again.`
          : why,
      );
    }
  }

  private blob(m: MediaInput): Blob {
    return new Blob([new Uint8Array(m.data)], { type: m.mime || "application/octet-stream" });
  }

  private async send(base: string, chatId: string, method: string, body: Record<string, unknown>) {
    return this.request(base, chatId, method, TEXT_TIMEOUT_MS, TEXT_ATTEMPTS, () => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  private async sendForm(base: string, chatId: string, method: string, build: () => FormData) {
    // The FormData is rebuilt per attempt: its Blob parts are one-shot streams,
    // so reusing the same object on a retry uploads an empty body.
    return this.request(base, chatId, method, UPLOAD_TIMEOUT_MS, UPLOAD_ATTEMPTS, () => ({ method: "POST", body: build() }));
  }

  /**
   * One Telegram call, retried while the failure still looks transient.
   *
   * Retries cover the two things that are worth another go — the connection
   * dying (undici's "fetch failed") and Telegram itself being busy (429/5xx).
   * A 4xx that Telegram chose to return is a decision, not a hiccup, so it is
   * returned to the caller immediately.
   */
  private async request(
    base: string,
    chatId: string,
    method: string,
    timeoutMs: number,
    attempts: number,
    init: () => RequestInit,
  ): Promise<PublishResult> {
    let lastTransport: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1] ?? 2500);

      let res: Response;
      try {
        res = await fetch(`${base}/${method}`, {
          ...init(),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastTransport = err; // connection died — worth another attempt
        continue;
      }

      // Busy or broken on Telegram's side; honour retry_after when it gives one.
      if (res.status === 429 || res.status >= 500) {
        if (attempt === attempts - 1) return this.parse(res, chatId);
        const retryAfter = await res
          .clone()
          .json()
          .then((d: { parameters?: { retry_after?: number } }) => d?.parameters?.retry_after)
          .catch(() => undefined);
        if (retryAfter) await sleep(Math.min(retryAfter, 15) * 1000);
        continue;
      }

      return this.parse(res, chatId);
    }

    throw lastTransport ?? new Error("fetch failed");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature kept from SP; callers pass the chat id
  private async parse(res: Response, chatId: string): Promise<PublishResult> {
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?:
        | { message_id?: number; chat?: { username?: string } }
        | Array<{ message_id?: number; chat?: { username?: string } }>;
    };
    if (!res.ok || !data.ok) {
      return this.fail(data.description || `Telegram returned HTTP ${res.status}.`, res.status);
    }
    const first = Array.isArray(data.result) ? data.result[0] : data.result;
    const msgId = first?.message_id;
    const username = first?.chat?.username;
    return {
      provider: this.id,
      ok: true,
      postId: msgId ? String(msgId) : undefined,
      // Public channels (@username) get a t.me permalink; private chats have none.
      url: username && msgId ? `https://t.me/${username}/${msgId}` : undefined,
      statusCode: res.status,
    };
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
