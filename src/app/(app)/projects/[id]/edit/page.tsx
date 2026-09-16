import Link from "next/link";
import { notFound } from "next/navigation";
import { Film, Image as ImageIcon } from "lucide-react";
import { getProject } from "@/lib/projects";
import { listAssets } from "@/lib/assets";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Editor" };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const assets = await listAssets(id);

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

      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Draft preview &amp; editor — coming next.</p>
        <p className="mt-1">
          The cloud auto-assemble (beat-synced cuts), draft preview, music swap, and HD render land in
          the next milestone. Your uploaded clips are safe in storage.
        </p>
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <Button variant="ghost" render={<Link href={`/projects/${id}/import`} />}>
          ← Back to import
        </Button>
        <Button variant="outline" render={<Link href="/projects" />}>
          Save &amp; exit
        </Button>
        <Button disabled>Render HD →</Button>
      </div>
    </div>
  );
}
