import type { ExplainerScript } from "./script";
import type { SectionTiming } from "./voice";
import type { ProviderId } from "@/lib/social/publishing/types";
import { networkLimit } from "@/lib/social/network-limits";

// ─── Stage 5a: YouTube metadata ──────────────────────────────────────────────
//
// Every limit here was read from Google's own documentation on 2026-09-13, not
// recalled. The three that are easy to get wrong:
//
//   snippet.title       100 characters, and may not contain `<` or `>`
//   snippet.description 5000 BYTES — not characters. A UTF-8 em dash costs 3.
//   snippet.tags        500 characters TOTAL, where "commas between tag items
//                       and quotation marks around tags containing spaces all
//                       count toward this 500-character limit"
//
// That last rule is the subtle one: this channel's tags are phrases —
// "Conditional Access", "Microsoft Intune" — so nearly every tag is charged as
// if quoted. Counting naively fits roughly a third more tags than YouTube will
// accept, and the whole call is rejected rather than truncated.

/** YouTube rejects `<` and `>` in both title and description. */
function scrub(s: string): string {
  return s.replace(/[<>]/g, "").trim();
}

const TITLE_MAX = 100;
const DESCRIPTION_MAX_BYTES = 5000;
const TAGS_MAX_CHARS = 500;

/** Chapter rules, from YouTube's own help page. */
const MIN_CHAPTERS = 3;
const MIN_CHAPTER_SECONDS = 10;

export function buildTitle(script: ExplainerScript): string {
  const t = scrub(script.title);
  if (t.length <= TITLE_MAX) return t;
  // Cut on a word boundary — a title sliced mid-word reads as a bug to a viewer.
  const cut = t.slice(0, TITLE_MAX - 1);
  const sp = cut.lastIndexOf(" ");
  return `${sp > TITLE_MAX * 0.6 ? cut.slice(0, sp) : cut}…`;
}

function hhmmss(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s).padStart(2, "0")}`;
}

/**
 * Chapter lines, or **null** when the video does not qualify.
 *
 * Returning null rather than a best effort is deliberate. YouTube activates
 * chapters only when every rule holds — at least three timestamps, the first at
 * 00:00, and no chapter shorter than ten seconds — and when one rule fails it
 * does not partially apply them, it ignores the lot. Emitting almost-valid
 * timestamps would leave a block of numbers in the description doing nothing,
 * which looks like a bug to a viewer and is invisible to us.
 */
export function buildChapters(timings: SectionTiming[], totalDuration: number): string | null {
  if (timings.length < MIN_CHAPTERS) return null;

  for (const [i, t] of timings.entries()) {
    const end = i === timings.length - 1 ? totalDuration : timings[i + 1].start;
    if (end - t.start < MIN_CHAPTER_SECONDS) return null;
  }

  return timings
    // The first must read exactly 0:00, whatever the audio actually starts at.
    .map((t, i) => `${hhmmss(i === 0 ? 0 : t.start)} ${scrub(t.heading)}`)
    .join("\n");
}

/**
 * What one tag costs against the 500-character budget, by YouTube's rule:
 * the tag itself, quotes if it contains a space, and the separating comma.
 */
function tagCost(tag: string, isFirst: boolean): number {
  return tag.length + (tag.includes(" ") ? 2 : 0) + (isFirst ? 0 : 1);
}

/** Tags trimmed to fit the real budget, in priority order. */
export function buildTags(script: ExplainerScript): string[] {
  const out: string[] = [];
  let used = 0;
  for (const raw of script.youtube.tags) {
    const tag = scrub(raw).replace(/,/g, " ").trim();
    if (!tag) continue;
    const cost = tagCost(tag, out.length === 0);
    if (used + cost > TAGS_MAX_CHARS) break;
    out.push(tag);
    used += cost;
  }
  return out;
}

export interface DescriptionParts {
  script: ExplainerScript;
  timings: SectionTiming[];
  durationSec: number;
  /** The tracked link, already UTM-tagged by the existing link plumbing. */
  link?: string;
}

/**
 * The description: the hook, chapters, the soft CTA, then the link.
 *
 * Built in priority order and trimmed from the BOTTOM, so if anything has to go
 * it is the tail rather than the chapters — which are structural — or the link,
 * which is the only part that earns anything.
 */
export function buildDescription(parts: DescriptionParts): string {
  const { script, timings, durationSec, link } = parts;
  const chapters = buildChapters(timings, durationSec);

  const blocks: string[] = [];
  const body = scrub(script.youtube.description || script.hook);
  if (body) blocks.push(body);
  if (chapters) blocks.push(`Chapters\n${chapters}`);

  const cta = scrub(script.cta);
  if (cta) blocks.push(cta);
  if (link) blocks.push(link);

  let out = blocks.join("\n\n");

  // The cap is in BYTES. Trim by bytes, then repair any character split in half
  // by the cut — a truncated multi-byte sequence is invalid UTF-8 and YouTube
  // rejects the request rather than cleaning it up.
  if (Buffer.byteLength(out, "utf8") > DESCRIPTION_MAX_BYTES) {
    const buf = Buffer.from(out, "utf8").subarray(0, DESCRIPTION_MAX_BYTES);
    out = new TextDecoder("utf-8", { fatal: false }).decode(buf).replace(/�+$/, "").trimEnd();
  }
  return out;
}

export interface YouTubeMetadata {
  title: string;
  description: string;
  tags: string[];
  /** 27 = "Education", the right home for a technical explainer. */
  categoryId: string;
  /** Always start private: the API forces it on unaudited projects anyway. */
  privacyStatus: "private" | "unlisted" | "public";
  chapters: string | null;
}

export function buildYouTubeMetadata(parts: DescriptionParts & { privacy?: YouTubeMetadata["privacyStatus"] }): YouTubeMetadata {
  return {
    title: buildTitle(parts.script),
    description: buildDescription(parts),
    tags: buildTags(parts.script),
    categoryId: "27",
    // Default private on purpose. Google restricts uploads from unaudited API
    // projects to private regardless, so anything else would be a promise the
    // platform overrides — and the agreed rollout is review-then-promote.
    privacyStatus: parts.privacy ?? "private",
    chapters: buildChapters(parts.timings, parts.durationSec),
  };
}

// ─── The same episode, published anywhere ────────────────────────────────────
//
// The render produces ONE mp4. Getting it onto other networks needs no new
// delivery code — `publishToTargets` already fans a post with a video
// attachment out to every selected destination, and eight providers already
// handle `kind === "video"` (bluesky, facebook, instagram, mastodon, telegram,
// threads, tiktok, youtube), with discord, slack and discourse taking it as an
// uploaded file.
//
// What does NOT generalise is the TEXT. YouTube wants a title on the first line,
// a long description and chapters; Bluesky allows 300 characters total and
// chapters would be gibberish there. So this builds per-network copy from the
// same script and hands it to the existing `perProviderText` seam.

/** Networks that take a video and are worth sending a landscape explainer to. */
export const VIDEO_NETWORKS: ProviderId[] = [
  "youtube", "facebook", "telegram", "discord", "mastodon",
  "bluesky", "threads", "instagram", "tiktok", "slack", "discourse",
  // Not a video destination — the podcast takes the episode's AUDIO — but it is
  // produced from the same script and wants copy of its own, so it belongs in
  // the same per-network pass.
  "podcast",
];

/**
 * YouTube reads the first line of the post as the title, so it gets the full
 * structured treatment. Everything else gets a short, self-contained caption.
 */
function shortCaption(script: ExplainerScript, limit: number, link?: string): string {
  const tail = link ? `\n\n${link}` : "";
  const room = limit - tail.length;

  // The hook is written to earn the first fifteen seconds, which is exactly the
  // job a social caption has. Prefer it over the description, which is written
  // for a YouTube page and reads oddly on its own.
  let body = scrub(script.hook) || scrub(script.youtube.description);
  const cta = scrub(script.cta);

  // Add the CTA only when it genuinely fits; a half-sentence sell is worse than
  // none, and on a 300-character network it would eat the hook.
  if (cta && body.length + 2 + cta.length <= room) body = `${body}\n\n${cta}`;

  if (body.length > room) {
    const cut = body.slice(0, Math.max(0, room - 1));
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    // Trim on a sentence boundary where there is one worth using, so the caption
    // ends as a thought rather than mid-clause.
    body = stop > room * 0.5 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
  }
  return `${body}${tail}`;
}

/**
 * Per-network text for one episode, for the `perProviderText` override.
 *
 * Only networks actually being published to need an entry; anything omitted
 * falls back to the post's shared text, which is the existing behaviour.
 */
export function buildPerNetworkText(
  parts: DescriptionParts & { providers: ProviderId[] },
): Partial<Record<ProviderId, string>> {
  const out: Partial<Record<ProviderId, string>> = {};

  for (const provider of parts.providers) {
    if (provider === "youtube") {
      // The provider splits on the first newline: line one becomes the title.
      out.youtube = `${buildTitle(parts.script)}\n${buildDescription(parts)}`;
      continue;
    }
    // Discourse is the other long-form destination — first line is the topic
    // title there too, and it renders markdown, so chapters are worth keeping.
    if (provider === "discourse") {
      const chapters = buildChapters(parts.timings, parts.durationSec);
      const bullets = chapters
        ? chapters.split("\n").map((l) => `- ${l}`).join("\n")
        : "";
      const body = [
        scrub(parts.script.youtube.description || parts.script.hook),
        bullets ? `**Chapters**\n\n${bullets}` : "",
        scrub(parts.script.cta),
        parts.link ?? "",
      ].filter(Boolean).join("\n\n");
      out.discourse = `${buildTitle(parts.script)}\n${body}`;
      continue;
    }
    // Show notes. Plain text, not markdown: podcast clients render descriptions
    // inconsistently and several show raw asterisks, so the chapter list is
    // written as bare lines. The title is the first line for the same reason
    // YouTube and Discourse take it that way — the provider splits on it.
    if (provider === "podcast") {
      const chapters = buildChapters(parts.timings, parts.durationSec);
      const body = [
        scrub(parts.script.youtube.description || parts.script.hook),
        chapters ? `Chapters\n\n${chapters}` : "",
        scrub(parts.script.cta),
        parts.link ?? "",
      ].filter(Boolean).join("\n\n");
      out.podcast = `${buildTitle(parts.script)}\n${body}`;
      continue;
    }
    out[provider] = shortCaption(parts.script, networkLimit(provider), parts.link);
  }
  return out;
}
