"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Search, FolderPlus, X, Tag as TagIcon, MoreVertical, Pencil, Trash2, Palette, LayoutGrid, Inbox,
  GripVertical, FolderInput, CheckSquare, Folder, ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { ProjectSummary, ProjectCategory } from "@/lib/projects";
import { setProjectsCategory } from "@/lib/project-actions";
import { createCategory, renameCategory, deleteCategory, setCategoryColor, reorderCategories } from "@/lib/category-actions";
import { ProjectCard } from "@/components/project-card";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { unwrap } from "@/lib/action-result";

// Rail selection: everything, the projects with no category, or one category (by name — projects store the name).
const ALL = "__all";
const NONE = "__none";
// New categories get the next of these so the rail reads at a glance; the colour can be changed later.
const PALETTE = ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#ca8a04", "#ea580c", "#db2777", "#64748b"];
const SORTS = [
  { key: "edited", label: "Last edited" },
  { key: "created", label: "Newest" },
  { key: "name", label: "Name A–Z" },
  { key: "status", label: "Status" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];
type Drag = { kind: "projects"; ids: string[] } | { kind: "category"; id: string } | null;
type RailItem = { name: string; id: string | null; color: string | null; managed: boolean };

const nameOf = (p: ProjectSummary) => p.titleText?.trim() || p.title;

export function ProjectsBoard({
  projects, categories, initialCategory,
}: {
  projects: ProjectSummary[];
  categories: ProjectCategory[];
  initialCategory?: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [items, setItems] = useState<ProjectSummary[]>(projects);
  const [cats, setCats] = useState<ProjectCategory[]>(categories);
  // Server refreshes replace the optimistic copies (state adjusted during render, not in an effect).
  const [seen, setSeen] = useState({ projects, categories });
  if (seen.projects !== projects || seen.categories !== categories) {
    setSeen({ projects, categories });
    setItems(projects);
    setCats(categories);
  }

  const [picked, setActive] = useState<string>(() => (!initialCategory ? ALL : initialCategory === "uncategorized" ? NONE : initialCategory));
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("edited");
  const [selected, setSelected] = useState<string[]>([]);
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<string | null>(null); // rail row under the pointer
  const [overPos, setOverPos] = useState<"before" | "after">("before"); // category reorder insert point

  const act = (fn: () => Promise<unknown>, err: string) =>
    start(async () => { try { await fn(); router.refresh(); } catch (e) { toast.error((e as Error).message || err); } });

  // Keep the selected category in the URL (shareable, survives reload) without a server round trip.
  function choose(cat: string) {
    setActive(cat);
    setSelected([]);
    const url = new URL(window.location.href);
    if (cat === ALL) url.searchParams.delete("category"); else url.searchParams.set("category", cat === NONE ? "uncategorized" : cat);
    window.history.replaceState(null, "", url);
  }

  // Rail rows: managed categories (ordered), then legacy free-text names still on projects.
  const rail = useMemo<RailItem[]>(() => {
    const known = new Set(cats.map((c) => c.name));
    const legacy = Array.from(new Set(items.map((p) => p.category).filter((c): c is string => !!c && !known.has(c)))).sort();
    return [
      ...cats.map((c) => ({ name: c.name, id: c.id, color: c.color, managed: true })),
      ...legacy.map((name) => ({ name, id: null, color: null, managed: false })),
    ];
  }, [cats, items]);
  const catNames = rail.map((r) => r.name);
  // A category deleted/renamed elsewhere (or a stale ?category=) shows All.
  const active = picked === ALL || picked === NONE || catNames.includes(picked) ? picked : ALL;

  const count = (cat: string) => (cat === ALL ? items.length : items.filter((p) => (cat === NONE ? !p.category : p.category === cat)).length);
  const allTags = useMemo(() => Array.from(new Set(items.flatMap((p) => p.tags))).sort((a, b) => a.localeCompare(b)), [items]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = items.filter((p) => {
      if (active === NONE ? !!p.category : active !== ALL && p.category !== active) return false;
      const mQ = !q || nameOf(p).toLowerCase().includes(q) || p.title.toLowerCase().includes(q)
        || (p.description ?? "").toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q));
      return mQ && activeTags.every((t) => p.tags.includes(t));
    });
    const by: Record<SortKey, (a: ProjectSummary, b: ProjectSummary) => number> = {
      edited: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      created: (a, b) => (b.createdAt ?? b.updatedAt).localeCompare(a.createdAt ?? a.updatedAt),
      name: (a, b) => nameOf(a).localeCompare(nameOf(b)),
      status: (a, b) => a.status.localeCompare(b.status) || b.updatedAt.localeCompare(a.updatedAt),
    };
    return [...list].sort(by[sort]);
  }, [items, active, q, activeTags, sort]);
  const filtering = q.length > 0 || activeTags.length > 0;

  const toggleTag = (t: string) => setActiveTags((c) => (c.includes(t) ? c.filter((x) => x !== t) : [...c, t]));
  const toggleSelect = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  /** Move projects into a category (null = Uncategorized) — optimistic, then confirmed by the server. */
  function moveProjects(ids: string[], target: string | null) {
    const moving = ids.filter((id) => (items.find((p) => p.id === id)?.category ?? null) !== target);
    if (!moving.length) return;
    const before = items;
    setItems((cur) => cur.map((p) => (moving.includes(p.id) ? { ...p, category: target } : p)));
    setSelected([]);
    start(async () => {
      try {
        unwrap(await setProjectsCategory(moving, target));
        toast.success(`Moved ${moving.length === 1 ? "1 video" : `${moving.length} videos`} to ${target ?? "Uncategorized"}`);
        router.refresh();
      } catch { toast.error("Could not move the project."); setItems(before); }
    });
  }

  function dropOn(row: string) {
    const d = drag;
    setDrag(null); setOver(null);
    if (!d) return;
    if (d.kind === "projects") {
      if (row === ALL) return;
      moveProjects(d.ids, row === NONE ? null : row);
      return;
    }
    // Category reorder: insert the dragged one before/after the row it was dropped on.
    const target = cats.find((c) => c.name === row);
    if (!target || target.id === d.id) return;
    const ids = cats.map((c) => c.id).filter((id) => id !== d.id);
    const at = ids.indexOf(target.id) + (overPos === "after" ? 1 : 0);
    ids.splice(at, 0, d.id);
    const before = cats;
    setCats(ids.map((id, i) => ({ ...cats.find((c) => c.id === id)!, sortOrder: i })));
    start(async () => {
      try { unwrap(await reorderCategories(ids)); router.refresh(); }
      catch { toast.error("Could not reorder categories."); setCats(before); }
    });
  }

  // Row drop-target wiring shared by All / Uncategorized / each category.
  const target = (row: string, canDropProjects: boolean, canReorder: boolean) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!drag) return;
      if (drag.kind === "projects" && !canDropProjects) return;
      if (drag.kind === "category" && !canReorder) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(row);
      if (drag.kind === "category") {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setOverPos(e.clientY < r.top + r.height / 2 ? "before" : "after");
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((c) => (c === row ? null : c));
    },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); dropOn(row); },
  });

  const activeItem = rail.find((r) => r.name === active);
  const heading = active === ALL ? "All projects" : active === NONE ? "Uncategorized" : active;
  const draggingProjects = drag?.kind === "projects";

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-[15rem_minmax(0,1fr)]">
      <CategoryRail
        rail={rail} active={active} choose={choose} count={count} busy={busy} act={act}
        drag={drag} setDrag={setDrag} over={over} overPos={overPos} target={target}
        nextColor={PALETTE[cats.length % PALETTE.length]}
      />

      <div className="min-w-0 space-y-4">
        <div className="cw-glass space-y-3 rounded-2xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto flex min-w-0 items-center gap-2 px-1">
              {activeItem?.color ? <span className="size-3 shrink-0 rounded-full" style={{ background: activeItem.color }} /> : null}
              <h2 className="truncate text-base font-semibold">{heading}</h2>
              <span className="text-sm text-muted-foreground">{shown.length}{filtering ? ` of ${count(active)}` : ""}</span>
            </div>
            <div className="relative min-w-48 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, description, tags…"
                aria-label="Search projects"
                className="h-9 w-full rounded-full border border-border bg-card pl-9 pr-9 text-sm outline-none focus:border-primary"
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
              ) : null}
            </div>
            <label className="relative inline-flex h-9 items-center rounded-full border border-border bg-card pl-3 text-sm text-muted-foreground">
              <ArrowUpDown className="size-3.5" />
              <span className="sr-only">Sort by</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-full appearance-none bg-transparent pl-1.5 pr-3 text-foreground outline-none">
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          </div>

          {allTags.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <TagIcon className="size-3.5 text-muted-foreground" />
              {allTags.map((t) => (
                <button key={t} type="button" onClick={() => toggleTag(t)} aria-pressed={activeTags.includes(t)} className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", activeTags.includes(t) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>{t}</button>
              ))}
              {activeTags.length ? <button type="button" onClick={() => setActiveTags([])} className="text-xs text-muted-foreground underline hover:text-foreground">clear</button> : null}
            </div>
          ) : null}
        </div>

        {selected.length ? (
          <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/40 bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
            <CheckSquare className="size-4 text-primary" />
            <span className="text-sm font-medium">{selected.length} selected</span>
            <DropdownMenu>
              <DropdownMenuTrigger render={<button type="button" disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm hover:border-primary hover:text-primary disabled:opacity-60" />}>
                <FolderInput className="size-4" /> Move to
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => moveProjects(selected, null)}><Inbox className="size-4" /> Uncategorized</DropdownMenuItem>
                {rail.map((r) => (
                  <DropdownMenuItem key={r.name} onClick={() => moveProjects(selected, r.name)}>
                    <span className="size-2.5 rounded-full" style={{ background: r.color ?? "var(--muted-foreground)" }} /> {r.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button type="button" onClick={() => setSelected(shown.map((p) => p.id))} className="text-sm text-muted-foreground underline hover:text-foreground">Select all {shown.length}</button>
            <button type="button" onClick={() => setSelected([])} className="ml-auto text-sm text-muted-foreground hover:text-foreground">Clear</button>
            <span className="hidden w-full text-xs text-muted-foreground sm:block">Tip: drag any selected video onto a category on the left to move them all.</span>
          </div>
        ) : null}

        {shown.length === 0 ? (
          <div className="cw-glass rounded-2xl px-6 py-14 text-center text-sm text-muted-foreground">
            {filtering
              ? "No projects match your search."
              : active === ALL
                ? "No projects yet."
                : active === NONE
                  ? "Every project has a category."
                  : <>No videos in <span className="font-medium text-foreground">{active}</span> yet. Drag videos onto it in the list on the left, or set the category in a video&apos;s Properties.</>}
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
            {shown.map((p) => (
              <div
                key={p.id} draggable
                onDragStart={(e) => {
                  // Dragging a selected card carries the whole selection.
                  const ids = selected.includes(p.id) ? selected : [p.id];
                  setDrag({ kind: "projects", ids });
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", ids.length > 1 ? `${ids.length} videos` : nameOf(p));
                }}
                onDragEnd={() => { setDrag(null); setOver(null); }}
                className={cn("cursor-grab active:cursor-grabbing", draggingProjects && drag.ids.includes(p.id) && "opacity-40")}
              >
                <ProjectCard project={p} categories={catNames} selected={selected.includes(p.id)} onToggleSelect={() => toggleSelect(p.id)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryRail({
  rail, active, choose, count, busy, act, drag, setDrag, over, overPos, target, nextColor,
}: {
  rail: RailItem[];
  active: string;
  choose: (cat: string) => void;
  count: (cat: string) => number;
  busy: boolean;
  act: (fn: () => Promise<unknown>, err: string) => void;
  drag: Drag;
  setDrag: (d: Drag) => void;
  over: string | null;
  overPos: "before" | "after";
  target: (row: string, canDropProjects: boolean, canReorder: boolean) => Record<string, (e: React.DragEvent) => void>;
  nextColor: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const draggingProjects = drag?.kind === "projects";

  function add() {
    const name = draft.trim();
    setAdding(false); setDraft("");
    if (!name) return;
    if (rail.some((r) => r.name.toLowerCase() === name.toLowerCase())) { toast.error(`“${name}” already exists.`); return; }
    act(async () => unwrap(await createCategory(name, nextColor)), "Could not create the category.");
  }

  const row = (key: string, label: string, icon: React.ReactNode, opts: { canDrop: boolean }) => (
    <li key={key}>
      <button
        type="button" onClick={() => choose(key)} aria-current={active === key ? "page" : undefined}
        {...target(key, opts.canDrop, false)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
          active === key ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          over === key && draggingProjects && "ring-2 ring-primary",
        )}
      >
        {icon}<span className="flex-1 truncate text-left">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{count(key)}</span>
      </button>
    </li>
  );

  return (
    <aside aria-label="Categories" className="min-w-0 md:sticky md:top-20 md:self-start">
      <div className="cw-glass rounded-2xl p-2">
        <div className="flex items-center justify-between px-2 pb-1 pt-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Categories</span>
          <button type="button" onClick={() => setAdding(true)} disabled={busy} aria-label="New category" title="New category"
            className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-primary disabled:opacity-50">
            <FolderPlus className="size-4" />
          </button>
        </div>
        {/* Phones: a horizontal strip; md+: a vertical rail. */}
        <ul className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
          {row(ALL, "All projects", <LayoutGrid className="size-4 shrink-0" />, { canDrop: false })}
          {row(NONE, "Uncategorized", <Inbox className="size-4 shrink-0" />, { canDrop: true })}
          <li aria-hidden className="mx-2 my-1 hidden border-t border-border md:block" />
          {rail.map((r) => (
            <CategoryRow
              key={r.name} item={r} active={active === r.name} count={count(r.name)} busy={busy} act={act}
              choose={choose} renaming={renaming === r.name} setRenaming={(on) => setRenaming(on ? r.name : null)}
              dropHere={over === r.name && !!drag && (drag.kind === "projects" || drag.id !== r.id)}
              dropKind={drag?.kind ?? null} overPos={overPos}
              dragHandlers={target(r.name, true, r.managed)}
              onReorderStart={r.managed && r.id ? () => setDrag({ kind: "category", id: r.id! }) : undefined}
              onReorderEnd={() => setDrag(null)}
            />
          ))}
          {adding ? (
            <li className="min-w-40 px-1 py-1">
              <input
                autoFocus value={draft} maxLength={60} placeholder="Category name" aria-label="New category name"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") { setAdding(false); setDraft(""); } }}
                onBlur={add}
                className="h-8 w-full rounded-lg border border-primary bg-background px-2.5 text-sm outline-none"
              />
            </li>
          ) : (
            <li className="shrink-0">
              <button type="button" onClick={() => setAdding(true)} disabled={busy}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted/60 hover:text-primary disabled:opacity-50">
                <FolderPlus className="size-4 shrink-0" /> <span className="whitespace-nowrap">New category</span>
              </button>
            </li>
          )}
        </ul>
        {draggingProjects ? (
          <p className="hidden px-2.5 pb-1 pt-2 text-[11px] text-primary md:block">Drop on a category to move {drag.ids.length > 1 ? `${drag.ids.length} videos` : "it"}.</p>
        ) : rail.length === 0 ? (
          <p className="hidden px-2.5 pb-1 pt-2 text-[11px] text-muted-foreground md:block">Create categories to group your videos, then drag videos onto them.</p>
        ) : null}
      </div>
    </aside>
  );
}

function CategoryRow({
  item, active, count, busy, act, choose, renaming, setRenaming, dropHere, dropKind, overPos, dragHandlers, onReorderStart, onReorderEnd,
}: {
  item: RailItem; active: boolean; count: number; busy: boolean;
  act: (fn: () => Promise<unknown>, err: string) => void;
  choose: (cat: string) => void;
  renaming: boolean; setRenaming: (on: boolean) => void;
  dropHere: boolean; dropKind: "projects" | "category" | null; overPos: "before" | "after";
  dragHandlers: Record<string, (e: React.DragEvent) => void>;
  onReorderStart?: () => void; onReorderEnd: () => void;
}) {
  const [name, setName] = useState(item.name);
  const colorRef = useRef<HTMLInputElement>(null);
  const { id } = item;

  function commitRename() {
    setRenaming(false);
    const n = name.trim();
    if (!id || !n || n === item.name) { setName(item.name); return; }
    act(async () => { unwrap(await renameCategory(id, n)); if (active) choose(n); }, "Could not rename.");
  }

  return (
    <li
      {...dragHandlers}
      className={cn(
        "group/row relative flex shrink-0 items-center rounded-lg transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted/60",
        dropHere && dropKind === "projects" && "ring-2 ring-primary",
      )}
    >
      {dropHere && dropKind === "category" ? (
        <span aria-hidden className={cn("absolute inset-x-2 h-0.5 rounded bg-primary", overPos === "before" ? "-top-px" : "-bottom-px")} />
      ) : null}
      {onReorderStart ? (
        <span
          draggable title="Drag to reorder" aria-hidden
          onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", item.name); onReorderStart(); }}
          onDragEnd={onReorderEnd}
          className="hidden cursor-grab pl-1 text-muted-foreground opacity-0 group-hover/row:opacity-100 md:block"
        >
          <GripVertical className="size-3.5" />
        </span>
      ) : <span className="hidden w-[1.125rem] md:block" />}
      {renaming ? (
        <input
          autoFocus value={name} maxLength={60} aria-label="Category name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setName(item.name); setRenaming(false); } }}
          onBlur={commitRename}
          className="m-1 h-7 min-w-0 flex-1 rounded-md border border-primary bg-background px-2 text-sm outline-none"
        />
      ) : (
        <button
          type="button" onClick={() => choose(item.name)} onDoubleClick={() => id && setRenaming(true)}
          aria-current={active ? "page" : undefined}
          title={item.managed ? "Double-click to rename" : "Older category — use its menu to manage it"}
          className={cn("flex min-w-0 flex-1 items-center gap-2 px-1.5 py-2 text-sm", active ? "font-medium text-foreground" : "text-muted-foreground group-hover/row:text-foreground")}
        >
          {item.color
            ? <span className="size-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
            : <Folder className="size-3.5 shrink-0" />}
          <span className={cn("flex-1 truncate text-left", !item.managed && "italic")}>{item.name}</span>
          <span className="text-xs tabular-nums text-muted-foreground group-hover/row:hidden">{count}</span>
        </button>
      )}
      {!renaming ? (
        <>
          <input ref={colorRef} type="color" value={item.color ?? "#7c3aed"} aria-label={`${item.name} colour`} tabIndex={-1}
            onChange={(e) => id && act(async () => unwrap(await setCategoryColor(id, e.target.value)), "Could not set colour.")}
            className="sr-only" />
          <DropdownMenu>
            <DropdownMenuTrigger render={<button type="button" aria-label={`${item.name} options`} disabled={busy} className="mr-1 hidden size-6 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:grid group-hover/row:grid disabled:opacity-50" />}>
              <MoreVertical className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {id ? (
                <>
                  <DropdownMenuItem onClick={() => setRenaming(true)}><Pencil className="size-4" /> Rename</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => colorRef.current?.click()}><Palette className="size-4" /> Change colour…</DropdownMenuItem>
                  {item.color ? (
                    <DropdownMenuItem onClick={() => act(async () => unwrap(await setCategoryColor(id, null)), "Could not clear colour.")}>
                      <Palette className="size-4" /> Clear colour
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => {
                    if (window.confirm(`Delete category “${item.name}”? Its ${count} video${count === 1 ? "" : "s"} move to Uncategorized — no videos are deleted.`))
                      act(async () => { unwrap(await deleteCategory(id)); if (active) choose(ALL); }, "Could not delete.");
                  }}>
                    <Trash2 className="size-4" /> Delete category
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={() => act(async () => unwrap(await createCategory(item.name)), "Could not add the category.")}>
                  <FolderPlus className="size-4" /> Manage this category
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </li>
  );
}
