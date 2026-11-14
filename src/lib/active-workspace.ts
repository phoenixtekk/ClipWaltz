import "server-only";
import { cookies } from "next/headers";
import { ensurePersonalWorkspace, getWorkspaceRole } from "@/lib/workspace";

// G15 multi-brand / agency workspaces (plan §6 G15). The workspace a signed-in user is working in is a cookie
// (`cw_ws`) holding a workspace id. The cookie is only a PREFERENCE: every read re-checks membership on the server, and
// an id the user is not a member of (removed, deleted, tampered) silently falls back to their personal workspace. Every
// Publish action (requireSocial), new projects, Waltz Image designs and the brand kit follow it.

export const ACTIVE_WS_COOKIE = "cw_ws";

/** The caller's active workspace id — membership-checked — or their personal workspace. */
export async function activeWorkspaceId(userId: string): Promise<string> {
  let wanted: string | undefined;
  try {
    wanted = (await cookies()).get(ACTIVE_WS_COOKIE)?.value;
  } catch {
    wanted = undefined; // outside a request (scripts): personal workspace
  }
  if (wanted && /^[A-Za-z0-9-]{1,64}$/.test(wanted) && (await getWorkspaceRole(userId, wanted))) return wanted;
  return ensurePersonalWorkspace(userId);
}
