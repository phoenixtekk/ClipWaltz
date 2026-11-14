import { PlanMaker } from "@/components/publish/plan-maker";
import { RoleRequired } from "@/components/publish/role-required";
import { IMAGE_COST } from "@/lib/credits";
import { roleAtLeast } from "@/lib/workspace";
import { publishPage } from "@/lib/social/page-context";
import { destinationsView } from "@/lib/social/ui";

export const metadata = { title: "Plan a week · Publish" };

// G14: brief → N distinct drafts on the calendar (editor+).
export default async function PlanPage() {
  const sc = await publishPage();
  if (!sc) return null;
  if (!roleAtLeast(sc.role, "editor")) return <RoleRequired role={sc.role} need="editor" />;
  return <PlanMaker destinations={await destinationsView(sc.workspaceId)} imageCost={IMAGE_COST} />;
}
