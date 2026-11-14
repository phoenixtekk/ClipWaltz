import "server-only";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { canApprove, requireSocial, SocialAccessError, type SocialContext } from "@/lib/social/access";
import type { WorkspaceRole } from "@/lib/workspace";

/**
 * The caller's Social Publishing context for a /publish page (the active workspace — G15), or null when publishing is
 * not available to them — the /publish layout shows the explanation in that case, so the page renders nothing.
 */
export async function publishPage(
  min: WorkspaceRole = "viewer",
): Promise<(SocialContext & { approver: boolean; requireApproval: boolean; workspaceName: string }) | null> {
  try {
    const sc = await requireSocial(null, min);
    const [ws] = await db
      .select({ name: schema.workspaces.name, req: schema.workspaces.socialRequireApproval })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, sc.workspaceId));
    return { ...sc, approver: await canApprove(sc.userId, sc.workspaceId), requireApproval: Boolean(ws?.req), workspaceName: ws?.name ?? "" };
  } catch (e) {
    if (e instanceof SocialAccessError) {
      if (e.status === 401) redirect("/sign-in?redirect=/publish");
      return null;
    }
    throw e;
  }
}
