// Post kits — shared, client-safe types and the network catalogue. No server imports here.
import { LIMITS } from "@/lib/social/network-capabilities";

export type KitSource =
  | { kind: "render"; id: string; title: string; aspect: string | null; filename: string }
  | { kind: "export"; id: string; title: string; aspect: string | null; filename: string }
  | { kind: "design"; id: string; title: string; designKind: string; format: string }
  | { kind: "upload"; mediaIds: string[] }
  | { kind: "none" };

export interface KitItem {
  provider: string;
  /** The image size this network's pictures were made at (IMAGE_FORMATS key), or null when the kit has no images. */
  format: string | null;
  title: string;
  caption: string;
  hashtags: string[];
  /** Pre-flight notes for posting by hand (e.g. "Pinterest takes one image"). */
  notes: string[];
  postedAt: string | null;
  postedUrl: string | null;
}

export interface KitAsset {
  /** IMAGE_FORMATS key, or "original" for an uploaded file kept as it is. */
  format: string;
  index: number;
  mediaId: string;
  kind: "image" | "video";
  width: number | null;
  height: number | null;
  filename: string;
}

export interface KitNetwork {
  id: string;
  label: string;
  /** The network's own site, opened in a new tab so the person can post there. */
  site: string;
  /** Size pictures are made at for this network (worker/image/presets.mjs IMAGE_FORMATS "use" column). */
  imageFormat: string;
  takesImage: boolean;
  takesVideo: boolean;
  /** Cannot be posted without a picture or video. */
  needsMedia: boolean;
  captionMax: number | null;
  titleMax: number | null;
}

const L = (p: string) => LIMITS[p as keyof typeof LIMITS] ?? {};

// Picture sizes follow the IMAGE_FORMATS table's "use" column: 4:5 portrait feed for Instagram / Facebook, 1:1 for
// LinkedIn, 1.91:1 for X, 9:16 for TikTok, 2:3 for Pinterest; Threads and Bluesky get square.
// Pinterest's title cap (100) is the one the Pinterest adapter applies (publishing/providers/pinterest.ts).
export const KIT_NETWORKS: KitNetwork[] = [
  { id: "instagram", label: "Instagram", site: "https://www.instagram.com/", imageFormat: "4:5", takesImage: true, takesVideo: true, needsMedia: true, captionMax: L("instagram").text?.max ?? null, titleMax: null },
  { id: "tiktok", label: "TikTok", site: "https://www.tiktok.com/", imageFormat: "9:16", takesImage: true, takesVideo: true, needsMedia: true, captionMax: L("tiktok").text?.max ?? null, titleMax: null },
  { id: "youtube", label: "YouTube", site: "https://studio.youtube.com/", imageFormat: "16:9", takesImage: false, takesVideo: true, needsMedia: true, captionMax: L("youtube").text?.max ?? null, titleMax: L("youtube").title?.max ?? 100 },
  { id: "facebook", label: "Facebook", site: "https://www.facebook.com/", imageFormat: "4:5", takesImage: true, takesVideo: true, needsMedia: false, captionMax: L("facebook").text?.max ?? null, titleMax: null },
  { id: "linkedin", label: "LinkedIn", site: "https://www.linkedin.com/feed/", imageFormat: "1:1", takesImage: true, takesVideo: true, needsMedia: false, captionMax: L("linkedin").text?.max ?? null, titleMax: null },
  { id: "x", label: "X", site: "https://x.com/", imageFormat: "1.91:1", takesImage: true, takesVideo: true, needsMedia: false, captionMax: L("x").text?.max ?? null, titleMax: null },
  { id: "threads", label: "Threads", site: "https://www.threads.com/", imageFormat: "1:1", takesImage: true, takesVideo: true, needsMedia: false, captionMax: L("threads").text?.max ?? null, titleMax: null },
  { id: "pinterest", label: "Pinterest", site: "https://www.pinterest.com/", imageFormat: "2:3", takesImage: true, takesVideo: true, needsMedia: true, captionMax: L("pinterest").text?.max ?? null, titleMax: 100 },
  { id: "bluesky", label: "Bluesky", site: "https://bsky.app/", imageFormat: "1:1", takesImage: true, takesVideo: true, needsMedia: false, captionMax: L("bluesky").text?.max ?? null, titleMax: null },
];

export const kitNetwork = (id: string) => KIT_NETWORKS.find((n) => n.id === id) ?? null;

export type MediaShape = "video" | "image" | "none";

/** Which networks can carry a kit with this media at all. */
export function networksFor(shape: MediaShape): KitNetwork[] {
  return KIT_NETWORKS.filter((n) => (shape === "video" ? n.takesVideo : shape === "image" ? n.takesImage : !n.needsMedia));
}

/** Sensible starting picks for a source (the person can change them). */
export function defaultNetworks(shape: MediaShape, aspect: string | null): string[] {
  if (shape === "video") {
    if (aspect === "16:9") return ["youtube", "linkedin", "x", "facebook"];
    if (aspect === "1:1") return ["instagram", "facebook", "linkedin", "x"];
    return ["tiktok", "instagram", "youtube", "facebook"];
  }
  if (shape === "image") return ["instagram", "facebook", "linkedin", "pinterest", "threads"];
  return ["linkedin", "x", "threads", "bluesky", "facebook"];
}

export interface KitListItem {
  id: string;
  title: string;
  sourceLabel: string;
  networks: string[];
  posted: number;
  status: string;
  thumbMediaId: string | null;
  createdAt: string;
}

export interface KitView {
  id: string;
  title: string;
  brief: string;
  link: string | null;
  source: KitSource;
  /** Download URL of the kit's video (render / export / uploaded video), or null. */
  videoUrl: string | null;
  videoName: string | null;
  items: KitItem[];
  assets: KitAsset[];
  status: string;
  error: string | null;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A build that hasn't saved for this long is treated as dead (e.g. the app restarted mid-build) and can be retried. */
export const KIT_WRITING_STALE_MS = 5 * 60_000;

/** Is a build really running? A "writing" row untouched for 5 minutes is not. */
export function kitIsWriting(k: { status: string; updatedAt: string }, now = Date.now()): boolean {
  return k.status === "writing" && now - Date.parse(k.updatedAt) < KIT_WRITING_STALE_MS;
}

export interface KitStart {
  source: KitSource;
  shape: MediaShape;
  aspect: string | null;
  brief: string;
  link: string | null;
  title: string;
  allowed: string[];
  suggested: string[];
  /** Why the source could not be used (shown above the form), or null. */
  problem: string | null;
}
