import Link from "next/link";
import { notFound } from "next/navigation";
import { Film, Image as ImageIcon } from "lucide-react";
import { getProject } from "@/lib/projects";
import { listAssets } from "@/lib/assets";
import { getLatestRender } from "@/lib/render";
import { Button } from "@/components/ui/button";
import { RenderPanel } from "@/components/render-panel";

export const metadata = { title: "Editor" };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const assets = await listAssets(id);
  const latestRender = await getLatestRender(id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
        <p className="text-sm text-muted-foreground">
          {assets.length} clip{assets.length === 1 ? "" : "s"} · template: {project.template} ·{" "}
          {project.aspect}
        </p>
      </div>

      {assets.length > 0 ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {assets.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              {a.kind === "video" ? (
                <Film className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No clips yet — import some first.</p>
      )}

      <RenderPanel projectId={id} initial={latestRender} canRender={assets.length > 0} />

      <p className="text-xs text-muted-foreground">
        The cloud assembles your clips into a {project.aspect} video with music. Draft preview, clip
        reordering, and music selection arrive in the next iteration.
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
