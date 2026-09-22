"use client";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MoreVertical, Pencil, Copy, Trash2, FolderOpen, ImagePlus, Play,
  RectangleHorizontal, RectangleVertical, Tag, FolderInput,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { ProjectStatus, ProjectSummary } from "@/lib/projects";
import {
  deleteProject, renameProject, duplicateProject,
  setProjectCategory, setProjectTags,
} from "@/lib/project-actions";
import { createCategory } from "@/lib/category-actions";

const STATUS: Record<ProjectStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "text-muted-foreground border-border bg-background/80" },
  rendering: { label: "Rendering", className: "text-primary border-primary bg-primary/10" },
  ready: {
    label: "Ready",
    className: "text-emerald-700 border-emerald-600/40 bg-emerald-600/10 dark:text-emerald-400",
  },
  failed: { label: "Failed", className: "text-destructive border-destructive/40 bg-destructive/10" },
};

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProjectCard({
  project,
  categories = [],
}: {
  project: ProjectSummary;
  categories?: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const status = STATUS[project.status] ?? STATUS.draft;
  const wide = project.aspect === "16:9";
  const editHref = `/projects/${project.id}/edit`;
  const clips = project.clips ?? 0;
  const displayName = project.titleText?.trim() || project.title;
  const OrientIcon = wide ? RectangleHorizontal : RectangleVertical;

  function run(fn: () => Promise<unknown>, errMsg: string) {
    start(async () => {
      try { await fn(); router.refresh(); } catch { toast.error(errMsg); }
    });
  }
  const onRename = () => {
    const next = window.prompt("Rename project", project.title);
    if (next != null) run(() => renameProject(project.id, next), "Could not rename the project.");
  };
  const onDelete = () => {
    if (window.confirm(`Delete "${project.title}"? This cannot be undone.`))
      run(() => deleteProject(project.id), "Could not delete the project.");
  };
  const onEditTags = () => {
    const next = window.prompt("Tags (comma-separated):", project.tags.join(", "));
    if (next == null) return;
    const tags = next.split(",").map((t) => t.trim()).filter(Boolean);
    run(() => setProjectTags(project.id, tags), "Could not save tags.");
  };
  const moveTo = (c: string | null) => run(() => setProjectCategory(project.id, c), "Could not move the project.");
  const onNewCategory = () => {
    const c = window.prompt("New category name:");
    if (!c || !c.trim()) return;
    const name = c.trim();
    run(async () => { await createCategory(name); await setProjectCategory(project.id, name); }, "Could not create category.");
  };

  return (
    <div
      className={cn(
        "cw-sheen group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-[color:var(--cw-violet)]/50 hover:shadow-xl hover:shadow-[color:var(--cw-violet)]/10",
        pending && "opacity-50",
      )}
    >
      {/* Uniform 16:9 thumbnail for every card so the grid stays even; orientation shown as an icon. */}
      <Link href={editHref} className="block" aria-label={`Open ${displayName}`}>
        <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-gradient-to-br from-[color:var(--cw-blue)]/20 via-[color:var(--cw-magenta)]/15 to-[color:var(--cw-coral)]/15">
          <div className="flex size-9 items-center justify-center rounded-full bg-background/70 backdrop-blur-sm transition-transform group-hover:scale-110">
            <Play className="size-4 translate-x-0.5 fill-foreground text-foreground" />
          </div>
          <span className={cn("absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm", status.className)}>
            {status.label}
          </span>
          <span
            className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur-sm"
            title={wide ? "Landscape (16:9)" : "Portrait (9:16)"}
          >
            <OrientIcon className="size-3.5" /> {project.aspect}
          </span>
          <span className="absolute bottom-2 left-2 rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
            {clips} clip{clips === 1 ? "" : "s"}
          </span>
        </div>
      </Link>

      <div className="flex min-h-0 flex-1 flex-col gap-1 p-2.5">
        <div className="flex items-start justify-between gap-1">
          <Link href={editHref} className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium hover:text-primary">{displayName}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {project.titleText?.trim() ? `${project.title} · ` : ""}
              {relativeTime(project.updatedAt)}
            </p>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Project actions" disabled={pending} />}>
              <MoreVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push(editHref)}>
                <FolderOpen className="size-4" /> Open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push(`/projects/${project.id}/import`)}>
                <ImagePlus className="size-4" /> Add media
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="size-4" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEditTags}>
                <Tag className="size-4" /> Edit tags…
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput className="size-4" /> Move to
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => moveTo(null)}>Uncategorized</DropdownMenuItem>
                  {categories.filter((c) => c !== project.category).map((c) => (
                    <DropdownMenuItem key={c} onClick={() => moveTo(c)}>{c}</DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onNewCategory}>+ New category…</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={() => run(() => duplicateProject(project.id), "Could not duplicate.")}>
                <Copy className="size-4" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 className="size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {project.tags.length ? (
          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            {project.tags.slice(0, 4).map((t) => (
              <span key={t} className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t}
              </span>
            ))}
            {project.tags.length > 4 ? <span className="text-[10px] text-muted-foreground">+{project.tags.length - 4}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
