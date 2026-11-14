import { RoleRequired } from "@/components/publish/role-required";
import { ShortsManager, type ShortRuleView } from "@/components/publish/shorts-manager";
import { roleAtLeast } from "@/lib/workspace";
import { SHORT_COST } from "@/lib/credits";
import { publishPage } from "@/lib/social/page-context";
import { isAdminWorkspace, listRenderJobs } from "@/lib/social/render-jobs";
import { listShortRules } from "@/lib/social/short-rules";
import { destinationsView } from "@/lib/social/ui";

export const metadata = { title: "Shorts · Publish" };

// Shorts (P5, decision D6). The Workplace-catalogue source is Phoenixtekk's and only offered to the admin workspace;
// everyone else writes their own brief and topics.
export default async function ShortsPage() {
  const sc = await publishPage();
  if (!sc) return null;
  if (!roleAtLeast(sc.role, "editor")) return <RoleRequired role={sc.role} need="editor" />;
  const [rules, destinations, jobs, admin] = await Promise.all([
    listShortRules(sc.workspaceId),
    destinationsView(sc.workspaceId),
    listRenderJobs(sc.workspaceId, "short"),
    isAdminWorkspace(sc.workspaceId),
  ]);
  const solutions = admin
    ? await import("@/lib/shorts/workplace").then((m) => m.listSolutions()).then((all) => all.map((s) => ({ sku: s.sku, name: s.name }))).catch(() => [])
    : [];
  const views: ShortRuleView[] = rules.map((r) => ({
    id: r.id, name: r.name, source: r.source, solutionFilter: r.solutionFilter, seedPrompt: r.seedPrompt, topics: r.topics,
    daysOfWeek: r.daysOfWeek, timeOfDay: r.timeOfDay, timezone: r.timezone, providers: r.providers, active: r.active,
    reviewFirst: r.reviewFirst, held: Boolean(r.migrationHold), nextRunAt: r.nextRunAt?.toISOString() ?? null,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
  }));
  return <ShortsManager rules={views} destinations={destinations} jobs={jobs} cost={SHORT_COST} admin={admin} solutions={solutions} />;
}
