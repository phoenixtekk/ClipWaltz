"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Film, Image as ImageIcon, GripVertical, ListVideo, Loader2, CheckCircle2, AlertCircle, UploadCloud, Play, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { AssetSummary } from "@/lib/assets";
import { autoSec } from "@/components/clip-inspector";
import { reorderAssets, deleteAsset, setAssetTrim } from "@/lib/asset-actions";
import { uploadProjectFile, isSupported } from "@/lib/upload-client";
import { rotatedFill, rotationParent } from "@/lib/rotation";
import { unwrap } from "@/lib/action-result";

type InsertStatus = "uploading" | "done" | "error";

const PX_PER_SEC = 34;
const isTrimmed = (a: AssetSummary) => a.kind === "video" && a.trimStart != null && a.trimEnd != null;
const isManualTimed = (a: AssetSummary) => a.durationOverride != null || isTrimmed(a);
// Effective screen time: video trim length, else manual override, else the default cadence.
const clipSec = (a: AssetSummary) =>
  isTrimmed(a) ? (a.trimEnd as number) - (a.trimStart as number) : (a.durationOverride ?? autoSec(a));

/**
 * Full-video timeline (#4): clips laid out left→right, widths scaled by their draft duration.
 * Drag a clip to reorder; use the + between clips to insert/upload an image or video at that
 * exact spot. Click a clip to select it — the studio shows its settings in the inspector.
 * Fills the studio's bottom pane (header + scrolling body; the strip scrolls sideways).
 */
export function ProjectTimeline({
  projectId,
  assets,
  selectedId,
  onSelect,
}: {
  projectId: string;
  assets: AssetSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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
  const [trim, setTrim] = useState<{ id: string; side: "start" | "end" } | null>(null);
  // CW-MVP-024: highlight clips with a tag (others dim); null = no filter.
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  // Drag-to-trim on a video block. Video blocks are sized by SOURCE duration (below), so the
  // handle X maps linearly to a source second. Commit on release; a full-range trim clears it.
  function onTrimDown(e: React.PointerEvent, a: AssetSummary, side: "start" | "end") {
    e.stopPropagation();
    e.preventDefault();
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setTrim({ id: a.id, side });
  }
  function onTrimMove(e: React.PointerEvent, a: AssetSummary, side: "start" | "end") {
    if (!trim || trim.id !== a.id) return;
    const dur = a.durationSec ?? 0;
    if (!dur) return;
    const block = (e.currentTarget as HTMLElement).parentElement;
    if (!block) return;
    const rect = block.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = frac * dur;
    const x = order.find((o) => o.id === a.id);
    const cs = x?.trimStart ?? 0;
    const ce = x?.trimEnd ?? dur;
    const start = side === "start" ? Math.max(0, Math.min(t, ce - 0.4)) : cs;
    const end = side === "end" ? Math.min(dur, Math.max(t, cs + 0.4)) : ce;
    setOrder((cur) => cur.map((o) => (o.id === a.id ? { ...o, trimStart: start, trimEnd: end } : o)));
  }
  function onTrimUp(a: AssetSummary) {
    if (!trim || trim.id !== a.id) { setTrim(null); return; }
    setTrim(null);
    const dur = a.durationSec ?? 0;
    const x = order.find((o) => o.id === a.id); // holds the latest dragged values (setOrder above)
    const s = x?.trimStart ?? 0;
    const en = x?.trimEnd ?? dur;
    const full = s <= 0.05 && en >= dur - 0.05;
    setAssetTrim(projectId, a.id, full ? null : s, full ? null : en).then(unwrap)
      .then(() => router.refresh())
      .catch(() => toast.error("Could not trim the clip."));
  }

  // Video blocks are scaled by SOURCE length (so trim handles map to seconds); others by output time.
  // Wider than the strip default so the in/out handles have room to grab and read.
  const SRC_PX = 16;
  const blockWidth = (a: AssetSummary) =>
    a.kind === "video" && a.durationSec
      ? Math.max(180, Math.min(460, a.durationSec * SRC_PX))
      : Math.max(56, clipSec(a) * PX_PER_SEC);
  const trimmable = (a: AssetSummary) =>
    a.kind === "video" && a.uploadState === "uploaded" && !!a.durationSec && (!a.sourceFormat || a.conversionState === "ready");

  // keep local order in sync if the server list changes (add/remove elsewhere, or a clip's settings
  // saved from the inspector: rotation, trim, screen time)
  const sigOf = (list: AssetSummary[]) => list.map((a) => `${a.id}:${a.rotation}:${a.trimStart}:${a.trimEnd}:${a.durationOverride}`).join(",");
  const [sig, setSig] = useState(sigOf(assets));
  const nextSig = sigOf(assets);
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
    reorderAssets(projectId, next.map((a) => a.id)).then(unwrap)
      .then(() => router.refresh())
      .catch(() => toast.error("Could not reorder clips."));
  }

  // Reposition a clip one slot left/right (in addition to drag-reorder).
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  }

  // Populate a video's duration from the browser (the DB doesn't store it), so trim (start/end)
  // shows up. Only fills when currently unknown.
  function setDuration(id: string, sec: number) {
    if (!sec || !Number.isFinite(sec)) return;
    setOrder((cur) => cur.map((a) => (a.id === id && a.durationSec == null ? { ...a, durationSec: Math.round(sec * 10) / 10 } : a)));
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
    deleteAsset(projectId, a.id).then(unwrap)
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
        trimStart: null,
        trimEnd: null,
        rotation: 0,
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
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <ListVideo className="size-3.5 text-[color:var(--cw-violet)]" /> Timeline
        </h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {order.length} clip{order.length === 1 ? "" : "s"} · ~{totalSec}s
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">

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

      {(() => {
        const allTags = [...new Set(order.flatMap((a) => a.tags ?? []))].sort();
        return allTags.length ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Tags:</span>
            {[null, ...allTags].map((t) => (
              <button key={t ?? "__all"} type="button" onClick={() => setTagFilter(t)} aria-pressed={tagFilter === t}
                className={cn("rounded-full border px-2 py-0.5", tagFilter === t ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border text-muted-foreground hover:text-foreground")}>
                {t ?? "All"}
              </button>
            ))}
          </div>
        ) : null;
      })()}

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
                draggable={trim?.id !== a.id}
                onDragStart={(e) => { if (trim) { e.preventDefault(); return; } setDragId(a.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => { setDragId(null); setOverIdx(null); }}
                // Drop ONTO a clip: the cursor's half decides before/after; the gap indicator shows where it lands.
                onDragOver={(e) => {
                  if (dragId == null || dragId === a.id) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setOverIdx(e.clientX > r.left + r.width / 2 ? i + 1 : i);
                }}
                onDrop={(e) => { if (dragId == null) return; e.preventDefault(); onDrop(overIdx ?? i); }}
                onClick={() => onSelect(a.id)}
                style={{ width: blockWidth(a), ...rotationParent(a.rotation) }}
                title={a.tags?.length ? `Tags: ${a.tags.join(", ")}` : undefined}
                className={cn(
                  "group relative h-24 shrink-0 cursor-grab overflow-hidden rounded-md border border-border bg-muted active:cursor-grabbing",
                  selectedId === a.id && "border-[color:var(--cw-violet)] ring-2 ring-[color:var(--cw-violet)]",
                  tagFilter && !(a.tags ?? []).includes(tagFilter) && "opacity-30",
                  dragId === a.id && "opacity-40 ring-2 ring-[color:var(--cw-violet)]",
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
                  <video src={`/api/projects/${projectId}/assets/${a.id}#t=0.1`} muted playsInline preload="metadata" draggable={false} onDragStart={(e) => e.preventDefault()} onLoadedMetadata={(e) => setDuration(a.id, e.currentTarget.duration)} className="pointer-events-none size-full object-cover" style={rotatedFill(a.rotation)} />
                ) : a.uploadState === "uploaded" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/projects/${projectId}/assets/${a.id}`} alt="" draggable={false} onDragStart={(e) => e.preventDefault()} className="pointer-events-none size-full object-cover" style={rotatedFill(a.rotation)} />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    {a.kind === "video" ? <Film className="size-4 text-muted-foreground" /> : <ImageIcon className="size-4 text-muted-foreground" />}
                  </div>
                )}
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">{i + 1}</span>
                {a.stitchedPair ? (
                  <span title="Both Insta360 lens files stitched into one full 360° clip" className="absolute bottom-1 left-1 rounded bg-[color:var(--cw-violet)]/90 px-1 text-[9px] font-semibold text-white">360° ⧉</span>
                ) : null}
                {/* Reposition this clip left / right (also draggable). */}
                <div className="absolute left-1/2 top-1 z-30 flex -translate-x-1/2 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    disabled={i === 0}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); move(i, -1); }}
                    aria-label="Move clip left"
                    className="grid size-5 place-items-center rounded bg-black/70 text-white hover:bg-[color:var(--cw-violet)] disabled:opacity-30"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={i === order.length - 1}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); move(i, 1); }}
                    aria-label="Move clip right"
                    className="grid size-5 place-items-center rounded bg-black/70 text-white hover:bg-[color:var(--cw-violet)] disabled:opacity-30"
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
                <span
                  className={cn(
                    "absolute bottom-1 left-1 rounded px-1 text-[10px] text-white",
                    isManualTimed(a) ? "bg-[color:var(--cw-violet)]/90 font-semibold" : "bg-black/60",
                  )}
                  title={isTrimmed(a) ? "Trimmed" : a.durationOverride != null ? "Manual screen time" : "Auto screen time"}
                >
                  {clipSec(a).toFixed(clipSec(a) % 1 ? 1 : 0)}s{isTrimmed(a) ? " ✂" : ""}
                </span>
                {/* Select this clip (inspector: preview, trim, time, rotate, tag). Clicking anywhere on the
                    clip selects it too; this centered control (NOT a full-cover overlay, so the rest of the
                    surface stays grabbable for drag-to-reorder) is the keyboard-reachable way. */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSelect(a.id); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={`Select ${a.name} to preview and edit`}
                  aria-pressed={selectedId === a.id}
                  className="absolute left-1/2 top-1/2 z-10 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-background/80 opacity-0 backdrop-blur-sm transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Play className="size-3.5 translate-x-0.5 fill-foreground text-foreground" />
                </button>
                {/* Drag-to-trim handles (videos): dim the trimmed-off ends, drag the violet bars. */}
                {trimmable(a) ? (() => {
                  const dur = a.durationSec as number;
                  const sPct = ((a.trimStart ?? 0) / dur) * 100;
                  const ePct = ((a.trimEnd ?? dur) / dur) * 100;
                  const handle = (side: "start" | "end", leftPct: number) => (
                    <div
                      role="slider"
                      aria-label={side === "start" ? "Trim start" : "Trim end"}
                      aria-valuenow={Math.round(side === "start" ? (a.trimStart ?? 0) : (a.trimEnd ?? dur))}
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      onPointerDown={(e) => onTrimDown(e, a, side)}
                      onPointerMove={(e) => onTrimMove(e, a, side)}
                      onPointerUp={() => onTrimUp(a)}
                      title={`Trim ${side} — drag`}
                      className="absolute inset-y-0 z-30 flex w-3 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 data-[on=true]:opacity-100"
                      data-on={isTrimmed(a)}
                      style={{ left: `${leftPct}%` }}
                    >
                      <span className="h-10 w-1 rounded-full bg-[color:var(--cw-violet)] shadow ring-1 ring-white/80" />
                    </div>
                  );
                  return (
                    <>
                      {sPct > 0.5 ? <div className="pointer-events-none absolute inset-y-0 left-0 z-10 bg-black/60" style={{ width: `${sPct}%` }} /> : null}
                      {ePct < 99.5 ? <div className="pointer-events-none absolute inset-y-0 right-0 z-10 bg-black/60" style={{ width: `${100 - ePct}%` }} /> : null}
                      {handle("start", sPct)}
                      {handle("end", ePct)}
                      {/* live in/out readout */}
                      <span
                        className="pointer-events-none absolute left-1/2 top-1 z-30 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-white opacity-0 transition-opacity group-hover:opacity-100 data-[on=true]:opacity-100"
                        data-on={isTrimmed(a) || trim?.id === a.id}
                      >
                        in {(a.trimStart ?? 0).toFixed(1)}s · out {(a.trimEnd ?? dur).toFixed(1)}s
                      </span>
                    </>
                  );
                })() : null}
                <span className="absolute right-0.5 top-0.5 z-20 opacity-0 transition-opacity group-hover:opacity-100">
                  <GripVertical className="size-3.5 text-white/80" />
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); remove(a); }}
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
      <p className="text-xs text-muted-foreground">Drag a clip to reorder · drag a video&apos;s violet in/out handles to set its start &amp; end · click a clip to preview/trim it precisely in the inspector · tap + to insert.</p>
      </div>
    </>
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
