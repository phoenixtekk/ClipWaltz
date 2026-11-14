import "server-only";
import { redirect } from "next/navigation";
import { canApprove, requireSocial, SocialAccessError, type SocialContext } from "@/lib/social/access";
import type { WorkspaceRole } from "@/lib/workspace";

/**
 * The caller's Social Publishing context for a /publish page (personal workspace in P2), or null when publishing is
 * not available to them — the /publish layout shows the explanation in that case, so the page renders nothing.
 */
export async function publishPage(min: WorkspaceRole = "viewer"): Promise<(SocialContext & { approver: boolean }) | null> {
  try {
    const sc = await requireSocial(null, min);
    return { ...sc, approver: await canApprove(sc.userId, sc.workspaceId) };
  } catch (e) {
    if (e instanceof SocialAccessError) {
      if (e.status === 401) redirect("/sign-in?redirect=/publish");
      return null;
    }
    throw e;
  }
}
