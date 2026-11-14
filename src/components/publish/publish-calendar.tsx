"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, GripVertical, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { unwrap } from "@/lib/action-result";
import { useHydrated } from "@/lib/local-date";
import { reschedulePost } from "@/lib/social/ui-actions";
import type { PostView } from "@/lib/social/ui-types";

const MOVABLE = new Set(["draft", "queued", "scheduled", "failed"]);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function when(p: PostView): Date | null {
  const v = p.status === "scheduled" || p.status === "queued" || p.status === "draft" ? p.scheduledAt ?? p.publishedAt : p.publishedAt ?? p.scheduledAt;
  return v ? new Date(v) : null;
}

/**
 * Month / week calendar of scheduled and published posts. Drag a post that hasn't gone out yet onto another day to
 * move it there (same time of day). Rendered in the viewer's time zone, so only after hydration.
 */
export function PublishCalendar({ posts, anchor }: { posts: PostView[]; anchor: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [view, setView] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(() => new Date(anchor));
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const days = useMemo(() => {
    if (view === "week") {
      const s = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const s = startOfWeek(first);
    const weeks = Math.ceil((first.getDay() + new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => addDays(s, i));
  }, [cursor, view]);

  const byDay = useMemo(() => {
    const m = new Map<string, PostView[]>();
    for (const p of posts) {
      const w = when(p);
      if (!w) continue;
      const k = dayKey(w);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    for (const list of m.values()) list.sort((a, b) => (when(a)?.getTime() ?? 0) - (when(b)?.getTime() ?? 0));
    return m;
  }, [posts]);

  function move(id: string, target: Date) {
    const p = posts.find((x) => x.id === id);
    if (!p) return;
    const old = when(p) ?? new Date(new Date().setHours(9, 0, 0, 0));
    const next = new Date(target.getFullYear(), target.getMonth(), target.getDate(), old.getHours(), old.getMinutes());
    if (dayKey(next) === dayKey(old) && p.status === "scheduled") return;
    start(async () => {
      try {
        unwrap(await reschedulePost(id, next.toISOString()));
        toast.success(`Moved to ${next.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function shift(n: number) {
    setCursor((c) => (view === "week" ? addDays(c, 7 * n) : new Date(c.getFullYear(), c.getMonth() + n, 1)));
  }

  if (!hydrated) return <Skeleton className="h-[32rem] w-full" />;

  const today = dayKey(new Date());
  const title =
    view === "week"
      ? `${days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
      : cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label="Previous" onClick={() => shift(-1)}><ChevronLeft /></Button>
        <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>Today</Button>
        <Button variant="outline" size="icon-sm" aria-label="Next" onClick={() => shift(1)}><ChevronRight /></Button>
        <h2 className="ml-1 text-lg font-semibold">{title}</h2>
        <div className="ml-auto flex items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as "month" | "week")}>
            <TabsList>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
            </TabsList>
          </Tabs>
          <Link href="/publish/compose" className={buttonVariants({ size: "sm" })}><Plus /> New post</Link>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Drag a post that hasn&apos;t gone out onto another day to reschedule it (it keeps its time). The calendar holds posts from 6 weeks back to 4 months ahead.
      </p>
      <div className={cn("grid grid-cols-7 overflow-hidden rounded-xl border border-border", busy && "opacity-70")}>
        {DOW.map((d) => (
          <div key={d} className="border-b border-border bg-muted/50 px-2 py-1 text-xs font-medium text-muted-foreground">{d}</div>
        ))}
        {days.map((d) => {
          const k = dayKey(d);
          const list = byDay.get(k) ?? [];
          const outside = view === "month" && d.getMonth() !== cursor.getMonth();
          const past = d < new Date(new Date().setHours(0, 0, 0, 0));
          return (
            <div
              key={k}
              onDragOver={(e) => {
                if (!dragging || past) return;
                e.preventDefault();
                setOver(k);
              }}
              onDragLeave={() => setOver((o) => (o === k ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/plain");
                setDragging(null);
                if (id && !past) move(id, d);
              }}
              className={cn(
                "space-y-1 border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0",
                view === "week" ? "min-h-72" : "min-h-28",
                outside && "bg-muted/30 text-muted-foreground",
                over === k && "bg-primary/10 ring-2 ring-primary ring-inset",
              )}
            >
              <div className={cn("text-xs", k === today && "inline-grid size-5 place-items-center rounded-full bg-primary font-semibold text-primary-foreground")}>
                {d.getDate()}
              </div>
              {list.map((p) => {
                const t = when(p);
                const movable = MOVABLE.has(p.status);
                return (
                  <div
                    key={p.id}
                    draggable={movable}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", p.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(p.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={cn(
                      "group flex items-start gap-1 rounded-md border px-1.5 py-1 text-xs",
                      p.status === "published" ? "border-emerald-600/30 bg-emerald-600/10"
                        : p.status === "failed" || p.status === "partial" ? "border-destructive/30 bg-destructive/10"
                        : "border-primary/30 bg-primary/10",
                      movable && "cursor-grab active:cursor-grabbing",
                    )}
                    title={p.text}
                  >
                    {movable ? <GripVertical className="mt-0.5 size-3 shrink-0 text-muted-foreground" /> : null}
                    <Link href={movable ? `/publish/compose?post=${p.id}` : "/publish/posts"} className="min-w-0 flex-1">
                      <span className="font-medium tabular-nums">{t?.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>{" "}
                      <span className="line-clamp-2">{p.text}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{p.destinations.map((x) => x.label).join(", ")}</span>
                    </Link>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
