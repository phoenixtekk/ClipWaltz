import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { listAssets } from "@/lib/assets";
import { getAuthUserId } from "@/lib/auth";
import { hasGoogleConnection, googleConfigured } from "@/lib/google";
import { ImportUploader } from "@/components/import-uploader";
import { GoogleImport } from "@/components/google-import";

export const metadata = { title: "Import media" };

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const project = await getProject(id);
  if (!project) notFound();
  const assets = await listAssets(id);
  const userId = await getAuthUserId();
  const googleConnected = !!userId && googleConfigured() && (await hasGoogleConnection(userId));
  const feedback = typeof sp.google === "string" ? sp.google : undefined;

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
          <li className="rounded-full border border-border px-3 py-1 text-muted-foreground">1 · Occasion</li>
          <li className="rounded-full border border-primary bg-primary/10 px-3 py-1 text-primary">2 · Import</li>
        </ol>
      </div>

      {googleConfigured() ? (
        <section className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Import from the cloud</h2>
          <div className="flex flex-wrap items-center gap-2">
            <GoogleImport projectId={id} connected={googleConnected} feedback={feedback} />
          </div>
          <p className="text-xs text-muted-foreground">
            On iPhone, use the file picker below — iCloud Photos has no web import, but Safari&rsquo;s
            picker reaches your library. OneDrive &amp; Dropbox coming next.
          </p>
        </section>
      ) : null}

      <ImportUploader projectId={id} initial={assets} />
    </div>
  );
}
