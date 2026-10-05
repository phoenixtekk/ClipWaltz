"use client";
// A project title that can be renamed in place (WaltzDeck editor header): click the name or the pencil, type,
// Enter / click away saves, Escape cancels. Saves through renameProject (project-actions.ts, editor access).
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { unwrap } from "@/lib/action-result";
import { renameProject } from "@/lib/project-actions";

export function EditableTitle({ projectId, title, canEdit, onRenamed }: {
  projectId: string; title: string; canEdit: boolean; onRenamed?: (title: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);

  if (!canEdit) return <>{title}</>;
  const start = () => { setValue(title); setEditing(true); };
  const save = async () => {
    const next = value.trim().slice(0, 120);
    setEditing(false);
    if (!next || next === title) return;
    setSaving(true);
    try {
      unwrap(await renameProject(projectId, next));
      await onRenamed?.(next);
      toast.success("Project renamed.");
    } catch (e) { toast.error((e as Error).message || "Couldn't rename the project."); }
    setSaving(false);
  };
  if (editing) {
    return (
      <span className="inline-flex max-w-full items-center gap-1">
        <input ref={input} value={value} maxLength={120} aria-label="Project name" onChange={(e) => setValue(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } else if (e.key === "Escape") { setEditing(false); } }}
          className="h-7 w-[min(28rem,60vw)] rounded-md border border-primary bg-background px-2 text-sm font-semibold outline-none" />
        <Check className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </span>
    );
  }
  return (
    <button type="button" onClick={start} title="Rename this project"
      className="group inline-flex max-w-full items-center gap-1.5 rounded-md text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <span className="truncate">{title}</span>
      {saving ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Pencil className="size-3.5 shrink-0 opacity-50 group-hover:opacity-100" />}
    </button>
  );
}
