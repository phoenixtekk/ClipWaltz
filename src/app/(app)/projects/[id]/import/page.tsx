import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Import media" };

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

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

      {/* Placeholder for the full import screen (wireframe screen 05) — built next. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {["Drag & drop", "Choose files / folder", "Connect your phone"].map((m) => (
          <div
            key={m}
            className="rounded-xl border border-dashed border-border bg-card p-4 text-center text-sm text-muted-foreground"
          >
            {m}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Import is coming next.</p>
        <p className="mt-1">
          &ldquo;Connect your phone&rdquo; will be an OS-assisted import: plug the phone into your
          PC, your computer opens it (Windows: This PC → phone → DCIM; Mac: Photos / Image Capture,
          or Android File Transfer), then pick those files here. A browser can&apos;t read a
          phone&apos;s library directly over USB.
        </p>
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <Button variant="ghost" render={<Link href="/projects/new" />}>
          ← Back
        </Button>
        <Button variant="outline" render={<Link href="/projects" />}>
          Save &amp; exit
        </Button>
      </div>
    </div>
  );
}
