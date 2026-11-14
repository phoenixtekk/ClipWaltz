import type {
  MediaInput,
  PublishProvider,
  PublishRequest,
  PublishResult,
} from "../types";
import { markdownLink } from "../link-format";
import { splitArticle } from "../title";

// Discourse adapter — creates a new topic per post via the forum's own REST API.
//
// Auth is an API key from Admin → API, sent as `Api-Key` + `Api-Username`
// headers (confirmed against docs.discourse.org's OpenAPI spec and probed
// against a live instance: a bad key answers 403 `error_type: "invalid_access"`).
// Discourse is self-hosted, so the credential blob carries the instance origin
// the same way Mastodon's does — a key means nothing without knowing the server.
//
// Like Medium and dev.to, a post here is an *article*, not a status update: the
// first line becomes the topic title and the rest becomes the markdown body.
//
// Docs: https://docs.discourse.org — POST /posts.json, POST /uploads.json

/** Discourse's `max_topic_title_length` default. */
const TITLE_MAX = 255;
/** Discourse's `min_topic_title_length` default — a shorter title is rejected. */
const TITLE_MIN = 15;
/** Discourse's `min_post_length` default. */
const BODY_MIN = 20;

interface DiscourseCreds {
  instance: string;
  key: string;
  username: string;
  uploads?: UploadLimits;
}

/**
 * What a specific forum will actually accept as an attachment.
 *
 * These are **per-instance settings, not properties of Discourse** — a forum
 * admin sets them, and the defaults are restrictive. discuss.phoenixtekk.com
 * allows images only (`jpg|jpeg|png|gif|heic|heif|webp|avif|svg|jxl`) with a
 * 10 MB cap, so an mp4 is refused twice over. Anything that decides what to
 * attach has to read this rather than assume "Discourse takes video", which is
 * true of the software and false of most installs.
 */
export interface UploadLimits {
  /** Lower-case, no dot — exactly as the forum stores them. */
  extensions: string[];
  maxBytes: number;
}

/**
 * Read a forum's upload settings. Returns null when the key is not an admin
 * key (Discourse answers 403) or the call fails — callers then fall back to
 * trying the upload and letting it fail with the forum's own message, which is
 * the behaviour that existed before this probe.
 *
 * `/site.json` does NOT carry these — verified against a live instance — so the
 * admin settings endpoint is the only source.
 */
export async function fetchUploadLimits(
  instance: string,
  key: string,
  username: string,
): Promise<UploadLimits | null> {
  const res = await fetch(`${instance}/admin/site_settings.json`, {
    headers: { "Api-Key": key, "Api-Username": username, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res?.ok) return null;

  const d = (await res.json().catch(() => null)) as
    | { site_settings?: { setting: string; value: unknown }[] }
    | null;
  const settings = d?.site_settings;
  if (!settings) return null;

  const get = (name: string) => settings.find((s) => s.setting === name)?.value;
  const raw = String(get("authorized_extensions") ?? "");
  const kb = Number(get("max_attachment_size_kb"));
  if (!raw || !Number.isFinite(kb) || kb <= 0) return null;

  return {
    extensions: raw.split("|").map((e) => e.trim().toLowerCase().replace(/^\./, "")).filter(Boolean),
    maxBytes: kb * 1024,
  };
}

/** Would this forum accept this file? Unknown limits answer `true` — try it. */
export function uploadAllowed(limits: UploadLimits | undefined, filename: string, bytes: number): boolean {
  if (!limits) return true;
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return limits.extensions.includes(ext) && bytes <= limits.maxBytes;
}

export class DiscourseProvider implements PublishProvider {
  readonly id = "discourse" as const;

  isConfigured(): boolean {
    // Connection-based only (instance + key + category stored via the Networks page).
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const cred = req.credentials?.discourse;
    const raw = cred?.accessToken;
    if (!raw) return this.fail("Discourse not connected — add it from the Networks page.");

    let c: DiscourseCreds;
    try {
      c = JSON.parse(raw);
    } catch {
      return this.fail("Discourse credentials are malformed — reconnect on the Networks page.");
    }
    if (!c.instance || !c.key || !c.username) {
      return this.fail("Discourse credentials are incomplete — reconnect on the Networks page.");
    }

    const category = Number(cred?.externalId ?? "");
    if (!Number.isFinite(category) || category <= 0) {
      return this.fail("No Discourse category stored — reconnect and choose one.");
    }

    const instance = c.instance.replace(/\/$/, "");
    const auth = { "Api-Key": c.key, "Api-Username": c.username };

    // First line is the topic title, the rest is the body — the same split as
    // Medium and dev.to.
    // An over-long first line is shortened for the title and kept in full at the
    // top of the post — a forum topic is permanent, so silently dropping the end
    // of the author's sentence is worse than anywhere else.
    const { title, body: opening } = splitArticle(req.text, TITLE_MAX, "");
    let body = opening;

    if ([...title].length < TITLE_MIN) {
      return this.fail(
        `Discourse needs a topic title of at least ${TITLE_MIN} characters, and the post's first line is only ${[...title].length}. Write the first line as a headline.`,
      );
    }

    if (req.link) body = `${body}\n\n${markdownLink(req.link)}`;

    try {
      // Attachments are uploaded to the forum rather than hot-linked. A signed
      // media URL from this app expires in an hour; a forum topic does not, so a
      // linked image would render for the first readers and then break for
      // everyone after. An upload that fails therefore fails the destination —
      // publishing the text and silently dropping the picture would leave a
      // permanent topic that is wrong, and the retry machinery can re-run this.
      for (const m of req.media ?? []) {
        const short = await this.upload(instance, auth, m);
        if (!short) {
          return this.fail(
            `Discourse rejected the upload of ${m.filename || "the attachment"}. Check that the file type is in the forum's authorized extensions and within its size limit.`,
          );
        }
        body += `\n\n![${(m.filename || "attachment").replace(/[[\]]/g, "")}](${short})`;
      }

      if (body.trim().length < BODY_MIN) {
        return this.fail(
          `Discourse needs a post body of at least ${BODY_MIN} characters (the first line is used as the title, so the body is what is left).`,
        );
      }

      const res = await fetch(`${instance}/posts.json`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ title, raw: body, category }),
        signal: AbortSignal.timeout(45_000),
      });

      const text = await res.text();
      if (!res.ok) return this.fail(this.reason(text, res.status), res.status);

      const d = JSON.parse(text) as {
        id?: number;
        topic_id?: number;
        topic_slug?: string;
        post_url?: string;
      };

      // `post_url` is a required field on Discourse's create-post response and is
      // site-relative, so it only needs the origin in front of it.
      const url = d.post_url
        ? `${instance}${d.post_url}`
        : d.topic_slug && d.topic_id
          ? `${instance}/t/${d.topic_slug}/${d.topic_id}`
          : undefined;

      return {
        provider: this.id,
        ok: true,
        postId: d.id ? String(d.id) : undefined,
        url,
        statusCode: res.status,
      };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling Discourse.");
    }
  }

  /**
   * Upload one attachment → returns its `upload://…` short url (or null).
   *
   * `synchronous=true` makes Discourse finish the upload before answering, so
   * the short url is usable in the very next request instead of arriving later
   * over the message bus.
   */
  private async upload(
    instance: string,
    auth: Record<string, string>,
    m: MediaInput,
  ): Promise<string | null> {
    const form = new FormData();
    form.append("upload_type", "composer");
    form.append("synchronous", "true");
    form.append(
      "file",
      new Blob([new Uint8Array(m.data)], { type: m.mime || "application/octet-stream" }),
      m.filename || "upload.bin",
    );

    const res = await fetch(`${instance}/uploads.json`, {
      method: "POST",
      headers: auth,
      body: form,
      signal: AbortSignal.timeout(120_000),
    }).catch(() => null);
    if (!res?.ok) return null;

    const d = (await res.json().catch(() => ({}))) as { short_url?: string; url?: string };
    return d.short_url ?? d.url ?? null;
  }

  /** Turn Discourse's reply into something actionable. */
  private reason(body: string, status: number): string {
    let first = "";
    try {
      const d = JSON.parse(body) as { errors?: string[]; error_type?: string };
      first = d.errors?.[0] ?? "";
    } catch {
      /* fall through to the raw text */
    }

    if (status === 403) {
      return "Discourse rejected the API key or username. Check the key in Admin → API and that the username it is scoped to still exists.";
    }
    if (status === 429) {
      // Worded to include "too many requests" so the retry classifier — a
      // whitelist — recognises this as transient and books another attempt.
      return `Discourse answered with too many requests (rate limited)${first ? `: ${first}` : "."}`;
    }
    if (status === 422) {
      // Validation: a duplicate title, a title below the minimum, a body below
      // the minimum, or a category the API user cannot post in.
      return first ? `Discourse rejected the topic: ${first}` : "Discourse rejected the topic as invalid (422).";
    }
    if (first) return `Discourse: ${first}`;
    return body ? body.slice(0, 160) : `Discourse returned HTTP ${status}.`;
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}
