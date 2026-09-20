import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { listAssets } from "@/lib/assets";
import { getMusicTracks, getFavoriteTrackIds } from "@/lib/music";
import { getLatestRender } from "@/lib/render";
import { getActiveContest, isRenderEntered } from "@/lib/contest";
import { getAuthUserId } from "@/lib/auth";
import { listPresets } from "@/lib/presets";
import { EditorWorkspace } from "@/components/editor-workspace";

export const metadata = { title: "Editor" };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const userId = await getAuthUserId();
  const [assets, tracks, latestRender, activeContest, favorites, presets] = await Promise.all([
    listAssets(id),
    getMusicTracks(),
    getLatestRender(id),
    getActiveContest(),
    getFavoriteTrackIds(userId),
    listPresets(),
  ]);

  const contest =
    activeContest && latestRender && latestRender.hasOutput
      ? { theme: activeContest.theme, entered: await isRenderEntered(activeContest.id, latestRender.id) }
      : null;

  return (
    <EditorWorkspace
      projectId={id}
      project={project}
      presets={presets}
      assets={assets}
      tracks={tracks}
      favorites={[...favorites]}
      latestRender={latestRender}
      contest={contest}
      musicTrackTitle={tracks.find((t) => t.id === project.musicTrackId)?.title ?? null}
      backdropAssetId={assets.find((a) => a.uploadState === "uploaded")?.id ?? null}
    />
  );
}
