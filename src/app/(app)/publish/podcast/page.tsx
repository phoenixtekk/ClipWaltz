import { PodcastStudio } from "@/components/publish/podcast-studio";
import { roleAtLeast } from "@/lib/workspace";
import { publishPage } from "@/lib/social/page-context";
import { listShowsWithEpisodes } from "@/lib/podcast/shows";
import { APPLE_CATEGORIES } from "@/lib/podcast/categories";

export const metadata = { title: "Podcast · Publish" };

// Podcast hosting (P5, decision D4). Viewers see shows and downloads; workspace admins create and edit shows (a show
// is a destination, like connecting a channel).
export default async function PodcastPage() {
  const sc = await publishPage();
  if (!sc) return null;
  const shows = await listShowsWithEpisodes(sc.workspaceId);
  return <PodcastStudio shows={shows} categories={APPLE_CATEGORIES} canManage={roleAtLeast(sc.role, "admin")} />;
}
