import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { listAssets } from "@/lib/assets";
import { ImportUploader } from "@/components/import-uploader";

export const metadata = { title: "Import media" };

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const assets = await listAssets(id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Import media</h1>
          <p className="text-sm text-muted-foreground">
            {project.title} · template: {project.template} · {project.aspect}
          </p>
        </div>
        <ol className="flex items-center gap-2 text-xs font-medium">
          <li className="rounded-full border border-border px-3 py-1 text-muted-foreground">
            1 · Occasion
          </li>
          <li className="rounded-full border border-primary bg-primary/10 px-3 py-1 text-primary">
            2 · Import
          </li>
        </ol>
      </div>

      <ImportUploader projectId={id} initial={assets} />
    </div>
  );
}
