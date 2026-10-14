"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Loader2, RefreshCw, Sparkles, Trash2, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { unwrap } from "@/lib/action-result";
import {
  adminBuildActor, adminCreateActor, adminCreateAiPresenter, adminDeleteLibraryPresenter, adminListLibrary, adminMoreFaces, adminPickFace,
  adminSetPublished, type LibraryPresenter,
} from "@/lib/presenter-library-actions";
import { FOOTAGE_MAX_BYTES } from "@/lib/presenters";
import { VOICES } from "@/lib/deck/types";
import { uploadWithProgress } from "@/lib/upload-progress";

const inputCls = "h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary";
const busy = (s: string) => s === "queued" || s === "preparing";

/** /admin/avatars — the presenter library: AI presenters (generate → pick a face → build) and licensed actors. */
export function AdminAvatars({ initial }: { initial: LibraryPresenter[] }) {
  const [items, setItems] = useState(initial);
  const refresh = useCallback(async () => {
    const r = await adminListLibrary();
    if (r.ok) setItems(r.data);
  }, []);
  useEffect(() => {
    if (!items.some((p) => busy(p.status))) return;
    const t = setInterval(() => void refresh(), 6000);
    return () => clearInterval(t);
  }, [items, refresh]);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <NewAi onDone={refresh} />
        <NewActor onDone={refresh} />
      </div>
      <div className="space-y-3">
        {items.length === 0 ? <p className="text-sm text-muted-foreground">No library presenters yet.</p> : null}
        {items.map((p) => <LibraryCard key={p.id} p={p} onChanged={refresh} />)}
      </div>
    </div>
  );
}

function VoiceSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, "text-xs")} aria-label="Voice">
      {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
    </select>
  );
}

function NewAi({ onDone }: { onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [voice, setVoice] = useState("af_heart");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-xl border border-border p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4" /> New AI presenter</h2>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Name, e.g. Maya" className={cn(inputCls, "w-full")} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={3}
        placeholder="How they look, e.g. a friendly woman in her thirties with curly dark hair, wearing a navy blazer"
        className="w-full rounded-md border border-border bg-background p-2 text-sm outline-none focus:border-primary" />
      <div className="flex flex-wrap items-center gap-2">
        <VoiceSelect value={voice} onChange={setVoice} />
        <Button size="sm" disabled={pending || !name.trim() || !description.trim()}
          onClick={() => start(async () => {
            try {
              unwrap(await adminCreateAiPresenter({ name, description, voice }));
              setName(""); setDescription("");
              toast.success("Making 3 faces — about a minute");
              await onDone();
            } catch (e) { toast.error((e as Error).message); }
          })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Generate faces
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Fictional people only — never describe a real or famous person.</p>
    </div>
  );
}

function NewActor({ onDone }: { onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [releaseRef, setReleaseRef] = useState("");
  const [voice, setVoice] = useState("af_heart");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-xl border border-border p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><UserRound className="size-4" /> New licensed actor</h2>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Presenter name" className={cn(inputCls, "w-full")} />
      <input value={releaseRef} onChange={(e) => setReleaseRef(e.target.value)} maxLength={200} placeholder="Signed release reference (e.g. contract no. / file)"
        className={cn(inputCls, "w-full")} />
      <div className="flex flex-wrap items-center gap-2">
        <VoiceSelect value={voice} onChange={setVoice} />
        <Button size="sm" disabled={pending || !name.trim() || !releaseRef.trim()}
          onClick={() => start(async () => {
            try {
              unwrap(await adminCreateActor({ name, releaseRef, voice }));
              setName(""); setReleaseRef("");
              toast.success("Created — now upload the actor's footage");
              await onDone();
            } catch (e) { toast.error((e as Error).message); }
          })}>Create</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">The release must cover AI likeness + voice, the uses, territory and term (California AB 2602).</p>
    </div>
  );
}

function LibraryCard({ p, onChanged }: { p: LibraryPresenter; onChanged: () => Promise<void> }) {
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const act = (fn: () => Promise<void>) => start(async () => {
    try {
      await fn();
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  });
  const upload = async (f: File) => {
    if (f.size > FOOTAGE_MAX_BYTES) return void toast.error("That video is too large");
    setProgress(0);
    try {
      const r = await uploadWithProgress(`/api/presenters/${p.id}/footage`, f, setProgress);
      toast.success(`Footage saved (${Math.round(r.seconds)} s)`);
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProgress(null);
    }
  };
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated API image */}
          {p.thumbUrl ? <img src={p.thumbUrl} alt="" className="size-full object-cover" /> : <UserRound className="size-6 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.name}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{p.kind === "ai" ? "AI presenter" : "Licensed actor"}</span>
            <span className="text-[11px] text-muted-foreground">{p.status}{busy(p.status) ? "…" : ""}</span>
            {p.library ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">Published</span> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{p.kind === "actor" ? `Release: ${p.releaseRef}` : p.description}</p>
          {p.error ? <p className="flex items-center gap-1 text-xs text-red-600"><AlertTriangle className="size-3.5" /> {p.error}</p> : null}
        </div>
        {p.status === "ready" ? (
          <Button size="sm" variant={p.library ? "secondary" : "default"} disabled={pending} onClick={() => act(async () => unwrap(await adminSetPublished(p.id, !p.library)))}>
            {p.library ? "Unpublish" : "Publish"}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" aria-label={`Delete ${p.name}`} disabled={pending || busy(p.status)}
          onClick={() => confirm(`Delete ${p.name}? Decks using it won't render any more.`) && act(async () => unwrap(await adminDeleteLibraryPresenter(p.id)))}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      {p.kind === "ai" && p.status === "draft" && p.portraits.length ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">Pick a face — building takes about 15–20 minutes of GPU.</p>
          <div className="flex flex-wrap gap-2">
            {p.portraits.map((u, n) => (
              <button key={u} type="button" disabled={pending} onClick={() => act(async () => unwrap(await adminPickFace(p.id, n)))}
                className="overflow-hidden rounded-lg border border-border hover:border-primary" aria-label={`Use face ${n + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- admin-only API image */}
                <img src={u} alt="" className="h-48 w-auto" />
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(async () => unwrap(await adminMoreFaces(p.id)))}><RefreshCw className="size-4" /> New faces</Button>
        </div>
      ) : null}
      {p.kind === "ai" && p.status === "failed" ? (
        <Button size="sm" variant="ghost" className="mt-2" disabled={pending} onClick={() => act(async () => unwrap(await adminMoreFaces(p.id)))}><RefreshCw className="size-4" /> Try new faces</Button>
      ) : null}
      {p.kind === "actor" && (p.status === "draft" || p.status === "failed") ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={progress !== null} onClick={() => file.current?.click()}>
            <Upload className="size-4" /> {p.hasFootage ? "Replace footage" : "Upload footage"}
          </Button>
          <input ref={file} type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <Button size="sm" disabled={pending || !p.hasFootage} onClick={() => act(async () => unwrap(await adminBuildActor(p.id)))}>Build presenter</Button>
          {progress !== null ? <span className="text-xs text-muted-foreground">Uploading… {Math.round(progress * 100)}%</span> : null}
        </div>
      ) : null}
    </div>
  );
}
