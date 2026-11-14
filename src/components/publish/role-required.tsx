import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkspaceRole } from "@/lib/workspace";

const NAME: Record<WorkspaceRole, string> = { owner: "owner", admin: "admin", editor: "editor", viewer: "viewer" };

/** Shown instead of a /publish screen the caller's workspace role cannot use (server actions refuse it anyway). */
export function RoleRequired({ role, need }: { role: WorkspaceRole; need: "editor" | "admin" }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{need === "admin" ? "Owners and admins only" : "Editors and above only"}</CardTitle>
        <CardDescription>
          Your role in this workspace is {NAME[role]}. Ask a workspace {need === "admin" ? "owner" : "owner or admin"} to change your role
          if you need this screen. You can still read posts, the calendar and analytics.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
