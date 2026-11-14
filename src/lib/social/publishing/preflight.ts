import { limitsFor, TELEGRAM_CAPTION_MAX, type NetworkLimits } from "@/lib/social/network-capabilities";
import { composeWithLink } from "./compose";
import { splitArticle } from "./title";

// ─── Will this post actually work on this network? ───────────────────────────
//
// Answered BEFORE publishing, from the same limits and the same compose/trim
// functions the adapters use, so what the composer previews is what is sent.
//
// ─── Why three tiers and not "valid / invalid" ───────────────────────────────
//
// A block/allow switch would be the wrong instrument. Most of what goes wrong
// here is something the app can and should fix silently — trimming to 300 for
// Bluesky, re-encoding a picture 100 KB over Bluesky's blob ceiling, cutting a
// dev.to title to 128. Blocking on those would hand the user busywork the
// machine is better at. Meanwhile a genuine impossibility — YouTube with no
// video — must never be attempted, because "publish" that silently does nothing
// is worse than a refusal.
//
// So:
//   blocked  → cannot succeed. The destination is excluded from the publish.
//   adjust   → will succeed, after the app changes something. Say WHAT.
//   warn     → will succeed, but probably is not what was wanted.
//
// The `adjust` tier is the one that earns its keep: it is the difference between
// "your post was trimmed" discovered afterwards, and seeing the trimmed text
// before pressing publish.

export type Severity = "blocked" | "adjust" | "warn";

export interface Finding {
  severity: Severity;
  /** Shown verbatim in the UI. Written for the person, not the developer. */
  message: string;
}

export interface TargetPreflight {
  key: string;
  provider: string;
  label: string | null;
  /** Worst severity present, or null when everything is fine. */
  severity: Severity | null;
  findings: Finding[];
  /** Exactly the text this destination will receive. */
  resolvedText: string;
  /** How the network counts that text, and its ceiling (null = uncapped). */
  count: number | null;
  limit: number | null;
}

export interface PreflightInput {
  text: string;
  link?: string;
  media: { id: string; kind: "image" | "video"; filename: string; mime: string; size: number }[];
  targets: { key: string; provider: string; label?: string | null }[];
  /** Per-destination overrides, keyed exactly as the composer stores them. */
  perNetwork?: Record<string, { text?: string } | undefined>;
  /**
   * Media the post will HAVE by the time it publishes, but does not have yet.
   *
   * "Auto AI Image" attaches nothing in the composer — the image is rendered at
   * publish time, when the post already has its final text. Judging the post on
   * what is attached right now therefore declared Pinterest impossible on a post
   * that would have worked perfectly: the blocker fired, the confirm dialog said
   * the destination "will reject this post", and the publish path would have
   * generated and delivered the image regardless.
   *
   * So a pending generator counts as the media it is going to produce — said as
   * `adjust`, not silent, because "an image will be made for this" is worth
   * seeing before pressing publish.
   */
  pending?: { image?: boolean; video?: boolean };
}

/** Counted the way the network counts, so the number shown is the number enforced. */
function counter(l: NetworkLimits): (s: string) => number {
  const cost = l.text?.urlCost;
  if (!cost) return (s) => [...s].length;
  return (s) => [...s.replace(/https?:\/\/\S+/g, "x".repeat(cost))].length;
}

export function preflightTarget(input: PreflightInput, t: PreflightInput["targets"][number]): TargetPreflight {
  const l = limitsFor(t.provider);
  const findings: Finding[] = [];
  const text = input.perNetwork?.[t.key]?.text ?? input.text;
  const images = input.media.filter((m) => m.kind === "image");
  const videos = input.media.filter((m) => m.kind === "video");
  const willHaveImage = images.length > 0 || Boolean(input.pending?.image);
  const willHaveVideo = videos.length > 0 || Boolean(input.pending?.video);

  // ── Media the network cannot do without ──────────────────────────────────
  //
  // Judged on what the post will have AT PUBLISH, not what is attached now.
  if (l.requires === "video" && !willHaveVideo) {
    findings.push({ severity: "blocked", message: "Needs a video attached — this network cannot post text on its own." });
  } else if (l.requires === "video" && videos.length === 0) {
    findings.push({ severity: "adjust", message: "A video will be generated for this post before it is sent." });
  }

  if (l.requires === "image" && !willHaveImage) {
    findings.push({ severity: "blocked", message: "Needs an image attached." });
  } else if (l.requires === "image" && images.length === 0) {
    findings.push({ severity: "adjust", message: "An image will be generated for this post before it is sent." });
  }

  if (l.requires === "image-or-video" && !willHaveImage && !willHaveVideo) {
    findings.push({ severity: "blocked", message: "Needs an image or a video attached." });
  } else if (l.requires === "image-or-video" && input.media.length === 0) {
    findings.push({ severity: "adjust", message: "An image will be generated for this post before it is sent." });
  }

  // ── The first line as a title ────────────────────────────────────────────
  let resolvedText = text;
  let count: number | null = null;
  let limit: number | null = null;

  if (l.title) {
    const { title, truncated } = splitArticle(text, l.title.max, "New post");
    const titleLen = [...title].length;
    if (l.title.min && titleLen < l.title.min) {
      findings.push({
        severity: "blocked",
        message: `The first line becomes the title here and must be at least ${l.title.min} characters — yours is ${titleLen}. Write the first line as a headline.`,
      });
    } else if (truncated) {
      findings.push({
        severity: "adjust",
        message: `The first line becomes the title and is over ${l.title.max} characters, so it will be shortened to “${title}”. The full line is kept as the opening paragraph.`,
      });
    }
    count = titleLen;
    limit = l.title.max;
  }

  // ── Body length ──────────────────────────────────────────────────────────
  if (l.text) {
    // Telegram charges a media caption far less room than a bare message.
    const cap = t.provider === "telegram" && input.media.length > 0 ? TELEGRAM_CAPTION_MAX : l.text.max;
    const count_ = counter(l);
    resolvedText = composeWithLink(text, input.link, {
      limit: cap,
      count: count_,
      ...(l.text.urlCost ? { linkCost: () => l.text!.urlCost! } : {}),
    });
    const before = count_(input.link ? `${text.trim()}\n\n${input.link}` : text.trim());
    limit = cap;
    if (before > cap) {
      const note = l.text.urlCost ? ` It charges every link a flat ${l.text.urlCost} characters.` : "";
      findings.push(
        l.text.autoTrims
          ? {
              severity: "adjust",
              message: `Over this network's ${cap}-character limit (${before}), so the text will be trimmed to fit. Your link is kept whole.${note}`,
            }
          : {
              // Nothing shortens the text for this one, so saying "will be
              // trimmed" would promise a rescue that never arrives and the post
              // would simply be refused.
              severity: "blocked",
              message: `${before} characters, and this network's limit is ${cap}. Nothing trims it automatically here — shorten the text, or write a shorter version just for this network.${note}`,
            },
      );
      // The preview must not show a trim that will not happen.
      if (!l.text.autoTrims) resolvedText = input.link ? `${text.trim()}\n\n${input.link}` : text.trim();
    }
    // Counted on the FINAL text, so the number under the meter is the number
    // this network will actually see.
    count = count_(resolvedText);
  } else if (input.link) {
    resolvedText = `${text.trim()}\n\n${input.link}`.trim();
  }

  // ── Attachments ──────────────────────────────────────────────────────────
  if (l.image && images.length > l.image.max) {
    findings.push({
      severity: "adjust",
      message: `Takes at most ${l.image.max} image${l.image.max === 1 ? "" : "s"} — the first ${l.image.max} will be sent and the other ${images.length - l.image.max} skipped.`,
    });
  }
  if (l.image?.maxBytes) {
    const over = images.filter((m) => m.size > l.image!.maxBytes!);
    if (over.length) {
      findings.push({
        severity: "adjust",
        message: `${over.length === 1 ? `${over[0].filename} is` : `${over.length} images are`} over this network's ${mb(l.image.maxBytes)} limit and will be re-compressed to fit.`,
      });
    }
  }
  if (l.video?.maxBytes) {
    const over = videos.filter((m) => m.size > l.video!.maxBytes!);
    if (over.length) {
      // Unlike an image, a video cannot be re-encoded inside a publish — the
      // render pipeline produces a smaller variant up front or it cannot go.
      findings.push({
        severity: "blocked",
        message: `${over[0].filename} is ${mb(over[0].size)} and this network will not accept a file over ${mb(l.video.maxBytes)}.`,
      });
    }
  }
  if (videos.length > 0 && !l.video && l.requires !== "video") {
    findings.push({ severity: "warn", message: "Doesn't take video — the clip will be left off this one." });
  }

  const severity = (["blocked", "adjust", "warn"] as const).find((s) => findings.some((f) => f.severity === s)) ?? null;
  return { key: t.key, provider: t.provider, label: t.label ?? null, severity, findings, resolvedText, count, limit };
}

export function preflight(input: PreflightInput): TargetPreflight[] {
  return input.targets.map((t) => preflightTarget(input, t));
}

function mb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}
