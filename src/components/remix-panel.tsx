"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeftRight, Clapperboard, Film, Loader2, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { CreditsLine, notEnough, useCredits } from "@/components/credits-line";
import { remixCost } from "@/lib/credits";
import { unwrap } from "@/lib/action-result";
import { createRemix, listRemixSources, type RemixSource } from "@/lib/remix-actions";
import type { Quality } from "@/lib/ai/routing";

// Waltz AI → "Remix a video": pick any finished video (AutoWaltz render or Waltz AI clip, any
// project), then weave AI into it — a lead-in that flows into its first shot, moments where a frame
// comes alive in place, and an extension past its last frame. The job runs on the server
// (src/lib/remix-actions.ts → processRemix) and lands here as a new version.

const STYLES = [
  { key: null, label: "As is" },
  { key: "cinematic", label: "Cinematic" },
  { key: "dreamlike", label: "Dreamlike" },
  { key: "action", label: "Action" },
  { key: "commercial", label: "Commercial" },
  { key: "documentary", label: "Documentary" },
] as const;
const QUALITIES: { key: Quality; label: string; min: number }[] = [
  { key: "preview", label: "Preview", min: 1.5 },
  { key: "standard", label: "Standard", min: 3 },
  { key: "high", label: "High", min: 4.5 },
];
type Moment = { at: number; seconds: number; prompt: string };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function RemixPanel({
  projectId,
  busy,
  maxSec,
  onStarted,
}: {
  projectId: string;
  busy: boolean;
  maxSec: number | null;
  onStarted: (jobId: string) => void;
}) {
  const [sources, setSources] = useState<RemixSource[] | null>(null);
  const [filter, setFilter] = useState<"all" | "render" | "version">("all");
  const [picked, setPicked] = useState<RemixSource | null>(null);
  const [dur, setDur] = useState<number | null>(null);
  const [leadOn, setLeadOn] = useState(true);
  const [lead, setLead] = useState({ seconds: 3, prompt: "" });
  const [extOn, setExtOn] = useState(true);
  const [ext, setExt] = useState({ seconds: 5, prompt: "" });
  const [moments, setMoments] = useState<Moment[]>([]);
  const [style, setStyle] = useState<string | null>("cinematic");
  const [quality, setQuality] = useState<Quality>("standard");
  const [pending, start] = useTransition();
  const player = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    listRemixSources().then(setSources, () => setSources([]));
  }, []);

  const shown = useMemo(() => (sources ?? []).filter((s) => filter === "all" || s.kind === filter), [sources, filter]);
  const ok = (s: number) => maxSec == null || s <= maxSec;
  const parts = (leadOn ? 1 : 0) + moments.length + (extOn ? 1 : 0);
  const q = QUALITIES.find((x) => x.key === quality)!;
  const estimate = parts ? Math.max(1, Math.round((Math.ceil(parts / 2) * q.min + 0.5) * 10) / 10) : 0;
  const total = (dur ?? 0) + (leadOn ? lead.seconds : 0) + (extOn ? ext.seconds : 0);
  // AI credits: the seconds AI adds, at this quality (same rule as the server, src/lib/credits.ts).
  const aiSeconds = (leadOn ? lead.seconds : 0) + moments.reduce((n, m) => n + m.seconds, 0) + (extOn ? ext.seconds : 0);
  const cost = parts ? remixCost(aiSeconds, quality) : 0;
  const credits = useCredits(busy);

  function pick(s: RemixSource) {
    setPicked(s);
    setDur(s.durationSec);
    setMoments([]);
  }
  function addMoment() {
    const t = Math.round((player.current?.currentTime ?? 0) * 10) / 10;
    if (moments.length >= 3) return toast.message("Up to 3 moments per remix");
    const clash = moments.some((m) => t < m.at + m.seconds && m.at < t + 3);
    if (clash) return toast.message("That overlaps another moment — scrub a little further");
    if (dur != null && t + 1 > dur) return toast.message("Too close to the end — use Extend for that");
    setMoments((ms) => [...ms, { at: t, seconds: 3, prompt: "" }].sort((a, b) => a.at - b.at));
  }
  function submit() {
    if (!picked) return;
    start(async () => {
      try {
        const jobId = unwrap(await createRemix(projectId, { kind: picked.kind, id: picked.id }, {
          leadIn: leadOn ? lead : null, extend: extOn ? ext : null, moments, style, quality,
        }));
        toast.success("Remix started — it'll appear under Generated versions");
        onStarted(jobId);
      } catch (e) {
        toast.error((e as Error).message || "Could not start the remix");
      }
    });
  }

  // ── 1. Pick a video ─────────────────────────────────────────────────────────────────────────
  if (!picked) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Pick any video you&apos;ve made — AI can lead into it, bring moments to life and carry it on.</p>
          <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
            {([["all", "All"], ["render", "AutoWaltz"], ["version", "Waltz AI"]] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                className={cn("rounded-md px-2.5 py-1", filter === k ? "bg-muted font-medium" : "text-muted-foreground")}>{l}</button>
            ))}
          </div>
        </div>
        {sources === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading your videos…</div>
        ) : shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No finished videos yet. Render one with AutoWaltz or generate a clip, then remix it here.
          </div>
        ) : (
          <div className="grid max-h-[26rem] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
            {shown.map((s) => (
              <button key={`${s.kind}:${s.id}`} type="button" onClick={() => pick(s)}
                className="group overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-[color:var(--cw-violet)]">
                <div className="relative aspect-video bg-black">
                  <video src={`${s.watchUrl}#t=1`} muted playsInline preload="metadata" className="size-full object-cover" />
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {s.kind === "render" ? <Clapperboard className="size-3" /> : <Wand2 className="size-3" />}
                    {s.kind === "render" ? "AutoWaltz" : "Waltz AI"}
                  </span>
                  {s.durationSec ? <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1 text-[10px] tabular-nums text-white">{fmt(s.durationSec)}</span> : null}
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-medium">{s.projectTitle}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{s.label}{s.aspect ? ` · ${s.aspect}` : ""}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── 2. Build the remix ──────────────────────────────────────────────────────────────────────
  const bar = (grow: number, label: string, ai: boolean, key: string) => (
    <div key={key} style={{ flexGrow: Math.max(grow, 0.001) }}
      className={cn("flex min-w-0 items-center justify-center truncate px-1 text-[11px]",
        ai ? "bg-[color:var(--cw-violet)]/20 font-medium text-[color:var(--cw-violet)]" : "bg-muted text-muted-foreground")}>{label}</div>
  );
  const segs: React.ReactNode[] = [];
  if (leadOn) segs.push(bar(lead.seconds, "AI lead-in", true, "lead"));
  let cursor = 0;
  moments.forEach((m, i) => {
    segs.push(bar(m.at - cursor, "your video", false, `v${i}`));
    segs.push(bar(m.seconds, "AI moment", true, `m${i}`));
    cursor = m.at + m.seconds;
  });
  segs.push(bar((dur ?? 30) - cursor, "your video", false, "vend"));
  if (extOn) segs.push(bar(ext.seconds, "AI extend", true, "ext"));

  const secChips = (value: number, set: (n: number) => void, options: number[]) => (
    <div className="flex gap-1">
      {options.map((n) => (
        <button key={n} type="button" disabled={!ok(n)} aria-pressed={value === n} onClick={() => set(n)}
          className={cn("rounded-full border px-2.5 py-0.5 text-xs disabled:opacity-40",
            value === n ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border text-muted-foreground")}>{n}s</button>
      ))}
    </div>
  );
  const promptBox = (value: string, set: (v: string) => void, placeholder: string) => (
    <input value={value} onChange={(e) => set(e.target.value.slice(0, 600))} placeholder={placeholder}
      className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs outline-none focus:border-[color:var(--cw-violet)]" />
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm"><span className="font-medium">{picked.projectTitle}</span> <span className="text-muted-foreground">· {picked.label}</span></p>
        <Button variant="ghost" size="sm" onClick={() => setPicked(null)}><ArrowLeftRight className="size-3.5" /> Change</Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-black">
        <video ref={player} src={picked.watchUrl} controls playsInline className="max-h-[45vh] w-full"
          onLoadedMetadata={(e) => setDur(Math.round(e.currentTarget.duration * 10) / 10)} />
      </div>
      <div className="space-y-1">
        <div className="flex h-8 overflow-hidden rounded-lg border border-border">{segs}</div>
        <p className="text-[11px] text-muted-foreground">
          About {fmt(total)} long · the song keeps playing under the AI parts · your original stays untouched
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className={cn("space-y-2 rounded-xl border p-3", leadOn ? "border-[color:var(--cw-violet)]/60" : "border-border")}>
          <label className="flex items-center justify-between gap-2 text-sm font-medium">
            <span className="inline-flex items-center gap-1.5"><Film className="size-4" /> Lead-in</span>
            <input type="checkbox" checked={leadOn} onChange={(e) => setLeadOn(e.target.checked)} />
          </label>
          <p className="text-[11px] text-muted-foreground">AI builds an opening that flows into your first shot.</p>
          {leadOn ? <>{secChips(lead.seconds, (n) => setLead({ ...lead, seconds: n }), [3, 5])}{promptBox(lead.prompt, (v) => setLead({ ...lead, prompt: v }), "Sweeping in from the sky…")}</> : null}
        </div>
        <div className={cn("space-y-2 rounded-xl border p-3", moments.length ? "border-[color:var(--cw-violet)]/60" : "border-border")}>
          <div className="flex items-center justify-between gap-2 text-sm font-medium">
            <span className="inline-flex items-center gap-1.5"><Sparkles className="size-4" /> Moment magic</span>
            <span className="text-[11px] font-normal text-muted-foreground">{moments.length}/3</span>
          </div>
          <p className="text-[11px] text-muted-foreground">Pause the player on a frame — AI brings it to life, in place.</p>
          {moments.map((m, i) => (
            <div key={`${m.at}-${i}`} className="space-y-1 rounded-lg bg-muted/50 p-2">
              <div className="flex items-center justify-between text-xs">
                <span className="tabular-nums">at {fmt(m.at)}</span>
                <button type="button" aria-label={`Remove moment at ${fmt(m.at)}`} onClick={() => setMoments(moments.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
              </div>
              {secChips(m.seconds, (n) => setMoments(moments.map((x, j) => (j === i ? { ...x, seconds: n } : x))), [3, 5])}
              {promptBox(m.prompt, (v) => setMoments(moments.map((x, j) => (j === i ? { ...x, prompt: v } : x))), "Spray explodes in slow motion…")}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addMoment} disabled={moments.length >= 3} className="w-full"><Plus className="size-3.5" /> Add moment at current frame</Button>
        </div>
        <div className={cn("space-y-2 rounded-xl border p-3", extOn ? "border-[color:var(--cw-violet)]/60" : "border-border")}>
          <label className="flex items-center justify-between gap-2 text-sm font-medium">
            <span className="inline-flex items-center gap-1.5"><Wand2 className="size-4" /> Extend</span>
            <input type="checkbox" checked={extOn} onChange={(e) => setExtOn(e.target.checked)} />
          </label>
          <p className="text-[11px] text-muted-foreground">AI carries the action on past your last frame.</p>
          {extOn ? <>{secChips(ext.seconds, (n) => setExt({ ...ext, seconds: n }), [3, 5, 8])}{promptBox(ext.prompt, (v) => setExt({ ...ext, prompt: v }), "Racing off into the sunset…")}</> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-muted-foreground">Style</span>
          {STYLES.map((s) => (
            <button key={s.label} type="button" aria-pressed={style === s.key} onClick={() => setStyle(s.key)}
              className={cn("rounded-full border px-2.5 py-0.5", style === s.key ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border text-muted-foreground")}>{s.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-muted-foreground">Quality</span>
          {QUALITIES.map((x) => (
            <button key={x.key} type="button" aria-pressed={quality === x.key} onClick={() => setQuality(x.key)}
              className={cn("rounded-full border px-2.5 py-0.5", quality === x.key ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border text-muted-foreground")}>{x.label}</button>
          ))}
        </div>
      </div>

      {!busy ? (
        <>
        <Button onClick={submit} disabled={pending || parts === 0 || notEnough(credits, cost)} size="lg"
          className="h-14 w-full bg-[image:var(--cw-spectrum)] text-base font-semibold text-white shadow-lg hover:opacity-90">
          {pending ? <><Loader2 className="size-5 animate-spin" /> Starting…</>
            : parts === 0 ? <><X className="size-5" /> Turn on a lead-in, a moment or extend</>
            : <><Sparkles className="size-5" /> Remix · {parts} AI part{parts > 1 ? "s" : ""} · ~{estimate} min</>}
        </Button>
        {parts ? <CreditsLine cost={cost} balance={credits} className="w-full justify-center" /> : null}
        </>
      ) : null}
    </div>
  );
}
