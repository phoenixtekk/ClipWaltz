import { and, count, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { RoleRequired } from "@/components/publish/role-required";
import { roleAtLeast } from "@/lib/workspace";
import { AutoPostManager, type PresetView, type RuleView } from "@/components/publish/auto-post-manager";
import { listRules } from "@/lib/social/auto-post-rules";
import { publishPage } from "@/lib/social/page-context";
import { destinationsView, listPostViews } from "@/lib/social/ui";

export const metadata = { title: "Auto Post · Publish" };

export default async function AutoPostPage() {
  const sc = await publishPage();
  if (!sc) return null;
  if (!roleAtLeast(sc.role, "editor")) return <RoleRequired role={sc.role} need="editor" />;
  const [rules, presets, destinations, [q], published] = await Promise.all([
    listRules(sc.workspaceId),
    db.select().from(schema.socialAutoPresets).where(eq(schema.socialAutoPresets.workspaceId, sc.workspaceId)).orderBy(desc(schema.socialAutoPresets.createdAt)),
    destinationsView(sc.workspaceId),
    db.select({ n: count() }).from(schema.socialPosts).where(and(eq(schema.socialPosts.workspaceId, sc.workspaceId), eq(schema.socialPosts.status, "queued"))),
    listPostViews(sc.workspaceId, "published", 40),
  ]);

  const ruleViews: RuleView[] = rules.map((r) => ({
    id: r.id, name: r.name, daysOfWeek: r.daysOfWeek, timeOfDay: r.timeOfDay, timezone: r.timezone, providers: r.providers,
    active: r.active, mode: r.mode, seedPrompt: r.seedPrompt, topics: r.topics, links: r.links, linkUtm: r.linkUtm,
    reviewFirst: r.reviewFirst, imageMode: r.imageMode, videoMode: r.videoMode, imageSet: r.imageSet, productId: r.productId,
    nextRunAt: r.nextRunAt?.toISOString() ?? null, lastRunAt: r.lastRunAt?.toISOString() ?? null,
    postsTotal: r.postsTotal, postsRecent: r.postsRecent, clashesWith: r.clashesWith,
  }));
  const presetViews: PresetView[] = presets.map((p) => ({
    id: p.id, name: p.name, daysOfWeek: p.daysOfWeek, timeOfDay: p.timeOfDay, providers: p.providers, mode: p.mode,
    seedPrompt: p.seedPrompt, topics: p.topics, links: p.links, linkUtm: p.linkUtm, reviewFirst: p.reviewFirst,
  }));

  return (
    <AutoPostManager
      rules={ruleViews}
      presets={presetViews}
      destinations={destinations}
      queued={Number(q?.n ?? 0)}
      published={published}
    />
  );
}
