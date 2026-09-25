"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Clapperboard, Film, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  listScenes, addScene, updateScene, deleteScene, reorderScenes, setSceneVersion, assembleScenes, type SceneItem,
} from "@/lib/scene-actions";

const inputCls = "h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-[color:var(--cw-violet)]";

/**
 * CW-MVP-160..162 storyboard: ordered scenes, each with a target length and a picked version;
 * Assemble joins them into one new version. `selectedVersion` is the version shown in the preview.
 */
export function ScenesPanel({
  projectId, selectedVersion, onAssembleStarted,
}: {
  projectId: string;
  selectedVersion: { id: string; versionNumber: number } | null;
  onAssembleStarted: (jobId: string) => void;
}) {
  const [scenes, setScenes] = useState<SceneItem[]>([]);
  const [title, setTitle] = useState("");
  const [secs, setSecs] = useState("5");
  const [pending, start] = useTransition();

  const refresh = useCallback(() => listScenes(projectId).then(setScenes, () => {}), [projectId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = (fn: () => Promise<unknown>, ok?: string) =>
    start(async () => {
      try { await fn(); await refresh(); if (ok) toast.success(ok); }
      catch (e) { toast.error((e as Error).message || "Something went wrong."); }
    });

  function move(i: number, d: -1 | 1) {
    const ids = scenes.map((s) => s.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setScenes((cur) => { const c = [...cur]; [c[i], c[j]] = [c[j], c[i]]; return c; }); // optimistic
    run(() => reorderScenes(projectId, ids));
  }

  const picked = scenes.filter((s) => s.selectedVersionId).length;

  return (
    <section className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clapperboard className="size-4 text-[color:var(--cw-violet)]" />
          <h3 className="text-sm font-semibold">Scenes</h3>
          <span className="text-xs text-muted-foreground">Plan shots in order, pick a version for each, then assemble.</span>
        </div>
        <Button size="sm" disabled={pending || picked < 2}
          title={picked < 2 ? "Pick a version for at least two scenes" : "Join the picked versions into one video"}
          onClick={() => start(async () => {
            try { const id = await assembleScenes(projectId); onAssembleStarted(id); toast.message("Assembling your storyboard…"); }
            catch (e) { toast.error((e as Error).message || "Could not assemble."); }
          })}>
          <Film className="size-3.5" /> Assemble ({picked})
        </Button>
      </div>

      {scenes.length ? (
        <ol className="space-y-1.5">
          {scenes.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/50 px-2 py-1.5">
              <span className="w-5 text-center text-xs font-semibold text-muted-foreground">{i + 1}</span>
              <input defaultValue={s.title} maxLength={80} aria-label="Scene title" className={`${inputCls} min-w-40 flex-1`}
                onBlur={(e) => { if (e.target.value.trim() !== s.title) run(() => updateScene(projectId, s.id, { title: e.target.value })); }} />
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="number" min={1} max={30} step={0.5} defaultValue={s.durationTarget ?? ""} placeholder="full" aria-label="Scene length (seconds)" className={`${inputCls} w-16`}
                  onBlur={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    if (v !== s.durationTarget) run(() => updateScene(projectId, s.id, { durationTarget: v }));
                  }} />
                s
              </label>
              {s.selectedVersionId ? (
                <button type="button" onClick={() => run(() => setSceneVersion(projectId, s.id, null))} title="Clear the picked version"
                  className="rounded-full border border-[color:var(--cw-violet)]/50 bg-[color:var(--cw-violet)]/10 px-2 py-0.5 text-xs">
                  v{s.selectedVersionNumber} ✕
                </button>
              ) : null}
              {selectedVersion && selectedVersion.id !== s.selectedVersionId ? (
                <button type="button" disabled={pending} onClick={() => run(() => setSceneVersion(projectId, s.id, selectedVersion.id), `Scene ${i + 1} uses v${selectedVersion.versionNumber}.`)}
                  className="rounded-full border border-border px-2 py-0.5 text-xs hover:border-[color:var(--cw-violet)] hover:text-[color:var(--cw-violet)]">
                  Use v{selectedVersion.versionNumber}
                </button>
              ) : null}
              <div className="ml-auto flex items-center">
                <Button variant="ghost" size="sm" disabled={pending || i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="size-3.5" /></Button>
                <Button variant="ghost" size="sm" disabled={pending || i === scenes.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="size-3.5" /></Button>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => deleteScene(projectId, s.id))} aria-label="Delete scene"><Trash2 className="size-3.5" /></Button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">No scenes yet. Add one per shot of your story.</p>
      )}

      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim() || `Scene ${scenes.length + 1}`;
        run(async () => { await addScene(projectId, t, secs === "" ? null : Number(secs)); setTitle(""); });
      }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Scene ${scenes.length + 1} — e.g. "Opening wide shot"`} maxLength={80} className={`${inputCls} min-w-48 flex-1`} />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input type="number" min={1} max={30} step={0.5} value={secs} onChange={(e) => setSecs(e.target.value)} className={`${inputCls} w-16`} aria-label="New scene length (seconds)" /> s
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={pending}><Plus className="size-3.5" /> Add scene</Button>
      </form>
    </section>
  );
}
