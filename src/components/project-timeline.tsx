"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Film, Image as ImageIcon, GripVertical, ListVideo, Loader2, CheckCircle2, AlertCircle, UploadCloud, Clock, Play } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { AssetSummary } from "@/lib/assets";
import { reorderAssets, deleteAsset, setAssetDuration } from "@/lib/asset-actions";
import { uploadProjectFile, isSupported } from "@/lib/upload-client";

type InsertStatus = "uploading" | "done" | "error";

const PX_PER_SEC = 34;
const PHOTO_SEC = 2;
const VIDEO_SEC = 4;
const autoSec = (a: AssetSummary) => (a.kind === "video" ? VIDEO_SEC : PHOTO_SEC);
// Effective screen time = manual override, else the default cadence. Drives the timeline widths.
const clipSec = (a: AssetSummary) => a.durationOverride ?? autoSec(a);

/**
 * Full-video timeline (#4): clips laid out left→right, widths scaled by their draft duration.
 * Drag a clip to reorder; use the + between clips to insert/upload an image or video at that
 * exact spot. Complements the detailed clip list.
 */
export function ProjectTimeline({
  projectId,
  assets,
}: {
  projectId: string;
  assets: AssetSummary[];
}) {
  const router = useRouter();
  const [order, setOrder] = useState<AssetSummary[]>(assets);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [status, setStatus] = useState<InsertStatus | null>(null);
  const [statusName, setStatusName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clip, setClip] = useState<AssetSummary | null>(null); // clip open in the preview/duration modal

  // keep local order in sync if the server list changes length (add/remove elsewhere)
  const [sig, setSig] = useState(assets.map((a) => a.id).join(","));
  const nextSig = assets.map((a) => a.id).join(",");
  if (nextSig !== sig) {
    setSig(nextSig);
    setOrder(assets);
  }

  const totalSec = order.reduce((s, a) => s + clipSec(a), 0);

  // While any 360 clip is converting, refresh periodically so it flips to ready on its own.
  useEffect(() => {
    const converting = assets.some((a) => a.sourceFormat && a.conversionState !== "ready" && a.conversionState !== "failed");
    if (!converting) return;
    const t = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(t);
  }, [assets, router]);

  function commit(next: AssetSummary[]) {
    setOrder(next);
    reorderAssets(projectId, next.map((a) => a.id))
      .then(() => router.refresh())
      .catch(() => toast.error("Could not reorder clips."));
  }

  function onDrop(targetIdx: number) {
    if (dragId == null) return;
    const from = order.findIndex((a) => a.id === dragId);
    if (from < 0) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    const to = from < targetIdx ? targetIdx - 1 : targetIdx;
    next.splice(to, 0, moved);
    setDragId(null);
    setOverIdx(null);
    commit(next);
  }

  function remove(a: AssetSummary) {
    if (!window.confirm(`Remove "${a.name}" from the timeline?`)) return;
    const next = order.filter((x) => x.id !== a.id);
    setOrder(next);
    deleteAsset(projectId, a.id)
      .then(() => router.refresh())
      .catch(() => toast.error("Could not remove the clip."));
  }

  function openInsert(idx: number) {
    setInsertAt(idx);
    fileRef.current?.click();
  }

  async function onFilePicked(file: File | undefined) {
    if (!file || insertAt == null) return;
    const idx = insertAt;
    if (!isSupported(file)) {
      toast.error("Choose an image, video, or Insta360 file (.insv/.lrv/.insp).");
      setInsertAt(null);
      return;
    }
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    setStatusName(file.name);
    setStatus("uploading");
    setUploadPct(0);
    try {
      const res = await uploadProjectFile(projectId, file, (pct) => setUploadPct(pct));
      const inserted: AssetSummary = {
        id: res.id,
        name: file.name,
        kind: res.kind,
        uploadState: "uploaded",
        orderIndex: idx,
        sourceFormat: res.sourceFormat ?? null,
        conversionState: res.conversionState ?? "ready",
        durationSec: null,
        durationOverride: null,
      };
      const next = [...order];
      next.splice(idx, 0, inserted);
      commit(next);
      setUploadPct(100);
      setStatus("done");
      toast.success(`Inserted ${file.name}`);
      // auto-dismiss the success banner after a few seconds
      clearTimerRef.current = setTimeout(() => {
        setStatus(null);
        setStatusName(null);
        setUploadPct(null);
      }, 4000);
    } catch (err) {
      setStatus("error");
      setUploadPct(null);
      toast.error(`Insert failed: ${file.name}${err instanceof Error ? ` — ${err.message}` : ""}`);
    } finally {
      setInsertAt(null);
    }
  }

  function dismissStatus() {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    setStatus(null);
    setStatusName(null);
    setUploadPct(null);
  }

  return (
    <section className="cw-glass space-y-2 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <ListVideo className="size-4 text-[color:var(--cw-violet)]" /> Timeline
        </h2>
        <span className="text-xs text-muted-foreground">
          {order.length} clip{order.length === 1 ? "" : "s"} · ~{totalSec}s
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*,.insv,.lrv,.insp"
        hidden
        onChange={(e) => {
          onFilePicked(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {status && (
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm",
            status === "uploading" && "border-[color:var(--cw-violet)]/40 bg-[color:var(--cw-violet)]/10",
            status === "done" && "border-emerald-500/40 bg-emerald-500/10",
            status === "error" && "border-destructive/40 bg-destructive/10",
          )}
          role="status"
          aria-live="polite"
        >
          {status === "uploading" ? (
            <UploadCloud className="size-4 shrink-0 animate-pulse text-[color:var(--cw-violet)]" />
          ) : status === "done" ? (
            <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
          ) : (
            <AlertCircle className="size-4 shrink-0 text-destructive" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">
                {status === "uploading"
                  ? `Inserting ${statusName ?? "clip"}…`
                  : status === "done"
                    ? `Inserted ${statusName ?? "clip"} ✓`
                    : `Insert failed${statusName ? `: ${statusName}` : ""}`}
              </span>
              <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                {status === "uploading" && uploadPct != null ? `${uploadPct}%` : status === "error" ? "Tap + to retry" : ""}
              </span>
            </div>
            {status === "uploading" && (
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[color:var(--cw-violet)] transition-[width] duration-200"
                  style={{ width: `${uploadPct ?? 0}%` }}
                />
              </div>
            )}
          </div>
          {status !== "uploading" && (
            <button
              type="button"
              onClick={dismissStatus}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}

      {order.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4">
          <InsertButton onClick={() => openInsert(0)} busy={status === "uploading"} pct={uploadPct} />
          <span className="text-sm text-muted-foreground">Insert your first clip.</span>
        </div>
      ) : (
        <div className="flex items-stretch gap-1 overflow-x-auto pb-2">
          <Insert idx={0} overIdx={overIdx} setOverIdx={setOverIdx} onDropClip={onDrop} onInsert={openInsert} busy={status === "uploading"} pct={uploadPct} />
          {order.map((a, i) => (
            <div key={a.id} className="flex items-stretch gap-1">
              <div
                draggable
                onDragStart={() => setDragId(a.id)}
                onDragEnd={() => { setDragId(null); setOverIdx(null); }}
                style={{ width: Math.max(56, clipSec(a) * PX_PER_SEC) }}
                className={cn(
                  "group relative h-20 shrink-0 cursor-grab overflow-hidden rounded-md border border-border bg-muted active:cursor-grabbing",
                  dragId === a.id && "opacity-40",
                )}
              >
                {a.sourceFormat && a.conversionState !== "ready" && a.conversionState !== "failed" ? (
                  <div className="flex size-full flex-col items-center justify-center gap-0.5 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin text-[color:var(--cw-violet)]" />
                    <span className="text-[8px] font-semibold">360…</span>
                  </div>
                ) : a.conversionState === "failed" ? (
                  <div className="flex size-full items-center justify-center text-[9px] font-semibold text-destructive">360 ✕</div>
                ) : a.uploadState === "uploaded" && a.kind === "video" ? (
                  <video src={`/api/projects/${projectId}/assets/${a.id}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
                ) : a.uploadState === "uploaded" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/projects/${projectId}/assets/${a.id}`} alt="" className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    {a.kind === "video" ? <Film className="size-4 text-muted-foreground" /> : <ImageIcon className="size-4 text-muted-foreground" />}
                  </div>
                )}
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">{i + 1}</span>
                <span
                  className={cn(
                    "absolute bottom-1 left-1 rounded px-1 text-[10px] text-white",
                    a.durationOverride != null ? "bg-[color:var(--cw-violet)]/90 font-semibold" : "bg-black/60",
                  )}
                  title={a.durationOverride != null ? "Manual screen time" : "Auto screen time"}
                >
                  {clipSec(a)}s
                </span>
                {/* Preview this specific clip + set its duration */}
                <button
                  type="button"
                  onClick={() => setClip(a)}
                  aria-label={`Preview and time ${a.name}`}
                  className="absolute inset-0 z-10 grid place-items-center bg-black/0 opacity-0 transition-opacity hover:bg-black/30 group-hover:opacity-100"
                >
                  <span className="grid size-7 place-items-center rounded-full bg-background/80 backdrop-blur-sm">
                    <Play className="size-3.5 translate-x-0.5 fill-foreground text-foreground" />
                  </span>
                </button>
                <span className="absolute right-0.5 top-0.5 z-20 opacity-0 transition-opacity group-hover:opacity-100">
                  <GripVertical className="size-3.5 text-white/80" />
                </span>
                <button
                  type="button"
                  onClick={() => remove(a)}
                  aria-label={`Remove ${a.name}`}
                  className="absolute bottom-0.5 right-0.5 z-20 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </div>
              <Insert idx={i + 1} overIdx={overIdx} setOverIdx={setOverIdx} onDropClip={onDrop} onInsert={openInsert} busy={status === "uploading"} pct={uploadPct} />
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Drag a clip to reorder · tap a clip to preview it &amp; set its screen time · tap + to insert a clip at that spot.</p>
      {clip ? (
        <ClipModal
          key={clip.id}
          projectId={projectId}
          asset={clip}
          onClose={() => setClip(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </section>
  );
}

/** Preview one specific clip (play/scrub) and set its manual screen time. */
function ClipModal({
  projectId,
  asset,
  onClose,
  onSaved,
}: {
  projectId: string;
  asset: AssetSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isVideo = asset.kind === "video";
  const srcMax = isVideo && asset.durationSec ? Math.min(60, asset.durationSec) : 60;
  const [manual, setManual] = useState(asset.durationOverride != null);
  const [secs, setSecs] = useState(asset.durationOverride ?? autoSec(asset));
  const [saving, setSaving] = useState(false);
  const src = `/api/projects/${projectId}/assets/${asset.id}`;

  async function save() {
    setSaving(true);
    try {
      await setAssetDuration(projectId, asset.id, manual ? secs : null);
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not save the clip time.");
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Clip ${asset.name}`} onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg space-y-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold">{asset.name}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-muted-foreground hover:text-foreground"><X className="size-5" /></button>
        </div>
        <div className="overflow-hidden rounded-lg bg-black">
          {isVideo ? (
            <video src={src} controls autoPlay playsInline className="max-h-[55vh] w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={asset.name} className="max-h-[55vh] w-full object-contain" />
          )}
        </div>
        {isVideo && asset.durationSec ? (
          <p className="text-xs text-muted-foreground">Source clip is {asset.durationSec.toFixed(1)}s long.</p>
        ) : null}
        <div className="space-y-2 rounded-lg border border-border bg-background/50 p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
            <Clock className="size-4 text-[color:var(--cw-violet)]" /> Set screen time manually
          </label>
          {manual ? (
            <div className="flex items-center gap-3">
              <input type="range" min={0.4} max={srcMax} step={0.1} value={Math.min(secs, srcMax)} onChange={(e) => setSecs(Number(e.target.value))} className="flex-1" />
              <input type="number" min={0.4} max={srcMax} step={0.1} value={secs} onChange={(e) => setSecs(Number(e.target.value))} className="h-8 w-20 rounded-md border border-border bg-background px-2 text-center text-sm" />
              <span className="text-xs text-muted-foreground">sec</span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Auto — ClipWaltz picks the time from the beat/length ({autoSec(asset)}s baseline).</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

function Insert({
  idx,
  overIdx,
  setOverIdx,
  onDropClip,
  onInsert,
  busy,
  pct,
}: {
  idx: number;
  overIdx: number | null;
  setOverIdx: React.Dispatch<React.SetStateAction<number | null>>;
  onDropClip: (idx: number) => void;
  onInsert: (idx: number) => void;
  busy: boolean;
  pct: number | null;
}) {
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOverIdx(idx); }}
      onDragLeave={() => setOverIdx((cur) => (cur === idx ? null : cur))}
      onDrop={(e) => { e.preventDefault(); onDropClip(idx); }}
      className={cn(
        "flex w-6 shrink-0 items-center justify-center rounded transition-colors",
        overIdx === idx ? "bg-primary/30" : "",
      )}
    >
      <InsertButton onClick={() => onInsert(idx)} busy={busy} pct={pct} />
    </div>
  );
}

function InsertButton({ onClick, busy, pct }: { onClick: () => void; busy: boolean; pct: number | null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label="Insert clip here"
      className="grid size-6 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
    >
      {busy ? (
        pct != null ? <span className="text-[8px] font-semibold">{pct}</span> : <Loader2 className="size-3 animate-spin" />
      ) : (
        <Plus className="size-3.5" />
      )}
    </button>
  );
}
