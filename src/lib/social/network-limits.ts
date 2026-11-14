import type { ProviderId } from "@/lib/social/publishing/types";

// Practical per-network character limits (server-side; mirrors the composer's map).
export const NETWORK_LIMITS: Record<ProviderId, number> = {
  facebook: 63206,
  facebook_group: 63206, linkedin: 3000, bluesky: 300, pinterest: 800, threads: 500,
  instagram: 2200, telegram: 4096, discord: 2000, slack: 3000, txtya: 2000,
  email: 100000, x: 280, reddit: 40000, youtube: 5000, tiktok: 2200,
  mastodon: 500, medium: 100000, devto: 100000, teams: 4000, tumblr: 4096,
  discourse: 32000,
  podcast: 4000,
};

export function networkLimit(provider: string): number {
  return NETWORK_LIMITS[provider as ProviderId] ?? 2000;
}
