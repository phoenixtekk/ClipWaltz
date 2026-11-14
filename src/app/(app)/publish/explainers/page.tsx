import { RoleRequired } from "@/components/publish/role-required";
import { ExplainerMaker } from "@/components/publish/explainer-maker";
import { roleAtLeast } from "@/lib/workspace";
import { EXPLAINER_COST } from "@/lib/credits";
import { publishPage } from "@/lib/social/page-context";
import { isAdminWorkspace, listRenderJobs } from "@/lib/social/render-jobs";
import { destinationsView } from "@/lib/social/ui";

export const metadata = { title: "Explainers · Publish" };

// Explainer episodes (P5, decision D6): made here by hand, or on a schedule by an Auto Post rule in explainer mode.
export default async function ExplainersPage() {
  const sc = await publishPage();
  if (!sc) return null;
  if (!roleAtLeast(sc.role, "editor")) return <RoleRequired role={sc.role} need="editor" />;
  const [destinations, jobs, admin] = await Promise.all([
    destinationsView(sc.workspaceId),
    listRenderJobs(sc.workspaceId, "explainer"),
    isAdminWorkspace(sc.workspaceId),
  ]);
  return <ExplainerMaker destinations={destinations} jobs={jobs} cost={EXPLAINER_COST} ownerVoice={admin} />;
}
