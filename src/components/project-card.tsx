"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Pencil, Copy, Trash2 } from "lucide-react";
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
  draft: { label: "Draft", className: "text-muted-foreground border-border bg-background" },
  rendering: { label: "Rendering", className: "text-primary border-primary bg-primary/10" },
  ready: {
    label: "Ready",
    className:
      "text-emerald-700 border-emerald-600/40 bg-emerald-600/10 dark:text-emerald-400",
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
        "group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-opacity",
        pending && "opacity-50",
      )}
    >
      {/* 9:16 thumbnail placeholder */}
      <div className="relative flex aspect-[9/16] items-center justify-center bg-muted">
        <span className="text-xs font-medium text-muted-foreground">9:16</span>
        <span
          className={cn(
            "absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            status.className,
          )}
        >
          {status.label}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{project.title}</p>
          <p className="text-xs text-muted-foreground">{relativeTime(project.updatedAt)}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Project actions" disabled={pending} />
            }
          >
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
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
