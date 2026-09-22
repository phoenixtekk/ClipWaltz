"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderInput, FolderOutput, FolderCheck, Play, Pause, Trash2, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BatchSummary } from "@/lib/batch";
import { createBatch, setBatchStatus, deleteBatch } from "@/lib/batch-actions";

const STATUS: Record<string, string> = {
  active: "text-emerald-700 border-emerald-600/40 bg-emerald-600/10 dark:text-emerald-400",
  paused: "text-amber-700 border-amber-500/40 bg-amber-500/10 dark:text-amber-400",
  done: "text-muted-foreground border-border bg-background/80",
};

export function BatchManager({
  batches,
  presets,
  tracks,
}: {
  batches: BatchSummary[];
  presets: { id: string; name: string }[];
  tracks: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(batches.length === 0);
  const [f, setF] = useState({
    name: "",
    inboxPath: "",
    outputPath: "",
    donePath: "",
    grouping: "subfolder" as "subfolder" | "whole" | "file",
    scheduleMinutes: "0",
    presetId: "",
    musicTrackId: "",
    describe: false,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((c) => ({ ...c, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  function create() {
    start(async () => {
      try {
        await createBatch({
          name: f.name,
          inboxPath: f.inboxPath,
          outputPath: f.outputPath,
          donePath: f.donePath,
          grouping: f.grouping,
          scheduleMinutes: Number(f.scheduleMinutes) || 0,
          presetId: f.presetId || null,
          musicTrackId: f.musicTrackId || null,
          describe: f.describe,
        });
        toast.success("Batch created — the worker will start it shortly.");
        setF((c) => ({ ...c, name: "", inboxPath: "", outputPath: "", donePath: "" }));
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not create the batch.");
      }
    });
  }
  const act = (fn: () => Promise<unknown>, err: string) =>
    start(async () => { try { await fn(); router.refresh(); } catch (e) { toast.error((e as Error).message || err); } });

  return (
    <div className="space-y-5">
      {/* Create */}
      <div className="cw-glass rounded-2xl p-4">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
          <span className="flex items-center gap-2 text-sm font-semibold"><Plus className="size-4 text-[color:var(--cw-violet)]" /> New auto-batch</span>
          <span className="text-xs text-muted-foreground">{open ? "hide" : "show"}</span>
        </button>
        {open ? (
          <div className="mt-3 space-y-3">
            <Field label="Name"><Input value={f.name} onChange={set("name")} placeholder="e.g. Lake trips" /></Field>
            <Field label="Input folder (on the worker host)" icon={<FolderInput className="size-4" />}>
              <Input value={f.inboxPath} onChange={set("inboxPath")} placeholder="/home/lacy/clipwaltz/batch/laketrips/inbox" />
            </Field>
            <Field label="Output folder (finished MP4 + description)" icon={<FolderOutput className="size-4" />}>
              <Input value={f.outputPath} onChange={set("outputPath")} placeholder="/home/lacy/clipwaltz/batch/laketrips/output" />
            </Field>
            <Field label="Done folder (sources moved here after render)" icon={<FolderCheck className="size-4" />}>
              <Input value={f.donePath} onChange={set("donePath")} placeholder="/home/lacy/clipwaltz/batch/laketrips/done" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Group by">
                <select value={f.grouping} onChange={set("grouping")} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                  <option value="subfolder">Each subfolder → 1 video</option>
                  <option value="whole">All loose files → 1 video</option>
                  <option value="file">Each file → 1 video</option>
                </select>
              </Field>
              <Field label="Schedule (min between videos)">
                <Input type="number" min={0} value={f.scheduleMinutes} onChange={set("scheduleMinutes")} placeholder="0 = as fast as possible" />
              </Field>
              <Field label="Style preset">
                <select value={f.presetId} onChange={set("presetId")} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                  <option value="">Defaults</option>
                  {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Music (optional)">
                <select value={f.musicTrackId} onChange={set("musicTrackId")} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                  <option value="">Auto (first track)</option>
                  {tracks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </Field>
              <label className="flex items-center gap-2 self-end pb-1 text-sm text-muted-foreground">
                <input type="checkbox" checked={f.describe} onChange={set("describe")} /> Generate ready-to-post description (.txt)
              </label>
            </div>
            <div className="flex justify-end">
              <Button onClick={create} disabled={pending || !f.name || !f.inboxPath || !f.outputPath || !f.donePath}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null} Create batch
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Folders are absolute paths on the render host (the AI box). Drop media into the input folder (subfolders for
              <code className="mx-1">subfolder</code> mode). The worker renders each group, writes the MP4 (+ description) to the
              output folder, moves the sources to the done folder, and stops when the input is empty.
            </p>
          </div>
        ) : null}
      </div>

      {/* List */}
      {batches.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No batches yet. Create one above.</p>
      ) : (
        batches.map((b) => (
          <div key={b.id} className="cw-glass space-y-2 rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{b.name}</h3>
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", STATUS[b.status] ?? STATUS.done)}>{b.status}</span>
                <span className="text-xs text-muted-foreground">
                  {b.counts.done} done · {b.counts.queued + b.counts.rendering} in progress{b.counts.failed ? ` · ${b.counts.failed} failed` : ""}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {b.status !== "paused" ? (
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => setBatchStatus(b.id, "paused"), "Could not pause.")}><Pause className="size-4" /> Pause</Button>
                ) : (
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => setBatchStatus(b.id, "active"), "Could not resume.")}><Play className="size-4" /> Resume</Button>
                )}
                {b.status === "done" ? (
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => setBatchStatus(b.id, "active"), "Could not rescan.")}><Play className="size-4" /> Rescan</Button>
                ) : null}
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={pending}
                  onClick={() => { if (window.confirm(`Delete batch “${b.name}”? (Files are not touched.)`)) act(() => deleteBatch(b.id), "Could not delete."); }}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
            <div className="grid gap-1 text-xs text-muted-foreground">
              <span className="truncate"><FolderInput className="mr-1 inline size-3.5" />{b.inboxPath}</span>
              <span className="truncate"><FolderOutput className="mr-1 inline size-3.5" />{b.outputPath}</span>
              <span className="truncate"><FolderCheck className="mr-1 inline size-3.5" />{b.donePath}</span>
              <span>Group: {b.grouping} · Schedule: {b.scheduleMinutes ? `${b.scheduleMinutes} min` : "as fast as possible"}{b.lastRunAt ? ` · last run ${new Date(b.lastRunAt).toLocaleString()}` : ""}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{icon} {label}</label>
      {children}
    </div>
  );
}
