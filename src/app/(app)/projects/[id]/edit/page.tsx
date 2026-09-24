import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { listAssets } from "@/lib/assets";
import { getMusicTracks, getFavoriteTrackIds } from "@/lib/music";
import { getLatestRender, listRenders } from "@/lib/render";
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
  const [assets, tracks, latestRender, renders, activeContest, favorites, presets] = await Promise.all([
    listAssets(id),
    getMusicTracks(userId),
    getLatestRender(id),
    listRenders(id),
    getActiveContest(),
    getFavoriteTrackIds(userId),
    listPresets(),
  ]);

  const contest =
    activeContest && latestRender && latestRender.hasOutput
      ? { theme: activeContest.theme, entered: await isRenderEntered(activeContest.id, latestRender.id) }
      : null;

  const editor = (
    <EditorWorkspace
      projectId={id}
      project={project}
      presets={presets}
      assets={assets}
      tracks={tracks}
      favorites={[...favorites]}
      latestRender={latestRender}
      renders={renders}
      contest={contest}
      musicTrackTitle={tracks.find((t) => t.id === project.musicTrackId)?.title ?? null}
      backdropAssetId={assets.find((a) => a.uploadState === "uploaded")?.id ?? null}
    />
  );
  if (project.role !== "viewer") return editor;

  // Viewers (ADR-0004) get the same screen read-only: every control is disabled natively by the
  // fieldset; players and download links still work. The server rejects any edit regardless.
  return (
    <div className="space-y-4">
      <p role="status" className="rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
        View only — you&apos;re a viewer in this workspace. Ask an admin for editor access to make changes.
      </p>
      <fieldset disabled className="contents">
        {editor}
      </fieldset>
    </div>
  );
}
