import { getSession } from "@/lib/auth";
import { listProjects, listCategories } from "@/lib/projects";
import { NewProjectButton } from "@/components/new-project-button";
import { ProjectsBoard } from "@/components/projects-board";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const session = await getSession();
  const [projects, categories] = await Promise.all([listProjects(), listCategories()]);
  const plan = (session?.user as { plan?: string } | undefined)?.plan ?? "free";
  const isFree = plan === "free";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="cw-gradient-text text-2xl font-semibold tracking-tight">Your projects</h1>
          <p className="text-sm text-muted-foreground">
            {projects.length} project{projects.length === 1 ? "" : "s"}
          </p>
        </div>
        <NewProjectButton />
      </div>

      {isFree && projects.length > 0 ? (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Free plan — uploaded source files auto-delete after 7 days. Upgrade for a
          longer-retention Project Vault.
        </div>
      ) : null}

      {projects.length === 0 ? <EmptyState /> : <ProjectsBoard projects={projects} categories={categories} />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="cw-glass flex flex-col items-center justify-center gap-5 rounded-2xl py-20 text-center">
      <div className="space-y-1">
        <h2 className="cw-gradient-text text-xl font-semibold">Create your first video</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Drop in your photos and videos — ClipWaltz auto-edits them into a polished,
          music-driven highlight video.
        </p>
      </div>
      <NewProjectButton size="lg" label="+ New Project" />
    </div>
  );
}
