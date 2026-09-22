"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, FolderPlus, X, Tag as TagIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { ProjectSummary } from "@/lib/projects";
import { setProjectCategory } from "@/lib/project-actions";
import { ProjectCard } from "@/components/project-card";

const UNCATEGORIZED = "Uncategorized";
const LS_KEY = "cw-project-categories"; // extra (possibly empty) categories the user created

export function ProjectsBoard({ projects }: { projects: ProjectSummary[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [items, setItems] = useState<ProjectSummary[]>(() => projects);
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [extraCats, setExtraCats] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCat, setOverCat] = useState<string | null>(null);

  // Load user-created (possibly empty) categories from localStorage — deferred so it doesn't
  // run during SSR/hydration or trip the cascading-render lint.
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) setExtraCats(JSON.parse(raw));
      } catch { /* ignore */ }
    });
  }, []);
  const rememberCats = (cats: string[]) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cats)); } catch { /* ignore */ }
  };

  // All tags across projects, for the filter row.
  const allTags = useMemo(
    () => Array.from(new Set(items.flatMap((p) => p.tags))).sort((a, b) => a.localeCompare(b)),
    [items],
  );

  // Categories to show: those in use + user-created empties, Uncategorized last.
  const categories = useMemo(() => {
    const used = new Set(items.map((p) => p.category).filter((c): c is string => !!c));
    const named = Array.from(new Set([...used, ...extraCats])).sort((a, b) => a.localeCompare(b));
    return [...named, UNCATEGORIZED];
  }, [items, extraCats]);
  const namedCategories = categories.filter((c) => c !== UNCATEGORIZED);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      items.filter((p) => {
        const name = (p.titleText?.trim() || p.title).toLowerCase();
        const matchesQuery =
          !q || name.includes(q) || p.title.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q));
        const matchesTags = activeTags.every((t) => p.tags.includes(t));
        return matchesQuery && matchesTags;
      }),
    [items, q, activeTags],
  );
  const filtering = q.length > 0 || activeTags.length > 0;

  const byCat = (cat: string) =>
    filtered.filter((p) => (cat === UNCATEGORIZED ? !p.category : p.category === cat));

  function toggleTag(t: string) {
    setActiveTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  function addCategory() {
    const name = window.prompt("New category name:");
    const c = name?.trim();
    if (!c || c === UNCATEGORIZED) return;
    if (!categories.includes(c)) {
      const next = Array.from(new Set([...extraCats, c]));
      setExtraCats(next);
      rememberCats(next);
    }
  }

  function drop(cat: string) {
    const id = dragId;
    setDragId(null);
    setOverCat(null);
    if (!id) return;
    const target = cat === UNCATEGORIZED ? null : cat;
    const current = items.find((p) => p.id === id)?.category ?? null;
    if (current === target) return;
    setItems((cur) => cur.map((p) => (p.id === id ? { ...p, category: target } : p))); // optimistic
    start(async () => {
      try {
        await setProjectCategory(id, target);
        router.refresh();
      } catch {
        toast.error("Could not move the project.");
        setItems(projects); // revert
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Search + new category */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects and tags…"
            className="h-10 w-full rounded-full border border-border bg-card pl-9 pr-9 text-sm outline-none focus:border-primary"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <button type="button" onClick={addCategory} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-sm font-medium hover:border-primary hover:text-primary">
          <FolderPlus className="size-4" /> New category
        </button>
      </div>

      {/* Tag filter row */}
      {allTags.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <TagIcon className="size-3.5 text-muted-foreground" />
          {allTags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleTag(t)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                activeTags.includes(t) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
          {activeTags.length ? (
            <button type="button" onClick={() => setActiveTags([])} className="text-xs text-muted-foreground underline hover:text-foreground">
              clear
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Category sections (drop targets) */}
      {categories.map((cat) => {
        const list = byCat(cat);
        if (filtering && list.length === 0) return null; // hide empties while searching/filtering
        return (
          <section
            key={cat}
            onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverCat(cat); } }}
            onDragLeave={() => setOverCat((c) => (c === cat ? null : c))}
            onDrop={() => drop(cat)}
            className={cn(
              "rounded-2xl border p-3 transition-colors",
              overCat === cat ? "border-primary bg-primary/5" : "border-transparent",
            )}
          >
            <div className="mb-2 flex items-center gap-2 px-1">
              <h2 className="text-sm font-semibold">{cat}</h2>
              <span className="text-xs text-muted-foreground">{list.length}</span>
              {dragId ? <span className="text-[11px] text-primary">drop here</span> : null}
            </div>
            {list.length === 0 ? (
              <p className="px-1 py-4 text-xs text-muted-foreground">
                {cat === UNCATEGORIZED ? "No uncategorized projects." : "Drag projects here."}
              </p>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
                {list.map((p) => (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDragId(null); setOverCat(null); }}
                    className={cn("cursor-grab active:cursor-grabbing", dragId === p.id && "opacity-40")}
                  >
                    <ProjectCard project={p} categories={namedCategories} />
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {filtering && filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No projects match your search.</p>
      ) : null}
    </div>
  );
}
