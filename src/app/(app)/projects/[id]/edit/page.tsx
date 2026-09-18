import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { listAssets } from "@/lib/assets";
import { getMusicTracks } from "@/lib/music";
import { getLatestRender } from "@/lib/render";
import { Button } from "@/components/ui/button";
import { ProjectEditor } from "@/components/project-editor";
import { DraftPreview } from "@/components/draft-preview";
import { RenderPanel } from "@/components/render-panel";

export const metadata = { title: "Editor" };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const [assets, tracks, latestRender] = await Promise.all([
    listAssets(id),
    getMusicTracks(),
    getLatestRender(id),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
        <p className="text-sm text-muted-foreground">
          {assets.length} clip{assets.length === 1 ? "" : "s"} · template: {project.template} ·{" "}
          {project.aspect}
        </p>
      </div>

      <ProjectEditor
        projectId={id}
        assets={assets}
        tracks={tracks}
        musicTrackId={project.musicTrackId}
        lengthSec={project.lengthSec}
        aspect={project.aspect}
        titleText={project.titleText}
        styleFilter={project.styleFilter}
        transition={project.transition}
        motion={project.motion}
        fades={project.fades}
        smartCut={project.smartCut}
        beatSync={project.beatSync}
      />

      <DraftPreview
        projectId={id}
        assets={assets}
        musicTrackId={project.musicTrackId}
        musicTrackTitle={tracks.find((t) => t.id === project.musicTrackId)?.title ?? null}
        lengthSec={project.lengthSec}
        aspect={project.aspect}
      />

      <RenderPanel projectId={id} initial={latestRender} canRender={assets.length > 0} />

      <p className="text-xs text-muted-foreground">
        Reorder clips, pick a soundtrack, set the length — the draft preview updates instantly. Render HD
        for the full-quality video. Beat-synced cuts and smart clip selection arrive in a later iteration.
      </p>

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <Button variant="ghost" render={<Link href={`/projects/${id}/import`} />}>
          ← Back to import
        </Button>
        <Button variant="outline" render={<Link href="/projects" />}>
          Save &amp; exit
        </Button>
      </div>
    </div>
  );
}
