import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAuthUserId } from "@/lib/auth";
import { activeWorkspaceId } from "@/lib/active-workspace";
import { listApiKeys, workspaceHasApi } from "@/lib/api-keys";
import { getWorkspaceRole, roleAtLeast } from "@/lib/workspace";
import { appUrl } from "@/lib/social/app-url";
import { ApiKeysManager } from "@/components/api-keys-manager";

export const metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

// G12 / G13: per-workspace API keys for the public API and the MCP server (Pro only, admin+ to manage).
export default async function ApiKeysPage() {
  const userId = await getAuthUserId();
  if (!userId) redirect("/sign-in?redirect=/account/api");
  const workspaceId = await activeWorkspaceId(userId);
  const role = await getWorkspaceRole(userId, workspaceId);
  const [ws] = await db.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  const canManage = roleAtLeast(role, "admin");
  const hasApi = await workspaceHasApi(workspaceId);
  const keys = canManage ? await listApiKeys(workspaceId) : [];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="text-sm text-muted-foreground">
          Let your own scripts, Zapier-style tools and AI assistants (over MCP) create posts and pictures in <strong>{ws?.name ?? "this workspace"}</strong>.
          Read the <a className="underline" href="/help/api">API guide</a>.
        </p>
      </div>
      <ApiKeysManager
        canManage={canManage}
        hasApi={hasApi}
        baseUrl={appUrl()}
        keys={keys.map((k) => ({
          id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, revoked: Boolean(k.revokedAt),
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
