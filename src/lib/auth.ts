import { headers } from "next/headers";
import { auth } from "./auth-server";

/** The current Better Auth session (or null). */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function getAuthUserId(): Promise<string | null> {
  const s = await getSession();
  return s?.user?.id ?? null;
}

export async function requireUserId(): Promise<string> {
  const id = await getAuthUserId();
  if (!id) throw new Error("UNAUTHENTICATED");
  return id;
}

// ---------------------------------------------------------------------------
// Onboarding pattern (optional):
// Better Auth creates the `user` row on sign-up. If your app needs a first
// tenant/workspace per user, add an idempotent helper here and call it from your
// authenticated layout. Example (from mibrow):
//
//   export async function ensureDefaultWorkspace(userId: string) {
//     const existing = await db.query.memberships.findFirst({
//       where: eq(schema.memberships.userId, userId),
//     });
//     if (existing) return;
//     const [ws] = await db.insert(schema.workspaces)
//       .values({ ownerId: userId, name: "Personal", slug: "personal" }).returning();
//     await db.insert(schema.memberships).values({ userId, workspaceId: ws.id, role: "owner" });
//   }
// ---------------------------------------------------------------------------
