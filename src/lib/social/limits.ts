import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getEffectiveTier, type Tier } from "@/lib/tier";
import { countConnections } from "@/lib/social/connections";

// Plan limits for Social Publishing (ADR-0011, plan §4.7, approved 2026-11-14): connected channels Plus 10 / Pro 25.
// Social publishing is part of Plus/Pro (D2 retired SP's own plan), so the Free plan connects none.
// Publishing itself costs no credits.
export const CHANNEL_LIMITS: Record<Tier, number> = { free: 0, plus: 10, pro: 25 };

export class ChannelLimitError extends Error {
  constructor(
    public readonly limit: number,
    public readonly tier: Tier,
  ) {
    super(
      limit === 0
        ? "Connecting social channels needs a Plus or Pro plan."
        : `This workspace has reached its ${limit}-channel limit on the ${tier === "pro" ? "Pro" : "Plus"} plan. Disconnect a channel or upgrade.`,
    );
  }
}

/**
 * The tier that governs a workspace: its OWNER's effective tier (src/lib/tier.ts — subscription or comp grant, else
 * `user.plan`). Members inherit the workspace's allowance; their own plans do not stack.
 */
export async function workspaceTier(workspaceId: string): Promise<Tier> {
  const [ws] = await db
    .select({ ownerUserId: schema.workspaces.ownerUserId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  if (!ws) return "free";
  return getEffectiveTier(ws.ownerUserId);
}

export async function channelAllowance(workspaceId: string): Promise<{ tier: Tier; limit: number; used: number }> {
  const [tier, used] = await Promise.all([workspaceTier(workspaceId), countConnections(workspaceId)]);
  return { tier, limit: CHANNEL_LIMITS[tier], used };
}

/** Throws ChannelLimitError unless `adding` more channels fit in the workspace's plan. */
export async function assertChannelCapacity(workspaceId: string, adding = 1): Promise<void> {
  const { tier, limit, used } = await channelAllowance(workspaceId);
  if (used + adding > limit) throw new ChannelLimitError(limit, tier);
}
