// Shapes the /publish screens pass from server components to client components. Pure types + helpers: safe to import
// from client code (no db, no session, no secrets). Credentials never appear in any of these.

export type PostStatus =
  | "draft" | "queued" | "scheduled" | "publishing" | "published" | "failed" | "partial" | "handoff" | "rendering";

export interface DestinationView {
  key: string; // provider#connectionId
  provider: string;
  label: string;
  configured: boolean;
  paused: boolean;
}

export interface MediaView {
  id: string;
  kind: "image" | "video";
  filename: string;
  mime: string;
  size: number;
  /** Signed preview URL (images only), or null. */
  previewUrl: string | null;
}

export interface TargetView {
  id: string;
  provider: string;
  label: string | null;
  status: string;
  url: string | null;
  error: string | null;
  metrics: { likes: number | null; comments: number | null; shares: number | null; views: number | null } | null;
}

export interface PostView {
  id: string;
  text: string;
  link: string | null;
  status: string;
  approvalStatus: string;
  favorite: boolean;
  shareToken: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  destinations: { key: string; provider: string; label: string }[];
  perNetwork: Record<string, { text?: string }> | null;
  media: MediaView[];
  targets: TargetView[];
  warnings: string[];
  renderId: string | null;
  exportId: string | null;
}

/** A ClipWaltz video to attach to a new post (Publish button on a render / export / campaign variant). */
export interface VideoAttachment {
  source: "render" | "export";
  id: string;
  filename: string;
  mime: string;
  size: number;
  aspect: string | null;
  projectTitle: string;
}

export interface ComposePrefill {
  text: string;
  link: string | null;
  video: VideoAttachment | null;
  /** Images attached up front (Waltz Image "Publish": the design's composited outputs, already stored for this post). */
  media?: MediaView[];
  /** Destination keys suggested for the video's aspect ratio. */
  suggested: string[];
  /** A note shown above the composer (e.g. why the networks were picked). */
  note: string | null;
}

export interface ChannelAllowance {
  tier: "free" | "plus" | "pro";
  limit: number;
  used: number;
}

/** Networks that suit a video's shape (plan §4.4): 9:16 → TikTok / Reels / Shorts, 16:9 → YouTube / LinkedIn / X. */
export function providersForAspect(aspect: string | null | undefined): string[] {
  if (aspect === "9:16" || aspect === "4:5") return ["tiktok", "instagram", "youtube"];
  if (aspect === "16:9") return ["youtube", "linkedin", "x"];
  if (aspect === "1:1") return ["instagram", "facebook", "linkedin", "x"];
  return [];
}

/** "1080x1920" → "9:16" (exports record a resolution, not always an aspect). */
export function aspectFromResolution(res: string | null | undefined): string | null {
  const m = res?.match(/^(\d+)x(\d+)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return null;
  const r = w / h;
  if (Math.abs(r - 9 / 16) < 0.02) return "9:16";
  if (Math.abs(r - 16 / 9) < 0.02) return "16:9";
  if (Math.abs(r - 1) < 0.02) return "1:1";
  if (Math.abs(r - 4 / 5) < 0.02) return "4:5";
  return null;
}

export const PROVIDER_LABEL: Record<string, string> = {
  facebook: "Facebook", facebook_group: "Facebook Group", linkedin: "LinkedIn", bluesky: "Bluesky", pinterest: "Pinterest",
  threads: "Threads", instagram: "Instagram", telegram: "Telegram", discord: "Discord", slack: "Slack", txtya: "TxtYa",
  email: "Email", x: "X", reddit: "Reddit", youtube: "YouTube", tiktok: "TikTok", mastodon: "Mastodon", medium: "Medium",
  devto: "DEV", discourse: "Discourse", teams: "Teams", tumblr: "Tumblr", podcast: "Podcast",
};

export const providerName = (p: string) => PROVIDER_LABEL[p] ?? p;

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", queued: "In queue", scheduled: "Scheduled", publishing: "Publishing", published: "Published",
  failed: "Failed", partial: "Partly published", handoff: "Waiting for you", rendering: "Rendering",
};
