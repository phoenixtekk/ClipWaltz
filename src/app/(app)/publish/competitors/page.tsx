import { CompetitorBoard } from "@/components/publish/competitor-board";
import { listCompetitors } from "@/lib/competitors";
import { roleAtLeast } from "@/lib/workspace";
import { publishPage } from "@/lib/social/page-context";

export const metadata = { title: "Competitors · Publish" };
export const dynamic = "force-dynamic";

// G7: follow competitors' PUBLIC feeds and accounts (RSS/Atom, Bluesky, Mastodon), see what they post, get an AI summary.
export default async function CompetitorsPage() {
  const sc = await publishPage();
  if (!sc) return null;
  const sources = await listCompetitors(sc.workspaceId);
  return (
    <CompetitorBoard
      canEdit={roleAtLeast(sc.role, "editor")}
      sources={sources.map((s) => ({
        id: s.id, name: s.name, kind: s.kind, ref: s.ref, summary: s.summary, summaryAt: s.summaryAt?.toISOString() ?? null,
        lastFetchedAt: s.lastFetchedAt?.toISOString() ?? null, lastError: s.lastError, perWeek: s.perWeek,
        posts: s.posts.map((p) => ({ id: p.id, url: p.url, title: p.title, text: p.text, publishedAt: p.publishedAt?.toISOString() ?? null })),
      }))}
    />
  );
}
