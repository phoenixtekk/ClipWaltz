"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, FlipHorizontal2, Mic, RotateCcw, ScanFace, Square, SunMedium, Timer, X, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

// Waltz Avatar recordings (presenter footage, consent clips): a camera check first — pick the camera and microphone,
// frame yourself (zoom, brightness, guide), hear the mic level — then a countdown, the take, and a review before it is
// sent. Zoom/brightness use the camera's own controls when it has them; otherwise they're applied digitally (the frames
// are drawn through a canvas, so the RECORDING matches the preview). The preview can be mirrored; the recording never is.

type Dev = { id: string; label: string };
type Quality = "720" | "1080";
type Prefs = { cam?: string; mic?: string; quality?: Quality; mirror?: boolean; guide?: boolean; countdown?: boolean };
type Phase = "idle" | "opening" | "setup" | "countdown" | "recording" | "review" | "sending";
type Range = { min: number; max: number; step: number };

const PREFS_KEY = "cw.recorder.v1"; // per-browser convenience only — never required
const ZOOM_MAX = 3;
const SIZES: Record<Quality, { width: number; height: number }> = { "720": { width: 1280, height: 720 }, "1080": { width: 1920, height: 1080 } };

function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Prefs;
  } catch {
    return {};
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private window / storage blocked: the choice just isn't remembered */
  }
}

function mediaError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera or microphone access is blocked — allow it in your browser (the camera icon in the address bar), then try again.";
  if (name === "NotFoundError") return "No camera or microphone was found — plug one in and try again.";
  if (name === "NotReadableError" || name === "AbortError")
    return "That camera or microphone is busy — close other apps using it (Teams, Zoom, OBS…) or pick another one.";
  return "Couldn't start the camera — try another camera or microphone.";
}

function rangeOf(c: unknown): Range | null {
  const r = c as { min?: number; max?: number; step?: number } | undefined;
  return r && typeof r.min === "number" && typeof r.max === "number" && r.max > r.min ? { min: r.min, max: r.max, step: r.step || 0.1 } : null;
}

export function WebcamRecorder({ label, maxSeconds, minSeconds, disabled, onRecorded, onRecording, hint }: {
  label: string; maxSeconds: number; minSeconds: number; disabled?: boolean; hint?: string;
  onRecorded: (b: Blob) => void | Promise<void>; onRecording?: (on: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [prefs, setPrefs] = useState<Prefs>({});
  const [cams, setCams] = useState<Dev[]>([]);
  const [mics, setMics] = useState<Dev[]>([]);
  const [camId, setCamId] = useState("");
  const [micId, setMicId] = useState("");
  const [actual, setActual] = useState("");
  const [hwZoom, setHwZoom] = useState<Range | null>(null);
  const [hwBright, setHwBright] = useState<{ key: "brightness" | "exposureCompensation"; range: Range } | null>(null);
  const [zoom, setZoom] = useState(1); // 1..ZOOM_MAX (mapped onto the camera's own range when it has zoom)
  const [bright, setBright] = useState(0); // -1..1
  const [pan, setPan] = useState({ x: 0, y: 0 }); // digital zoom framing, -1..1
  const [level, setLevel] = useState(0);
  const [silent, setSilent] = useState(false);
  const [count, setCount] = useState(0);
  const [secs, setSecs] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; url: string; secs: number } | null>(null);

  const video = useRef<HTMLVideoElement>(null); // hidden source of frames
  const canvas = useRef<HTMLCanvasElement>(null); // what you see (and record, for digital zoom / brightness)
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  const view = useRef({ zoom: 1, bright: 0, pan: { x: 0, y: 0 }, hwZoom: false, hwBright: false });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const t0 = useRef(0);
  const gen = useRef(0); // bumped whenever an open camera is abandoned — a slower, older open() then discards its stream
  const latest = useRef({ phase: "idle" as Phase, cam: "", mic: "", quality: "720" as Quality });
  const canvasTracks = useRef<MediaStreamTrack[]>([]);
  const digitalRec = useRef(false);
  const useBtn = useRef<HTMLButtonElement>(null);
  const reopen = useRef<(cam: string, mic: string, q: Quality) => void>(() => {});
  // Digital brightness needs canvas filters (not in Safari) — then only a camera with its own brightness control has it.
  const [filterOk] = useState(() => typeof document === "undefined" || typeof document.createElement("canvas").getContext("2d")?.filter === "string");

  const live = phase !== "idle";
  useEffect(() => { onRecording?.(live); }, [live, onRecording]);
  useEffect(() => { view.current = { zoom, bright, pan, hwZoom: !!hwZoom, hwBright: !!hwBright }; }, [zoom, bright, pan, hwZoom, hwBright]);
  useEffect(() => { latest.current = { phase, cam: camId, mic: micId, quality: prefs.quality ?? "720" }; }, [phase, camId, micId, prefs.quality]);

  const stopStream = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
  }, []);

  const stopCanvasTracks = useCallback(() => {
    canvasTracks.current.forEach((t) => t.stop());
    canvasTracks.current = [];
  }, []);
  useEffect(() => () => {
    gen.current++;
    const r = rec.current;
    if (r && r.state !== "inactive") {
      r.ondataavailable = null;
      r.onstop = null;
      r.stop();
    }
    stopCanvasTracks();
    stopStream();
  }, [stopStream, stopCanvasTracks]);
  useEffect(() => () => { if (take) URL.revokeObjectURL(take.url); }, [take]);

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
    const list = (kind: MediaDeviceKind, word: string) => all.filter((d) => d.kind === kind && d.deviceId)
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${word} ${i + 1}` }));
    setCams(list("videoinput", "Camera"));
    setMics(list("audioinput", "Microphone"));
  }, []);

  // Plugging a camera / mic in or out updates the lists (losing the one in use is handled by its track's onended).
  useEffect(() => {
    if (!live || !navigator.mediaDevices?.addEventListener) return;
    const onChange = () => void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [live, refreshDevices]);

  const meter = useCallback((s: MediaStream) => {
    const track = s.getAudioTracks()[0];
    if (!track) return;
    try {
      void audioCtx.current?.close().catch(() => {});
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(new MediaStream([track])).connect(an);
      audioCtx.current = ctx;
      const buf = new Float32Array(an.fftSize);
      let quietSince = performance.now();
      const tick = () => {
        if (audioCtx.current !== ctx) return;
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        const lvl = Math.min(1, rms * 6);
        setLevel(lvl);
        if (lvl > 0.04) quietSince = performance.now();
        setSilent(performance.now() - quietSince > 4000);
        setTimeout(tick, 100);
      };
      tick();
    } catch {
      /* no Web Audio: no meter */
    }
  }, []);

  /** (Re)open the camera + mic. `cam`/`mic` "" = the browser's default. */
  const open = useCallback(async (cam: string, mic: string, quality: Quality): Promise<void> => {
    const prev = { cam: latest.current.cam, mic: latest.current.mic };
    const switching = latest.current.phase === "setup";
    stopStream();
    const my = ++gen.current;
    setPhase((p) => (p === "idle" ? "opening" : p));
    const size = SIZES[quality];
    const ask = (c: string, m: string) => navigator.mediaDevices.getUserMedia({
      video: { ...(c ? { deviceId: { exact: c } } : {}), width: { ideal: size.width }, height: { ideal: size.height }, frameRate: { ideal: 30 } },
      audio: { ...(m ? { deviceId: { exact: m } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    let s: MediaStream;
    try {
      s = await ask(cam, mic);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if ((cam || mic) && (name === "OverconstrainedError" || name === "NotFoundError")) {
        toast.message("Your saved camera or microphone isn't connected — using the default");
        // Keep whichever of the two is still there: default camera + saved mic, then saved camera + default mic, then both default.
        const tries: [string, string][] = [["", mic], [cam, ""], ["", ""]];
        let got: MediaStream | null = null, last: unknown = e;
        for (const [c, m] of tries) {
          try {
            got = await ask(c, m);
            break;
          } catch (e2) {
            last = e2;
          }
        }
        if (!got) {
          if (my !== gen.current) return;
          toast.error(mediaError(last));
          setPhase("idle");
          return;
        }
        s = got;
      } else {
        if (my !== gen.current) return;
        toast.error(mediaError(e));
        // A failed switch (e.g. that camera is busy in another app): go back to the devices that were working.
        const back = switching ? await ask(prev.cam, prev.mic).catch(() => null) : null;
        if (!back || my !== gen.current) {
          back?.getTracks().forEach((t) => t.stop());
          if (my === gen.current) setPhase("idle");
          return;
        }
        s = back;
      }
    }
    if (my !== gen.current) {
      s.getTracks().forEach((t) => t.stop());
      return;
    }
    stream.current = s;
    // The camera or mic in use is unplugged: stop a take in progress (kept if long enough), else fall back to the default.
    for (const t of s.getTracks()) {
      t.onended = () => {
        if (my !== gen.current) return;
        if (rec.current?.state === "recording") {
          toast.error(t.kind === "video" ? "The camera was disconnected — recording stopped" : "The microphone was disconnected — recording stopped");
          rec.current.stop();
          return;
        }
        toast.message(t.kind === "video" ? "That camera was disconnected — switching to the default" : "That microphone was disconnected — switching to the default");
        const l = latest.current;
        reopen.current(t.kind === "video" ? "" : l.cam, t.kind === "audio" ? "" : l.mic, l.quality);
      };
    }
    const vt = s.getVideoTracks()[0];
    const st = vt?.getSettings() ?? {};
    setCamId(st.deviceId ?? "");
    setMicId(s.getAudioTracks()[0]?.getSettings().deviceId ?? "");
    setActual(st.width && st.height ? `${st.width}×${st.height}${st.frameRate ? ` · ${Math.round(st.frameRate)} fps` : ""}` : "");
    const caps = (vt?.getCapabilities?.() ?? {}) as Record<string, unknown>;
    setHwZoom(rangeOf(caps.zoom));
    const b = rangeOf(caps.brightness) ? { key: "brightness" as const, range: rangeOf(caps.brightness)! }
      : rangeOf(caps.exposureCompensation) ? { key: "exposureCompensation" as const, range: rangeOf(caps.exposureCompensation)! } : null;
    setHwBright(b);
    setZoom(1);
    setBright(0);
    setPan({ x: 0, y: 0 });
    if (video.current) {
      video.current.srcObject = s;
      await video.current.play().catch(() => {});
    }
    if (my !== gen.current) return;
    meter(s);
    await refreshDevices();
    if (my !== gen.current) return;
    setPhase((p) => (p === "opening" || p === "idle" ? "setup" : p));
  }, [meter, refreshDevices, stopStream]);
  useEffect(() => { reopen.current = (c, m, q) => void open(c, m, q); }, [open]);

  // Draw the preview (and the digitally zoomed / brightened frames that get recorded) ~30 times a second.
  useEffect(() => {
    if (!live || phase === "review") return;
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const id = setInterval(() => {
      const v = video.current, c = canvas.current;
      if (!v || !c || !v.videoWidth) return;
      if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
      }
      const { zoom: z, bright: br, pan: p, hwZoom: hz, hwBright: hb } = view.current;
      const dz = hz ? 1 : z;
      const w = c.width / dz, h = c.height / dz;
      const sx = (c.width - w) / 2 + (p.x * (c.width - w)) / 2;
      const sy = (c.height - h) / 2 + (p.y * (c.height - h)) / 2;
      ctx.filter = !hb && br && filterOk ? `brightness(${(1 + br * 0.6).toFixed(2)})` : "none";
      ctx.drawImage(v, sx, sy, w, h, 0, 0, c.width, c.height);
    }, 33);
    return () => clearInterval(id);
  }, [live, phase, filterOk]);

  const applyHw = useCallback((patch: Record<string, number>) => {
    const vt = stream.current?.getVideoTracks()[0];
    void vt?.applyConstraints({ advanced: [patch as MediaTrackConstraintSet] }).catch(() => {});
  }, []);

  const setZoomTo = (z: number) => {
    const v = Math.min(ZOOM_MAX, Math.max(1, z));
    setZoom(v);
    if (hwZoom) applyHw({ zoom: hwZoom.min + ((v - 1) / (ZOOM_MAX - 1)) * (hwZoom.max - hwZoom.min) });
    if (v === 1) setPan({ x: 0, y: 0 });
  };
  const setBrightTo = (b: number) => {
    setBright(b);
    if (hwBright) {
      const { min, max } = hwBright.range;
      applyHw({ [hwBright.key]: min + ((b + 1) / 2) * (max - min) });
    }
  };
  const nudge = (dx: number, dy: number) => {
    if (zoom <= 1 || hwZoom) return;
    setPan((p) => ({ x: Math.max(-1, Math.min(1, p.x + dx)), y: Math.max(-1, Math.min(1, p.y + dy)) }));
  };

  const start = async () => {
    const p = { ...{ quality: "720" as Quality, mirror: true, guide: true, countdown: true }, ...loadPrefs() };
    setPrefs(p);
    await open(p.cam ?? "", p.mic ?? "", p.quality ?? "720");
  };
  const remember = (patch: Prefs) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
    return next;
  };
  const cancel = () => {
    gen.current++;
    stopStream();
    setPhase("idle");
  };

  const recordNow = () => {
    const s = stream.current;
    if (!s) return;
    // Raw camera stream unless the picture is changed digitally — then the canvas (what you see) is recorded.
    const digital = (!hwZoom && zoom > 1) || (!hwBright && bright !== 0 && filterOk);
    stopCanvasTracks();
    if (digital && canvas.current?.captureStream) canvasTracks.current = canvas.current.captureStream(30).getVideoTracks();
    const src = canvasTracks.current.length ? new MediaStream([...canvasTracks.current, ...s.getAudioTracks()]) : s;
    digitalRec.current = src !== s;
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(src, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: prefs.quality === "1080" ? 8_000_000 : 5_000_000 });
    } catch {
      stopCanvasTracks();
      toast.error("This browser can't record here — try another browser, or upload a video instead");
      setPhase("setup");
      return;
    }
    chunks.current = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const len = (Date.now() - t0.current) / 1000;
      stopCanvasTracks();
      if (len < minSeconds) {
        toast.error(`Too short — record at least ${minSeconds} seconds`);
        setPhase("setup");
        return;
      }
      const blob = new Blob(chunks.current, { type: r.mimeType || "video/webm" });
      setTake({ blob, url: URL.createObjectURL(blob), secs: Math.round(len) });
      setPhase("review");
    };
    rec.current = r;
    t0.current = Date.now();
    setSecs(0);
    try {
      r.start(1000);
    } catch {
      r.onstop = null;
      stopCanvasTracks();
      toast.error("Recording couldn't start — check the camera and try again");
      setPhase("setup");
      return;
    }
    setPhase("recording");
  };

  const record = () => {
    if (!prefs.countdown) return recordNow();
    setPhase("countdown");
    setCount(3);
  };
  useEffect(() => {
    if (phase !== "countdown") return;
    // 3 → 2 → 1 → record (from the timer, never synchronously inside the effect)
    const t = setTimeout(() => (count <= 1 ? recordNow() : setCount((c) => c - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recordNow reads the latest state when the countdown ends
  }, [phase, count]);
  // Zoomed / brightened takes are drawn frame by frame, which browsers slow down in background tabs.
  useEffect(() => {
    if (phase !== "recording") return;
    const onHide = () => {
      if (document.hidden && digitalRec.current) toast.warning("Keep this tab open while recording — the video may stutter otherwise");
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [phase]);
  useEffect(() => { if (phase === "review") useBtn.current?.focus(); }, [phase]);
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - t0.current) / 1000);
      setSecs(s);
      if (s >= maxSeconds && rec.current?.state === "recording") rec.current.stop();
    }, 250);
    return () => clearInterval(t);
  }, [phase, maxSeconds]);

  const acceptTake = async () => {
    if (!take) return;
    gen.current++;
    stopStream(); // the camera light goes off now, not after the upload
    setPhase("sending");
    try {
      await onRecorded(take.blob);
    } finally {
      setTake(null);
      setPhase("idle");
    }
  };
  const again = () => {
    setTake(null);
    setPhase("setup");
  };

  if (!live) {
    return (
      <div className="space-y-1">
        <Button size="sm" disabled={disabled} onClick={() => void start()}><Camera className="size-4" /> {label}</Button>
        <p className="text-[11px] text-muted-foreground">You&apos;ll see a camera check first — pick your camera and microphone, then record.</p>
      </div>
    );
  }

  const locked = phase === "countdown" || phase === "recording" || phase === "sending";
  const reviewing = phase === "review" || phase === "sending";
  const zoomLabel = hwZoom ? "Camera zoom" : "Zoom";
  const sel = "h-8 min-w-0 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary disabled:opacity-50";

  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-border bg-muted/20 p-3">
      {/* Preview / review */}
      <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: "16 / 9" }}>
        <video ref={video} muted playsInline className="hidden" />
        {reviewing && take ? (
          <video src={take.url} controls playsInline className="size-full object-contain" />
        ) : (
          <canvas
            ref={canvas}
            tabIndex={zoom > 1 && !hwZoom ? 0 : -1}
            aria-label={zoom > 1 && !hwZoom ? "Camera preview — drag or use the arrow keys to move the zoomed picture" : "Camera preview"}
            className={cn("size-full object-contain outline-none", prefs.mirror && "-scale-x-100", zoom > 1 && !hwZoom && !locked && "cursor-grab active:cursor-grabbing")}
            onPointerDown={(e) => { if (zoom > 1 && !hwZoom && !locked) { drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); } }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const r = e.currentTarget.getBoundingClientRect();
              const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
              drag.current = { x: e.clientX, y: e.clientY };
              const k = 2 / (zoom - 1);
              nudge((-(dx / r.width) * k) * (prefs.mirror ? -1 : 1), -(dy / r.height) * k);
            }}
            onPointerUp={() => { drag.current = null; }}
            onKeyDown={(e) => {
              if (locked) return;
              const d = 0.1, m = prefs.mirror ? -1 : 1;
              if (e.key === "ArrowLeft") nudge(d * m, 0);
              else if (e.key === "ArrowRight") nudge(-d * m, 0);
              else if (e.key === "ArrowUp") nudge(0, d);
              else if (e.key === "ArrowDown") nudge(0, -d);
              else return;
              e.preventDefault();
            }}
          />
        )}
        {prefs.guide && !reviewing ? (
          <svg viewBox="0 0 160 90" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
            <ellipse cx="80" cy="38" rx="17" ry="23" fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="0.6" strokeDasharray="2 1.5" />
            <path d="M48 90 Q52 68 80 64 Q108 68 112 90" fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="0.6" strokeDasharray="2 1.5" />
          </svg>
        ) : null}
        {phase === "opening" ? <p className="absolute inset-0 grid place-items-center text-sm text-white/80">Starting the camera…</p> : null}
        {phase === "countdown" ? <p aria-live="assertive" className="absolute inset-0 grid place-items-center text-6xl font-bold text-white drop-shadow">{count}</p> : null}
        {phase === "recording" ? (
          <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium tabular-nums text-red-400">● REC {secs}s / {maxSeconds}s</span>
        ) : null}
        {!reviewing ? (
          <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2" aria-hidden>
            <Mic className="size-3.5 text-white/80" />
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
              <div className={cn("h-full rounded-full transition-[width] duration-100", level > 0.85 ? "bg-red-500" : "bg-emerald-400")} style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
          </div>
        ) : null}
      </div>

      <p className="sr-only" role="status">
        {phase === "recording" ? "Recording" : phase === "review" ? "Recording finished — review your take" : ""}
      </p>
      {silent && phase === "setup" ? (
        <p role="status" className="text-xs text-amber-600">We can&apos;t hear anything — say something, or pick another microphone.</p>
      ) : null}

      {!reviewing ? (
        <>
          {/* Devices */}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
              <span className="flex items-center gap-1"><Camera className="size-3" /> Camera</span>
              <select className={sel} value={camId} disabled={locked || cams.length < 1}
                onChange={(e) => { setCamId(e.target.value); remember({ cam: e.target.value }); void open(e.target.value, micId, prefs.quality ?? "720"); }}>
                {cams.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
              <span className="flex items-center gap-1"><Mic className="size-3" /> Microphone</span>
              <select className={sel} value={micId} disabled={locked || mics.length < 1}
                onChange={(e) => { setMicId(e.target.value); remember({ mic: e.target.value }); void open(camId, e.target.value, prefs.quality ?? "720"); }}>
                {mics.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
          </div>

          {/* Picture */}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
              <span className="flex items-center gap-1"><ZoomIn className="size-3" /> {zoomLabel} · {zoom.toFixed(1)}×</span>
              <input type="range" min={1} max={ZOOM_MAX} step={0.1} value={zoom} disabled={locked}
                onChange={(e) => setZoomTo(Number(e.target.value))} aria-label={zoomLabel} />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
              <span className="flex items-center gap-1"><SunMedium className="size-3" /> Brightness</span>
              <input type="range" min={-1} max={1} step={0.05} value={bright} disabled={locked || (!hwBright && !filterOk)}
                onChange={(e) => setBrightTo(Number(e.target.value))} aria-label="Brightness" />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
            <label className="flex items-center gap-1">
              <span>Quality</span>
              <select className={cn(sel, "h-7")} value={prefs.quality ?? "720"} disabled={locked}
                onChange={(e) => { const q = e.target.value as Quality; remember({ quality: q }); void open(camId, micId, q); }}>
                <option value="720">HD 720p</option>
                <option value="1080">Full HD 1080p</option>
              </select>
            </label>
            {actual ? <span className="tabular-nums">{actual}</span> : null}
            <button type="button" disabled={locked} onClick={() => remember({ mirror: !prefs.mirror })} aria-pressed={!!prefs.mirror}
              className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted", prefs.mirror && "text-foreground")}>
              <FlipHorizontal2 className="size-3" /> Mirror preview
            </button>
            <button type="button" onClick={() => remember({ guide: !prefs.guide })} aria-pressed={!!prefs.guide}
              className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted", prefs.guide && "text-foreground")}>
              <ScanFace className="size-3" /> Framing guide
            </button>
            <button type="button" disabled={locked} onClick={() => remember({ countdown: !prefs.countdown })} aria-pressed={!!prefs.countdown}
              className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted", prefs.countdown && "text-foreground")}>
              <Timer className="size-3" /> 3-second countdown
            </button>
            {(zoom > 1 || bright !== 0) && !locked ? (
              <button type="button" onClick={() => { setZoomTo(1); setBrightTo(0); }} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted">
                <RotateCcw className="size-3" /> Reset picture
              </button>
            ) : null}
          </div>
          {zoom > 1 && !hwZoom && !locked ? <p className="text-[11px] text-muted-foreground">Drag the picture (or use the arrow keys) to move it.</p> : null}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {phase === "recording" ? (
              <Button size="sm" variant="destructive" onClick={() => rec.current?.stop()}><Square className="size-4" /> Stop</Button>
            ) : phase === "countdown" ? (
              <Button size="sm" variant="secondary" onClick={() => setPhase("setup")}><X className="size-4" /> Cancel</Button>
            ) : (
              <Button size="sm" disabled={phase !== "setup" || disabled} onClick={record}><Camera className="size-4" /> Record</Button>
            )}
            {phase === "setup" ? <Button size="sm" variant="ghost" onClick={cancel}><X className="size-4" /> Close camera</Button> : null}
            {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
          </div>
          {locked ? <p className="text-[11px] text-muted-foreground">Camera settings are locked while recording, so the picture stays steady.</p> : null}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button ref={useBtn} size="sm" disabled={phase !== "review" || disabled} onClick={() => void acceptTake()}><Check className="size-4" /> Use this take ({take?.secs ?? 0} s)</Button>
          <Button size="sm" variant="secondary" onClick={again}><RotateCcw className="size-4" /> Record again</Button>
          <span className="text-xs text-muted-foreground">Watch it back first — check you can see and hear yourself clearly.</span>
        </div>
      )}
      {phase === "sending" ? <p role="status" className="text-xs text-muted-foreground">Sending…</p> : null}
    </div>
  );
}
