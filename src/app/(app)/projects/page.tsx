import Link from "next/link";
import { Users } from "lucide-react";
import { getSession } from "@/lib/auth";
import { listProjects, listCategories } from "@/lib/projects";
import { listMyWorkspaces } from "@/lib/workspace-actions";
import { withArticle } from "@/lib/workspace";
import { NewProjectButton } from "@/components/new-project-button";
import { ProjectsBoard } from "@/components/projects-board";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const session = await getSession();
  const { ws } = await searchParams;
  const workspaces = await listMyWorkspaces();
  // Personal workspace first (listMyWorkspaces orders it so); ?ws= switches to a shared one.
  const current = workspaces.find((w) => w.id === ws) ?? workspaces[0];
  const shared = !!current && !current.isPersonal;
  const canCreate = !current || current.role !== "viewer";
  const [projects, categories] = await Promise.all([
    listProjects(current?.id, !shared), // personal also shows legacy (workspace-less) projects
    listCategories(),
  ]);
  const plan = (session?.user as { plan?: string } | undefined)?.plan ?? "free";
  const isFree = plan === "free";

  return (
    <div className="space-y-6">
      <div className="cw-glass flex items-center justify-between gap-4 rounded-2xl p-4">
        <div>
          <h1 className="cw-gradient-text text-2xl font-semibold tracking-tight">
            {shared ? current.name : "Your projects"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {projects.length} project{projects.length === 1 ? "" : "s"}
            {shared ? ` · shared by ${current.ownerName} · you're ${withArticle(current.role)}` : ""}
          </p>
        </div>
        {canCreate ? <NewProjectButton workspaceId={shared ? current.id : undefined} /> : null}
      </div>

      {workspaces.length > 1 ? (
        <nav aria-label="Workspaces" className="flex flex-wrap items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          {workspaces.map((w) => (
            <Link
              key={w.id}
              href={w.isPersonal ? "/projects" : `/projects?ws=${w.id}`}
              aria-current={w.id === current?.id ? "page" : undefined}
              className={
                "rounded-full border px-3 py-1 text-sm transition-colors " +
                (w.id === current?.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground")
              }
            >
              {w.isPersonal ? "My projects" : w.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {isFree && projects.length > 0 ? (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Free plan — uploaded source files auto-delete after 7 days. Upgrade for a
          longer-retention Project Vault.
        </div>
      ) : null}

      {projects.length === 0 ? (
        shared ? (
          <p className="cw-glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
            No projects in this workspace yet.
          </p>
        ) : (
          <EmptyState />
        )
      ) : <ProjectsBoard projects={projects} categories={categories} />}
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
