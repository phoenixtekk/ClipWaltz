"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle, CheckCircle2, Circle, Clapperboard, ImageIcon, Loader2, Mic, Plus, ShieldCheck, Sparkles, Trash2, Upload, UserRound, Video,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createPresenterVideo } from "@/lib/presenter-video-actions";
import type { LibraryPresenter } from "@/lib/presenter-library-actions";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { unwrap } from "@/lib/action-result";
import {
  createAiPresenter, deletePresenter, getConsentStatement, getVoiceStatement, listPresenters, moreFaces, pickFace, removeVoice, restartConsent,
  setPhotoFrame, startPresenter, startVoice, submitPresenter, submitVoice, updatePresenter,
} from "@/lib/presenter-actions";
import {
  CONSENT_MAX_SECONDS, FOOTAGE_MAX_BYTES, FOOTAGE_MIN_SECONDS, MAX_FACE_ROUNDS, MAX_PRESENTERS, PRESENTER_BUILD_CREDITS, PRESENTER_VIDEO_STYLES,
  type PresenterSource, type PresenterVideoStyle, type PresenterView,
} from "@/lib/presenters";
import { VOICES } from "@/lib/deck/types";
import { uploadFootage, uploadWithProgress } from "@/lib/upload-progress";
import { WebcamRecorder } from "@/components/webcam-recorder";

const inputCls = "h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary";
const busyStatus = (s: string) => s === "queued" || s === "preparing";
const busyPresenter = (p: PresenterView) => busyStatus(p.status) || p.voiceStatus === "queued";

const SOURCES: { key: PresenterSource; label: string; hint: string; icon: typeof Video }[] = [
  { key: "video", label: "From a video of me", hint: "Most natural — 10 s to 2 min of you talking", icon: Video },
  { key: "photo", label: "From a photo of me", hint: "Just a short live recording; we animate a still of you", icon: ImageIcon },
  { key: "ai", label: "AI presenter", hint: "A made-up face you describe — no recording", icon: Sparkles },
];
const SOURCE_LABEL: Record<PresenterSource, string | null> = { video: null, photo: "From your photo", ai: "AI face (fictional)" };

/** Waltz Avatar → presenters: list + the setup wizard (name → footage → live consent clip → build). */
export function AvatarsManager({ initial, library }: { initial: PresenterView[]; library: LibraryPresenter[] }) {
  const [items, setItems] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(initial.find((p) => p.status === "draft" || p.status === "failed")?.id ?? null);
  const [name, setName] = useState("");
  const [source, setSource] = useState<PresenterSource>("video");
  const [look, setLook] = useState("");
  const [voice, setVoice] = useState("af_heart");
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
        const presenter = source === "ai"
          ? unwrap(await createAiPresenter({ name, description: look, voice }))
          : unwrap(await startPresenter(name, source)).presenter;
        setItems((xs) => [...xs, presenter]);
        setOpenId(presenter.id);
        setName("");
        setLook("");
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
        <div className="space-y-3 rounded-xl border border-dashed border-border p-4">
          <div role="radiogroup" aria-label="Make the presenter from" className="grid gap-2 sm:grid-cols-3">
            {SOURCES.map((s) => (
              <button key={s.key} type="button" role="radio" aria-checked={source === s.key} onClick={() => setSource(s.key)}
                className={cn("flex items-start gap-2 rounded-lg border p-2.5 text-left", source === s.key ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border")}>
                <s.icon className="mt-0.5 size-4 shrink-0" />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">{s.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{s.hint}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
              {source === "ai" ? "Presenter name" : "New presenter — usually your own name"}
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={source === "ai" ? "e.g. Nova" : "e.g. Sam Rivera"}
                className={inputCls} onKeyDown={(e) => e.key === "Enter" && source !== "ai" && name.trim() && create()} />
            </label>
            {source === "ai" ? (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Voice
                <select value={voice} onChange={(e) => setVoice(e.target.value)} className={cn(inputCls, "max-w-[220px]")}>
                  {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          {source === "ai" ? (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              How they look — a made-up person, never a real one
              <textarea value={look} onChange={(e) => setLook(e.target.value)} maxLength={300} rows={2}
                placeholder="e.g. a friendly woman in her 40s, short grey hair, navy blazer, warm smile"
                className="rounded-md border border-border bg-background p-2 text-sm outline-none focus:border-primary" />
            </label>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={create} disabled={pending || !name.trim() || (source === "ai" && look.trim().length < 10)}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : source === "ai" ? <Sparkles className="size-4" /> : <Plus className="size-4" />}
              {source === "ai" ? " Make 3 faces" : " Create presenter"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              {source === "video" ? "Free to build." : source === "photo"
                ? `Building costs ${PRESENTER_BUILD_CREDITS} AI credits (refunded if it fails).`
                : `Faces are free; building the one you pick costs ${PRESENTER_BUILD_CREDITS} AI credits (refunded if it fails).`}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">You have {MAX_PRESENTERS} presenters — delete one to make another.</p>
      )}
    </div>
  );
}

function StatusBadge({ p }: { p: PresenterView }) {
  const s = p.status;
  const map: Record<string, [string, string]> = {
    draft: [p.source === "ai" && p.portraits.length ? "Pick a face" : "Setting up", "bg-muted text-muted-foreground"],
    queued: [p.source === "ai" && !p.portraits.length ? "Making faces" : "Waiting for the GPU", "bg-amber-500/15 text-amber-700 dark:text-amber-300"],
    preparing: [p.source === "ai" ? "Building (about 20 min)" : p.source === "photo" ? "Checking consent & building (about 20 min)" : "Checking consent & building",
      "bg-amber-500/15 text-amber-700 dark:text-amber-300"],
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
            <StatusBadge p={p} />
            {SOURCE_LABEL[p.source] ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{SOURCE_LABEL[p.source]}</span> : null}
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
      {setup && open ? (p.source === "ai" ? <AiFaceSteps p={p} onChanged={onChanged} /> : <SetupSteps p={p} onChanged={onChanged} />) : null}
      {p.status === "ready" && p.source === "video" ? <VoiceSection p={p} onChanged={onChanged} /> : null}
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
  const photo = p.source === "photo";
  const ready = photo ? p.hasConsent && p.photoAt != null : p.hasFootage && p.hasConsent;
  return (
    <div className="space-y-4 border-t border-border p-4">
      {photo ? null : (
        <Step n={1} title="A video of you talking" done={p.hasFootage}>
          <p className="text-xs text-muted-foreground">
            {FOOTAGE_MIN_SECONDS} s to 2 min of you talking naturally to the camera: good light, steady camera, your face and
            shoulders in frame, one person only. This is the footage your presenter is made from.
          </p>
          <FootageInput id={p.id} has={p.hasFootage} onDone={onChanged} />
        </Step>
      )}
      <Step n={photo ? 1 : 2} title="Live consent" done={p.hasConsent}>
        <p className="text-xs text-muted-foreground">
          {photo
            ? "Record yourself reading this sentence, live, facing the camera in good light — centred, head and shoulders in frame. Your presenter's picture is taken from this recording, so we know it's you."
            : "Record yourself reading this sentence, live, with your face in view. We check the code, your face and that the voice matches the video above — automatically."}
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
      {photo ? (
        <Step n={2} title="Pick your picture" done={p.photoAt != null}>
          {p.hasConsent && !failedConsent ? <FramePicker p={p} onChanged={onChanged} /> : (
            <p className="text-xs text-muted-foreground">Record the consent above first — your picture is chosen from it.</p>
          )}
        </Step>
      ) : null}
      <Step n={3} title="Build my presenter" done={false}>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" /> Only make a presenter of yourself. Videos made with it are labelled
          “AI-generated”. You can delete it — and everything we stored for it — at any time.
        </p>
        <Button disabled={pending || !ready}
          onClick={() => start(async () => {
            try {
              unwrap(await submitPresenter(p.id));
              toast.success(photo ? "Checking consent and building — this takes about 20 minutes" : "Checking consent and building — this takes a minute or two");
              await onChanged();
            } catch (e) {
              toast.error((e as Error).message);
            }
          })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {photo ? ` Build my presenter · ${PRESENTER_BUILD_CREDITS} credits` : " Build my presenter"}
        </Button>
        {photo ? <p className="text-[11px] text-muted-foreground">Refunded if the consent check or the build fails. Your own cloned voice needs a presenter made from a video.</p> : null}
      </Step>
    </div>
  );
}

/** Photo presenter: scrub the consent recording to the best moment; the bright box is the part that's kept (9:16). */
function FramePicker({ p, onChanged }: { p: PresenterView; onChanged: () => Promise<void> }) {
  const video = useRef<HTMLVideoElement>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (p.photoAt != null && video.current) video.current.currentTime = p.photoAt;
  }, [p.photoAt]);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Pause on a moment where you look straight at the camera with your mouth closed, then use that frame. The bright box is what your presenter shows.
      </p>
      <div className="relative w-full max-w-md overflow-hidden rounded-lg bg-black">
        {/* The consent recording (only its owner can load it, and only while setting up). */}
        <video ref={video} src={`/api/presenters/${p.id}/consent?v=${p.consentRef ?? ""}`} controls playsInline preload="metadata" className="block w-full" />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 aspect-[9/16] h-full max-w-full -translate-x-1/2 rounded-sm ring-2 ring-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={pending}
          onClick={() => start(async () => {
            try {
              const t = video.current?.currentTime ?? 0;
              unwrap(await setPhotoFrame(p.id, t));
              toast.success(`Picture set (${t.toFixed(1)} s)`);
              await onChanged();
            } catch (e) {
              toast.error((e as Error).message);
            }
          })}>
          <ImageIcon className="size-4" /> Use this frame
        </Button>
        {p.photoAt != null ? <span className="text-xs text-muted-foreground">Using the frame at {p.photoAt.toFixed(1)} s</span> : null}
      </div>
    </div>
  );
}

/** AI presenter: pick one of the generated faces (free), then build it (PRESENTER_BUILD_CREDITS). */
function AiFaceSteps({ p, onChanged }: { p: PresenterView; onChanged: () => Promise<void> }) {
  const [pick, setPick] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const rounds = Number((p.meta as { faceRounds?: number } | null)?.faceRounds ?? 1);
  const act = (fn: () => Promise<void>) => start(async () => {
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    }
  });
  return (
    <div className="space-y-3 border-t border-border p-4">
      {p.description ? <p className="text-xs text-muted-foreground">“{p.description}”</p> : null}
      {p.portraits.length ? (
        <>
          <div role="radiogroup" aria-label="Pick a face" className="grid max-w-md grid-cols-3 gap-2">
            {p.portraits.map((src, n) => (
              <button key={src} type="button" role="radio" aria-checked={pick === n} aria-label={`Face ${n + 1}`} onClick={() => setPick(n)}
                className={cn("overflow-hidden rounded-lg border-2", pick === n ? "border-[color:var(--cw-violet)]" : "border-transparent")}>
                {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated API image */}
                <img src={src} alt="" className="aspect-[9/16] w-full object-cover" />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={pending || pick === null}
              onClick={() => act(async () => {
                unwrap(await pickFace(p.id, pick!));
                toast.success("Building your presenter — about 20 minutes");
                await onChanged();
              })}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Build with this face · {PRESENTER_BUILD_CREDITS} credits
            </Button>
            <Button variant="ghost" size="sm" disabled={pending || rounds >= MAX_FACE_ROUNDS}
              onClick={() => act(async () => { unwrap(await moreFaces(p.id)); setPick(null); await onChanged(); })}>
              <Sparkles className="size-4" /> {rounds >= MAX_FACE_ROUNDS ? "No more new faces" : `New faces (${MAX_FACE_ROUNDS - rounds} left)`}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Refunded if the build fails. AI presenters use the voices above; their videos are labelled “AI-generated”.</p>
        </>
      ) : (
        <Button variant="secondary" size="sm" disabled={pending || rounds >= MAX_FACE_ROUNDS}
          onClick={() => act(async () => { unwrap(await moreFaces(p.id)); await onChanged(); })}>
          <Sparkles className="size-4" /> Try making faces again
        </Button>
      )}
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
      const r = await uploadFootage(`/api/presenters/${id}/footage`, blob, setProgress);
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
