"use client";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreVertical, Pencil, Copy, Trash2, FolderOpen, ImagePlus, Play } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { ProjectStatus, ProjectSummary } from "@/lib/projects";
import { deleteProject, renameProject, duplicateProject } from "@/lib/project-actions";

const STATUS: Record<ProjectStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "text-muted-foreground border-border bg-background/80" },
  rendering: { label: "Rendering", className: "text-primary border-primary bg-primary/10" },
  ready: {
    label: "Ready",
    className: "text-emerald-700 border-emerald-600/40 bg-emerald-600/10 dark:text-emerald-400",
  },
  failed: {
    label: "Failed",
    className: "text-destructive border-destructive/40 bg-destructive/10",
  },
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const status = STATUS[project.status] ?? STATUS.draft;
  const wide = project.aspect === "16:9";
  const editHref = `/projects/${project.id}/edit`;
  const clips = project.clips ?? 0;

  function run(fn: () => Promise<unknown>, errMsg: string) {
    start(async () => {
      try {
        await fn();
        router.refresh();
      } catch {
        toast.error(errMsg);
      }
    });
  }

  function onRename() {
    const next = window.prompt("Rename project", project.title);
    if (next == null) return;
    run(() => renameProject(project.id, next), "Could not rename the project.");
  }
  function onDuplicate() {
    run(() => duplicateProject(project.id), "Could not duplicate the project.");
  }
  function onDelete() {
    if (!window.confirm(`Delete "${project.title}"? This cannot be undone.`)) return;
    run(() => deleteProject(project.id), "Could not delete the project.");
  }

  return (
    <div
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5",
        pending && "opacity-50",
      )}
    >
      {/* clickable aspect-aware thumbnail */}
      <Link href={editHref} className="block" aria-label={`Open ${project.title}`}>
        <div
          className={cn(
            "relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-primary/15 via-fuchsia-500/10 to-orange-400/10",
            wide ? "aspect-[16/9]" : "aspect-[9/16]",
          )}
        >
          <div className="flex size-11 items-center justify-center rounded-full bg-background/70 backdrop-blur-sm transition-transform group-hover:scale-110">
            <Play className="size-4 translate-x-0.5 fill-foreground text-foreground" />
          </div>
          <span
            className={cn(
              "absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm",
              status.className,
            )}
          >
            {status.label}
          </span>
          <span className="absolute bottom-2 left-2 rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
            {project.aspect} · {clips} clip{clips === 1 ? "" : "s"}
          </span>
        </div>
      </Link>

      <div className="flex items-center justify-between gap-2 p-3">
        <Link href={editHref} className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium hover:text-primary">{project.title}</p>
          <p className="text-xs text-muted-foreground">{relativeTime(project.updatedAt)}</p>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Project actions" disabled={pending} />
            }
          >
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
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="size-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
