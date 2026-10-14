"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Camera, CheckCircle2, Circle, Clapperboard, Loader2, Mic, Plus, ShieldCheck, Square, Trash2, Upload, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { createPresenterVideo } from "@/lib/presenter-video-actions";
import type { LibraryPresenter } from "@/lib/presenter-library-actions";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { unwrap } from "@/lib/action-result";
import {
  deletePresenter, getConsentStatement, getVoiceStatement, listPresenters, removeVoice, restartConsent, startPresenter, startVoice, submitPresenter,
  submitVoice, updatePresenter,
} from "@/lib/presenter-actions";
import {
  CONSENT_MAX_SECONDS, FOOTAGE_MAX_BYTES, FOOTAGE_MIN_SECONDS, MAX_PRESENTERS, PRESENTER_VIDEO_STYLES, type PresenterVideoStyle, type PresenterView,
} from "@/lib/presenters";
import { VOICES } from "@/lib/deck/types";
import { uploadWithProgress } from "@/lib/upload-progress";

const inputCls = "h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary";
const busyStatus = (s: string) => s === "queued" || s === "preparing";
const busyPresenter = (p: PresenterView) => busyStatus(p.status) || p.voiceStatus === "queued";

/** Waltz Avatar → presenters: list + the setup wizard (name → footage → live consent clip → build). */
export function AvatarsManager({ initial, library }: { initial: PresenterView[]; library: LibraryPresenter[] }) {
  const [items, setItems] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(initial.find((p) => p.status === "draft" || p.status === "failed")?.id ?? null);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  const refresh = useCallback(async () => {
    const r = await listPresenters();
    if (r.ok) setItems(r.data);
  }, []);
  // While one is being built, check every 5 s.
  useEffect(() => {
    if (!items.some(busyPresenter)) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [items, refresh]);

  const create = () =>
    start(async () => {
      try {
        const { presenter } = unwrap(await startPresenter(name));
        setItems((xs) => [...xs, presenter]);
        setOpenId(presenter.id);
        setName("");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });

  return (
    <div className="space-y-4">
      {items.map((p) => (
        <PresenterCard key={p.id} p={p} open={openId === p.id} onOpen={() => setOpenId(openId === p.id ? null : p.id)} onChanged={refresh}
          onDeleted={() => setItems((xs) => xs.filter((x) => x.id !== p.id))} />
      ))}
      {library.length ? (
        <section className="space-y-2 pt-2">
          <h2 className="text-sm font-semibold">ClipWaltz presenters</h2>
          <p className="text-xs text-muted-foreground">Ready-made presenters anyone can use — fictional AI presenters and licensed actors.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {library.map((p) => (
              <div key={p.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-3">
                  <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated API image */}
                    {p.thumbUrl ? <img src={p.thumbUrl} alt="" className="size-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.kind === "ai" ? "AI presenter (fictional)" : "Licensed actor"}</p>
                  </div>
                </div>
                <MakeVideo presenter={p} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {items.length < MAX_PRESENTERS ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border p-4">
          <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
            New presenter — usually your own name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Sam Rivera" className={inputCls}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && create()} />
          </label>
          <Button onClick={create} disabled={pending || !name.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create presenter
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">You have {MAX_PRESENTERS} presenters — delete one to make another.</p>
      )}
    </div>
  );
}

function StatusBadge({ s }: { s: PresenterView["status"] }) {
  const map: Record<string, [string, string]> = {
    draft: ["Setting up", "bg-muted text-muted-foreground"],
    queued: ["Waiting for the GPU", "bg-amber-500/15 text-amber-700 dark:text-amber-300"],
    preparing: ["Checking consent & building", "bg-amber-500/15 text-amber-700 dark:text-amber-300"],
    ready: ["Ready", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"],
    failed: ["Needs attention", "bg-red-500/15 text-red-700 dark:text-red-300"],
  };
  const [label, cls] = map[s] ?? [s, "bg-muted"];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>{label}</span>;
}

function PresenterCard({ p, open, onOpen, onChanged, onDeleted }: {
  p: PresenterView; open: boolean; onOpen: () => void; onChanged: () => Promise<void>; onDeleted: () => void;
}) {
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<void>) => start(async () => {
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    }
  });
  const setup = p.status === "draft" || p.status === "failed";
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 p-3">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated API image, not optimisable */}
          {p.thumbUrl ? <img src={p.thumbUrl} alt="" className="size-full object-cover" /> : <UserRound className="size-6 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{p.name}</span>
            <StatusBadge s={p.status} />
            {busyStatus(p.status) ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
          </div>
          {p.status === "ready" ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Default voice
              <select value={p.voice} disabled={pending} className={cn(inputCls, "h-7 max-w-[220px] text-xs")}
                onChange={(e) => act(async () => { unwrap(await updatePresenter(p.id, { voice: e.target.value })); await onChanged(); })}>
                {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </label>
          ) : p.error ? (
            <p className="flex items-start gap-1 text-xs text-red-600 dark:text-red-400"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {p.error}</p>
          ) : null}
        </div>
        {setup ? <Button size="sm" variant="secondary" onClick={onOpen}>{open ? "Hide" : "Continue setup"}</Button> : null}
        <Button size="sm" variant="ghost" disabled={pending || busyStatus(p.status)} aria-label={`Delete ${p.name}`}
          onClick={() => {
            if (!confirm(`Delete ${p.name}? Its video, consent recording and every cached lip-sync are removed.`)) return;
            act(async () => { unwrap(await deletePresenter(p.id)); onDeleted(); toast.success("Presenter deleted"); });
          }}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      {setup && open ? <SetupSteps p={p} onChanged={onChanged} /> : null}
      {p.status === "ready" ? <VoiceSection p={p} onChanged={onChanged} /> : null}
      {p.status === "ready" ? <div className="border-t border-border px-3 pb-3"><MakeVideo presenter={p} /></div> : null}
    </div>
  );
}

function SetupSteps({ p, onChanged }: { p: PresenterView; onChanged: () => Promise<void> }) {
  const [statement, setStatement] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    void getConsentStatement(p.id).then((r) => r.ok && setStatement(r.data));
  }, [p.id, p.status]);
  // After a failed check the next attempt needs a new code (the consent clip is recorded again with it).
  const failedConsent = p.status === "failed";
  return (
    <div className="space-y-4 border-t border-border p-4">
      <Step n={1} title="A video of you talking" done={p.hasFootage}>
        <p className="text-xs text-muted-foreground">
          {FOOTAGE_MIN_SECONDS} s to 2 min of you talking naturally to the camera: good light, steady camera, your face and
          shoulders in frame, one person only. This is the footage your presenter is made from.
        </p>
        <FootageInput id={p.id} has={p.hasFootage} onDone={onChanged} />
      </Step>
      <Step n={2} title="Live consent" done={p.hasConsent}>
        <p className="text-xs text-muted-foreground">
          Record yourself reading this sentence, live, with your face in view. We check the code, your face and that the
          voice matches the video above — automatically.
        </p>
        {statement ? <blockquote className="rounded-lg border-l-4 border-[color:var(--cw-violet)] bg-muted/40 p-3 text-base font-medium">{statement}</blockquote> : null}
        {failedConsent ? (
          <Button size="sm" variant="secondary" disabled={pending}
            onClick={() => start(async () => { try { setStatement(unwrap(await restartConsent(p.id))); await onChanged(); } catch (e) { toast.error((e as Error).message); } })}>
            Get a new code
          </Button>
        ) : (
          <ConsentRecorder id={p.id} has={p.hasConsent} onDone={onChanged} />
        )}
      </Step>
      <Step n={3} title="Build my presenter" done={false}>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" /> Only make a presenter of yourself. Videos made with it are labelled
          “AI-generated”. You can delete it — and everything we stored for it — at any time.
        </p>
        <Button disabled={pending || !p.hasFootage || !p.hasConsent}
          onClick={() => start(async () => { try { unwrap(await submitPresenter(p.id)); toast.success("Checking consent and building — this takes a minute or two"); await onChanged(); } catch (e) { toast.error((e as Error).message); } })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Build my presenter
        </Button>
      </Step>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted-foreground" />} {n}. {title}
      </h3>
      {children}
    </section>
  );
}

function FootageInput({ id, has, onDone }: { id: string; has: boolean; onDone: () => Promise<void> }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const send = async (blob: Blob) => {
    if (blob.size > FOOTAGE_MAX_BYTES) {
      toast.error(`That video is too large (max ${Math.round(FOOTAGE_MAX_BYTES / 2 ** 20)} MB)`);
      return;
    }
    setProgress(0);
    try {
      const r = await uploadWithProgress(`/api/presenters/${id}/footage`, blob, setProgress);
      toast.success(`Video saved (${Math.round(r.seconds)} s)`);
      await onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProgress(null);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={progress !== null || recording} onClick={() => file.current?.click()}>
          <Upload className="size-4" /> {has ? "Replace with a video file" : "Upload a video"}
        </Button>
        <input ref={file} type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && void send(e.target.files[0])} />
      </div>
      <WebcamRecorder label={has ? "Record again" : "Record with my camera"} maxSeconds={120} minSeconds={FOOTAGE_MIN_SECONDS}
        disabled={progress !== null} onRecording={setRecording} onRecorded={send}
        hint="Talk about anything for a minute — your day, your work. Look at the camera." />
      {progress !== null ? <p className="text-xs text-muted-foreground">Uploading… {Math.round(progress * 100)}% (then a moment to process)</p> : null}
    </div>
  );
}

/** Phase 2 templates: a script → a ready WaltzDeck project spoken by this presenter. */
function MakeVideo({ presenter }: { presenter: PresenterView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [script, setScript] = useState("");
  const [style, setStyle] = useState<PresenterVideoStyle>("talking-head");
  const [aspect, setAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [pending, start] = useTransition();
  if (!open) {
    return <Button size="sm" variant="secondary" className="mt-2" onClick={() => setOpen(true)}><Clapperboard className="size-4" /> Make a video</Button>;
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border p-3">
      <textarea value={script} onChange={(e) => setScript(e.target.value)} maxLength={3000} rows={5}
        placeholder={`What should ${presenter.name} say? Paste your script — it's split into scenes.`}
        className="w-full rounded-md border border-border bg-background p-2 text-sm outline-none focus:border-primary" />
      <div className="flex flex-wrap gap-1.5">
        {PRESENTER_VIDEO_STYLES.map((s) => (
          <button key={s.key} type="button" aria-pressed={style === s.key} onClick={() => setStyle(s.key)}
            className={cn("rounded-full border px-3 py-1 text-xs", style === s.key ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border text-muted-foreground")}>
            {s.label}
          </button>
        ))}
        {(["9:16", "16:9", "1:1"] as const).map((a) => (
          <button key={a} type="button" aria-pressed={aspect === a} onClick={() => setAspect(a)}
            className={cn("rounded-full border px-3 py-1 text-xs", aspect === a ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border text-muted-foreground")}>
            {a}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !script.trim()}
          onClick={() => start(async () => {
            try {
              const id = unwrap(await createPresenterVideo({ presenterId: presenter.id, script, style, aspect }));
              router.push(`/projects/${id}/deck`);
            } catch (e) {
              toast.error((e as Error).message);
            }
          })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" />} Create the video
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Opens in WaltzDeck — edit any line, then Render. 1 AI credit per 10 s of presenter speech.</p>
    </div>
  );
}

/** Phase 2 — the presenter's own cloned voice: its own live consent (a voice sentence + code), checked against the video. */
function VoiceSection({ p, onChanged }: { p: PresenterView; onChanged: () => Promise<void> }) {
  const [statement, setStatement] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (p.voiceStatus === "draft") void getVoiceStatement(p.id).then((r) => r.ok && setStatement(r.data));
  }, [p.id, p.voiceStatus]);
  const act = (fn: () => Promise<void>) => start(async () => {
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    }
  });
  return (
    <div className="space-y-2 border-t border-border p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Mic className="size-4" /> Your own voice</h3>
      {p.voiceStatus === "none" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-xs text-muted-foreground">Narrate your WaltzDeck videos in your own voice — in English, Spanish, French, Italian or Portuguese.</p>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(async () => { setStatement(unwrap(await startVoice(p.id))); await onChanged(); })}>Use my own voice</Button>
        </div>
      ) : p.voiceStatus === "ready" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-emerald-600" /> Ready — pick <b className="font-medium text-foreground">My voice — {p.name}</b> under a deck&apos;s Voiceover.
          </p>
          <Button size="sm" variant="ghost" disabled={pending}
            onClick={() => confirm("Stop using your cloned voice? Its recordings and saved lines are removed.") && act(async () => { unwrap(await removeVoice(p.id)); await onChanged(); })}>Remove my voice</Button>
        </div>
      ) : p.voiceStatus === "queued" ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Checking your voice…</p>
      ) : p.voiceStatus === "failed" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex flex-1 items-start gap-1 text-xs text-red-600 dark:text-red-400"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {p.voiceError}</p>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(async () => { setStatement(unwrap(await startVoice(p.id))); await onChanged(); })}>Get a new code</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Record yourself reading this sentence, live, with your face in view. We check that it&apos;s the same voice as your video.</p>
          {statement ? <blockquote className="rounded-lg border-l-4 border-[color:var(--cw-violet)] bg-muted/40 p-3 text-base font-medium">{statement}</blockquote> : null}
          <ConsentRecorder id={p.id} has={p.voiceHasConsent} onDone={onChanged} path="voice-consent" />
          <Button size="sm" disabled={pending || !p.voiceHasConsent}
            onClick={() => act(async () => { unwrap(await submitVoice(p.id)); toast.success("Checking your voice — about a minute"); await onChanged(); })}>
            <CheckCircle2 className="size-4" /> Check my voice
          </Button>
        </div>
      )}
    </div>
  );
}

function ConsentRecorder({ id, has, onDone, path = "consent" }: { id: string; has: boolean; onDone: () => Promise<void>; path?: string }) {
  const [busy, setBusy] = useState(false);
  const send = async (blob: Blob) => {
    setBusy(true);
    try {
      await uploadWithProgress(`/api/presenters/${id}/${path}`, blob, () => {});
      toast.success("Consent recording saved");
      await onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return <WebcamRecorder label={has ? "Record again" : "Start recording"} maxSeconds={CONSENT_MAX_SECONDS} minSeconds={3} disabled={busy} onRecorded={send} />;
}

/** Camera + microphone recording in the browser (MediaRecorder). Shows the live preview and a timer. */
function WebcamRecorder({ label, maxSeconds, minSeconds, disabled, onRecorded, onRecording, hint }: {
  label: string; maxSeconds: number; minSeconds: number; disabled?: boolean; hint?: string;
  onRecorded: (b: Blob) => void | Promise<void>; onRecording?: (on: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [secs, setSecs] = useState<number | null>(null);
  const t0 = useRef(0);
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);
  useEffect(() => {
    if (secs === null) return;
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - t0.current) / 1000);
      setSecs(s);
      if (s >= maxSeconds) rec.current?.stop();
    }, 250);
    return () => clearInterval(t);
  }, [secs, maxSeconds]);

  const begin = async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
    } catch {
      return toast.error("Allow camera and microphone access to record");
    }
    if (video.current) {
      video.current.srcObject = stream.current;
      await video.current.play().catch(() => {});
    }
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      const len = (Date.now() - t0.current) / 1000;
      stream.current?.getTracks().forEach((t) => t.stop());
      setSecs(null);
      onRecording?.(false);
      if (len < minSeconds) return toast.error(`Too short — record at least ${minSeconds} seconds`);
      void onRecorded(new Blob(chunks.current, { type: r.mimeType || "video/webm" }));
    };
    rec.current = r;
    t0.current = Date.now();
    r.start(1000);
    setSecs(0);
    onRecording?.(true);
  };

  return (
    <div className="space-y-2">
      <video ref={video} muted playsInline className={cn("w-full max-w-sm rounded-lg bg-black", secs === null && "hidden")} />
      {secs !== null ? (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="destructive" onClick={() => rec.current?.stop()}><Square className="size-4" /> Stop</Button>
          <span className="text-sm tabular-nums text-red-600">● {secs}s / {maxSeconds}s</span>
          {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        </div>
      ) : (
        <Button size="sm" disabled={disabled} onClick={() => void begin()}><Camera className="size-4" /> {label}</Button>
      )}
    </div>
  );
}
