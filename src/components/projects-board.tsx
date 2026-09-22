"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, FolderPlus, X, Tag as TagIcon, MoreVertical, Pencil, Trash2, ChevronUp, ChevronDown, Palette } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { ProjectSummary, ProjectCategory } from "@/lib/projects";
import { setProjectCategory } from "@/lib/project-actions";
import { createCategory, renameCategory, deleteCategory, setCategoryColor, moveCategory } from "@/lib/category-actions";
import { ProjectCard } from "@/components/project-card";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const UNCATEGORIZED = "Uncategorized";

export function ProjectsBoard({ projects, categories }: { projects: ProjectSummary[]; categories: ProjectCategory[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [items, setItems] = useState<ProjectSummary[]>(() => projects);
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCat, setOverCat] = useState<string | null>(null);

  const act = (fn: () => Promise<unknown>, err: string) =>
    start(async () => { try { await fn(); router.refresh(); } catch (e) { toast.error((e as Error).message || err); } });

  const allTags = useMemo(() => Array.from(new Set(items.flatMap((p) => p.tags))).sort((a, b) => a.localeCompare(b)), [items]);

  // Sections: server categories (ordered) + any legacy free-text categories still on projects, then
  // Uncategorized. Server categories carry an id + colour and can be managed; legacy ones can't.
  const sections = useMemo(() => {
    const serverNames = new Set(categories.map((c) => c.name));
    const legacy = Array.from(new Set(items.map((p) => p.category).filter((c): c is string => !!c && !serverNames.has(c)))).sort();
    return [
      ...categories.map((c) => ({ name: c.name, id: c.id, color: c.color, managed: true })),
      ...legacy.map((name) => ({ name, id: null as string | null, color: null as string | null, managed: false })),
      { name: UNCATEGORIZED, id: null as string | null, color: null as string | null, managed: false },
    ];
  }, [categories, items]);
  const catNames = sections.filter((s) => s.name !== UNCATEGORIZED).map((s) => s.name);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => items.filter((p) => {
      const name = (p.titleText?.trim() || p.title).toLowerCase();
      const mQ = !q || name.includes(q) || p.title.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q));
      const mT = activeTags.every((t) => p.tags.includes(t));
      return mQ && mT;
    }),
    [items, q, activeTags],
  );
  const filtering = q.length > 0 || activeTags.length > 0;
  const byCat = (name: string) => filtered.filter((p) => (name === UNCATEGORIZED ? !p.category : p.category === name));

  const toggleTag = (t: string) => setActiveTags((c) => (c.includes(t) ? c.filter((x) => x !== t) : [...c, t]));

  function addCategory() {
    const name = window.prompt("New category name:");
    if (name?.trim()) act(() => createCategory(name.trim()), "Could not create category.");
  }
  function drop(name: string) {
    const id = dragId;
    setDragId(null); setOverCat(null);
    if (!id) return;
    const target = name === UNCATEGORIZED ? null : name;
    if ((items.find((p) => p.id === id)?.category ?? null) === target) return;
    setItems((cur) => cur.map((p) => (p.id === id ? { ...p, category: target } : p))); // optimistic
    start(async () => {
      try { await setProjectCategory(id, target); router.refresh(); }
      catch { toast.error("Could not move the project."); setItems(projects); }
    });
  }

  return (
    <div className="space-y-5">
      <div className="cw-glass space-y-3 rounded-2xl p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects and tags…"
            className="h-10 w-full rounded-full border border-border bg-card pl-9 pr-9 text-sm outline-none focus:border-primary"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
          ) : null}
        </div>
        <button type="button" onClick={addCategory} disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-sm font-medium hover:border-primary hover:text-primary disabled:opacity-60">
          <FolderPlus className="size-4" /> New category
        </button>
      </div>

      {allTags.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <TagIcon className="size-3.5 text-muted-foreground" />
          {allTags.map((t) => (
            <button key={t} type="button" onClick={() => toggleTag(t)} className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", activeTags.includes(t) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>{t}</button>
          ))}
          {activeTags.length ? <button type="button" onClick={() => setActiveTags([])} className="text-xs text-muted-foreground underline hover:text-foreground">clear</button> : null}
        </div>
      ) : null}
      </div>

      {sections.map((sec, secIdx) => {
        const list = byCat(sec.name);
        if (filtering && list.length === 0) return null;
        return (
          <section
            key={sec.name}
            onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverCat(sec.name); } }}
            onDragLeave={() => setOverCat((c) => (c === sec.name ? null : c))}
            onDrop={() => drop(sec.name)}
            className={cn("cw-glass rounded-2xl p-4 transition-shadow", overCat === sec.name && "ring-2 ring-primary")}
            style={sec.color ? { borderColor: `${sec.color}66` } : undefined}
          >
            <div className="mb-2 flex items-center gap-2 px-1">
              {sec.color ? <span className="size-2.5 rounded-full" style={{ background: sec.color }} /> : null}
              <h2 className="text-sm font-semibold">{sec.name}</h2>
              <span className="text-xs text-muted-foreground">{list.length}</span>
              {dragId ? <span className="text-[11px] text-primary">drop here</span> : null}
              {sec.managed && sec.id ? (
                <CategoryMenu
                  id={sec.id} name={sec.name} color={sec.color}
                  canUp={secIdx > 0} canDown={secIdx < catNames.length - 1}
                  busy={busy} act={act}
                />
              ) : null}
            </div>
            {list.length === 0 ? (
              <p className="px-1 py-4 text-xs text-muted-foreground">{sec.name === UNCATEGORIZED ? "No uncategorized projects." : "Drag projects here."}</p>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
                {list.map((p) => (
                  <div
                    key={p.id} draggable
                    onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDragId(null); setOverCat(null); }}
                    className={cn("cursor-grab active:cursor-grabbing", dragId === p.id && "opacity-40")}
                  >
                    <ProjectCard project={p} categories={catNames} />
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {filtering && filtered.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No projects match your search.</p> : null}
    </div>
  );
}

function CategoryMenu({
  id, name, color, canUp, canDown, busy, act,
}: {
  id: string; name: string; color: string | null; canUp: boolean; canDown: boolean; busy: boolean;
  act: (fn: () => Promise<unknown>, err: string) => void;
}) {
  return (
    <div className="ml-auto flex items-center gap-0.5">
      <label className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground hover:text-foreground" title="Category colour">
        <Palette className="size-4" />
        <input type="color" value={color ?? "#7c3aed"} onChange={(e) => act(() => setCategoryColor(id, e.target.value), "Could not set colour.")} className="sr-only" />
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger render={<button type="button" aria-label={`${name} options`} disabled={busy} className="grid size-7 place-items-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-50" />}>
          <MoreVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => { const n = window.prompt("Rename category", name); if (n?.trim()) act(() => renameCategory(id, n.trim()), "Could not rename."); }}>
            <Pencil className="size-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canUp} onClick={() => act(() => moveCategory(id, -1), "Could not move.")}>
            <ChevronUp className="size-4" /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canDown} onClick={() => act(() => moveCategory(id, 1), "Could not move.")}>
            <ChevronDown className="size-4" /> Move down
          </DropdownMenuItem>
          {color ? (
            <DropdownMenuItem onClick={() => act(() => setCategoryColor(id, null), "Could not clear colour.")}>
              <Palette className="size-4" /> Clear colour
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => { if (window.confirm(`Delete category “${name}”? Its projects move to Uncategorized.`)) act(() => deleteCategory(id), "Could not delete."); }}>
            <Trash2 className="size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
