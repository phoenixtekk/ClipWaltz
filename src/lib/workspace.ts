import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Get-or-create the user's personal workspace + owner membership (ADR-0004). Idempotent.
 * Called on signup (auth-server user.create hook) and by the one-time backfill for existing users.
 * Returns the workspace id.
 */
export async function ensurePersonalWorkspace(
  userId: string,
  name = "My Workspace",
): Promise<string> {
  const [existing] = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.ownerUserId, userId), eq(schema.workspaces.isPersonal, true)))
    .limit(1);
  if (existing) return existing.id;

  const id = randomUUID();
  await db.insert(schema.workspaces).values({ id, ownerUserId: userId, name, isPersonal: true });
  await db
    .insert(schema.workspaceMembers)
    .values({ id: randomUUID(), workspaceId: id, userId, role: "owner" })
    .onConflictDoNothing();
  return id;
}
