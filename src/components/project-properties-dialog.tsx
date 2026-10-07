"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { ProjectSummary } from "@/lib/projects";
import { updateProjectProperties } from "@/lib/project-actions";
import { previewRenderTargets, setProjectCloudTargets } from "@/lib/cloud-actions";
import { CloudTargetPicker } from "@/components/cloud-target-picker";
import type { CloudProviderId } from "@/lib/cloud/types";
import { createCategory } from "@/lib/category-actions";
import { aspectLabel } from "@/lib/aspect";
import { unwrap } from "@/lib/action-result";
import { LocalDate } from "@/components/local-date";

const NEW = "__new__";
const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A project's properties: name, description, category and tags in one place (replaces the old prompts). */
export function ProjectPropertiesDialog({
  project, categories, open, onClose,
}: {
  project: ProjectSummary;
  categories: string[];
  open: boolean;
  onClose: () => void;
}) {
  if (!open || typeof document === "undefined") return null;
  // Mounted only while open, so every open starts from the project's current values.
  return createPortal(<PropertiesForm project={project} categories={categories} onClose={onClose} />, document.body);
}

function PropertiesForm({ project, categories, onClose }: { project: ProjectSummary; categories: string[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? "");
  const [category, setCategory] = useState<string>(project.category ?? "");
  const [newCat, setNewCat] = useState("");
  const [tags, setTags] = useState<string[]>(project.tags);
  const [tagDraft, setTagDraft] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  // "Save finished videos to": follow my rules (null) or a fixed list for this project. Owner + connected storage only.
  const [dest, setDest] = useState<{ connected: CloudProviderId[]; initial: CloudProviderId[] | null; value: CloudProviderId[] | null } | null>(null);
  useEffect(() => {
    previewRenderTargets(project.id).then((r) => {
      if (r.ok && r.data.owner && r.data.connected.length) {
        setDest({ connected: r.data.connected, initial: r.data.projectTargets, value: r.data.projectTargets });
      }
    }).catch(() => {});
  }, [project.id]);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A legacy (free-text) category on the project still shows as an option.
  const options = Array.from(new Set([...categories, ...(project.category ? [project.category] : [])]));
  const addTag = (raw: string) => {
    const t = raw.trim().replace(/,+$/, "").slice(0, 30);
    if (t && !tags.includes(t) && tags.length < 12) setTags([...tags, t]);
    setTagDraft("");
  };
  const save = () =>
    start(async () => {
      try {
        let cat: string | null = category || null;
        if (category === NEW) {
          cat = newCat.trim() || null;
          if (cat) unwrap(await createCategory(cat));
        }
        const pendingTag = tagDraft.trim();
        const allTags = pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags;
        unwrap(await updateProjectProperties(project.id, { title, description, category: cat, tags: allTags }));
        if (dest && JSON.stringify(dest.value) !== JSON.stringify(dest.initial)) unwrap(await setProjectCloudTargets(project.id, dest.value));
        toast.success("Properties saved");
        onClose();
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not save the properties.");
      }
    });

  const kind = project.kind === "deck" ? "WaltzDeck" : "AutoWaltz";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="pp-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-4 rounded-2xl border border-border bg-background p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="pp-title" className="text-base font-semibold">Video properties</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <input ref={nameRef} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={field} />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3}
            placeholder="What this video is for (optional)" className={cn(field, "resize-y")} />
        </label>

        <div className="space-y-1">
          <label htmlFor="pp-cat" className="text-xs font-medium text-muted-foreground">Category</label>
          <select id="pp-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
            <option value="">Uncategorized</option>
            {options.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value={NEW}>+ New category…</option>
          </select>
          {category === NEW ? (
            <input autoFocus value={newCat} onChange={(e) => setNewCat(e.target.value)} maxLength={60}
              placeholder="New category name" aria-label="New category name" className={field} />
          ) : null}
        </div>

        <div className="space-y-1">
          <label htmlFor="pp-tag" className="text-xs font-medium text-muted-foreground">Tags <span className="font-normal">({tags.length}/12)</span></label>
          <div className={cn(field, "flex flex-wrap items-center gap-1.5 py-1.5")}>
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                {t}
                <button type="button" aria-label={`Remove tag ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}
                  className="text-muted-foreground hover:text-foreground"><X className="size-3" /></button>
              </span>
            ))}
            <input id="pp-tag" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagDraft); }
                else if (e.key === "Backspace" && !tagDraft && tags.length) setTags(tags.slice(0, -1));
              }}
              onBlur={() => tagDraft.trim() && addTag(tagDraft)}
              placeholder={tags.length ? "" : "Type a tag, press Enter"} disabled={tags.length >= 12}
              className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none" />
            {tagDraft.trim() ? (
              <button type="button" aria-label="Add tag" onClick={() => addTag(tagDraft)} className="text-muted-foreground hover:text-foreground"><Plus className="size-3.5" /></button>
            ) : null}
          </div>
        </div>

        {dest ? (
          <div className="space-y-1.5">
            <label htmlFor="pp-dest" className="text-xs font-medium text-muted-foreground">Save finished videos to</label>
            <select id="pp-dest" value={dest.value === null ? "rules" : "custom"} className={field}
              onChange={(e) => setDest({ ...dest, value: e.target.value === "rules" ? null : dest.value ?? [...dest.connected] })}>
              <option value="rules">Follow my storage rules</option>
              <option value="custom">Choose for this project</option>
            </select>
            {dest.value !== null ? (
              <>
                <CloudTargetPicker connected={dest.connected} value={dest.value} onChange={(v) => setDest({ ...dest, value: v })} />
                {dest.value.length === 0 ? <p className="text-[11px] text-muted-foreground">This project&apos;s videos won&apos;t be saved to cloud storage.</p> : null}
              </>
            ) : null}
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Type</dt><dd>{kind}</dd></div>
          <div><dt className="text-muted-foreground">Format</dt><dd>{aspectLabel(project.aspect)}</dd></div>
          <div><dt className="text-muted-foreground">Clips</dt><dd>{project.clips ?? 0}</dd></div>
          <div><dt className="text-muted-foreground">Status</dt><dd className="capitalize">{project.status}</dd></div>
          {project.createdAt ? <div><dt className="text-muted-foreground">Created</dt><dd><LocalDate value={project.createdAt} kind="date" /></dd></div> : null}
          <div><dt className="text-muted-foreground">Last edited</dt><dd><LocalDate value={project.updatedAt} kind="date" /></dd></div>
        </dl>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={pending || !title.trim() || (category === NEW && !newCat.trim())}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Save
          </Button>
        </div>
      </div>
    </div>
  );
}
