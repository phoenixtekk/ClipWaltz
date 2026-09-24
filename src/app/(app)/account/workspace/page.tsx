import { redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/auth";
import { getWorkspaceDetail, listMyWorkspaces } from "@/lib/workspace-actions";
import { WorkspaceManager } from "@/components/workspace-manager";

export const metadata = { title: "Workspace" };

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const userId = await getAuthUserId();
  if (!userId) redirect("/sign-in");
  const { ws } = await searchParams;
  const workspaces = await listMyWorkspaces();
  const current = workspaces.find((w) => w.id === ws) ?? workspaces[0];
  const detail = current ? await getWorkspaceDetail(current.id) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
        <p className="text-sm text-muted-foreground">
          Invite people to work on your projects together. Members see every project in the workspace.
        </p>
      </div>
      {detail ? (
        <WorkspaceManager workspaces={workspaces} detail={detail} userId={userId} />
      ) : (
        <p className="text-sm text-muted-foreground">No workspace found.</p>
      )}
    </div>
  );
}
