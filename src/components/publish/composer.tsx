"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, CalendarClock, CircleCheck, Clock, Film, Gauge, Hash, ImageIcon, Info, Languages, Loader2, Paperclip, Send,
  Sparkles, Wand2, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { unwrap } from "@/lib/action-result";
import { useHydrated } from "@/lib/local-date";
import { preflight, type TargetPreflight } from "@/lib/social/publishing/preflight";
import {
  aiAssist, critiquePost, deleteUnattachedMedia, savePost, scoreCalibration, suggestedTimes, writeCopyForNetworks, type SavePostInput,
} from "@/lib/social/ui-actions";
import { scoreChecks } from "@/lib/social/score-checks";
import { providerName, type ComposePrefill, type DestinationView, type MediaView, type PostView } from "@/lib/social/ui-types";
import { uploadPostMedia } from "./upload-media";

type Pending = { key: string; name: string; pct: number };

const SEVERITY_STYLE: Record<string, string> = {
  blocked: "text-destructive",
  adjust: "text-amber-600 dark:text-amber-400",
  warn: "text-muted-foreground",
};

function mb(n: number) {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

type Suggestions = {
  timezone: string;
  networks: {
    provider: string;
    personalised: boolean;
    posts: number;
    note: string;
    slots: { weekday: number; hour: number; lift: number | null; posts: number; next: string }[];
  }[];
};
type Calib = { posts: number; rho: number; showScore: boolean };

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK = 7 * 86_400_000;

/** The next time (after now) a weekday + hour comes round in the browser's own time zone. */
function nextLocal(weekday: number, hour: number): Date {
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hour, 0, 0, 0);
    if (d.getDay() === weekday && d.getTime() > now.getTime() + 5 * 60_000) return d;
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, hour, 0, 0, 0);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** The multi-network composer: one text, optional per-network versions, live limits and pre-flight per channel. */
export function Composer({
  destinations,
  prefill,
  editing,
  aiAvailable,
  approvalRule = { required: false, approver: false },
}: {
  destinations: DestinationView[];
  prefill: ComposePrefill | null;
  editing: PostView | null;
  aiAvailable: boolean;
  /** G9: does the workspace require approval, and is the caller an approver? */
  approvalRule?: { required: boolean; approver: boolean };
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  const [text, setText] = useState(editing?.text ?? prefill?.text ?? "");
  const [link, setLink] = useState(editing?.link ?? prefill?.link ?? "");
  const [selected, setSelected] = useState<string[]>(
    editing ? editing.destinations.map((d) => d.key) : (prefill?.suggested ?? []),
  );
  const [overrides, setOverrides] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(editing?.perNetwork ?? {})) if (v?.text) o[k] = v.text;
    return o;
  });
  const [media, setMedia] = useState<MediaView[]>(editing?.media ?? prefill?.media ?? []);
  const [video, setVideo] = useState(prefill?.video ?? null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [approval, setApproval] = useState(editing?.approvalStatus === "pending");
  // A saved schedule is shown in the viewer's time zone, which is only known after hydration (src/lib/local-date.ts).
  const hydrated = useHydrated();
  const initialWhen = hydrated && editing?.scheduledAt ? new Date(editing.scheduledAt) : null;
  const [dayState, setDay] = useState<Date | undefined | null>(null); // null = untouched
  const [timeState, setTime] = useState<string | null>(null);
  const day = dayState === null ? (initialWhen ?? undefined) : dayState;
  const time = timeState ?? (initialWhen ? `${pad(initialWhen.getHours())}:${pad(initialWhen.getMinutes())}` : "09:00");
  const [tab, setTab] = useState("all");
  const fileRef = useRef<HTMLInputElement>(null);

  const usable = destinations.filter((d) => d.configured);
  const chosen = usable.filter((d) => selected.includes(d.key));
  // G9: an editor in a workspace that requires approval sends posts for review instead of publishing them.
  const reviewFirst = approvalRule.required && !approvalRule.approver;
  const holdForApproval = reviewFirst || (!approvalRule.required && approval);

  // G6 suggested times, per selected network (re-fetched when the channel set changes).
  const providerSet = [...new Set(chosen.map((d) => d.provider))].sort().join(",");
  const [suggest, setSuggest] = useState<Suggestions | null>(null);
  useEffect(() => {
    let live = true;
    if (!providerSet) return;
    void suggestedTimes(providerSet.split(",")).then((r) => {
      if (live && r.ok) setSuggest(r.data);
    });
    return () => {
      live = false;
    };
  }, [providerSet]);
  // G8: is the estimate backed by this workspace's own history?
  const [calib, setCalib] = useState<Calib | null>(null);
  useEffect(() => {
    let live = true;
    void scoreCalibration().then((r) => {
      if (live && r.ok) setCalib(r.data);
    });
    return () => {
      live = false;
    };
  }, []);
  const [critique, setCritique] = useState<string | null>(null);

  // Recomputed every render: pure and cheap (a few string counts per selected channel).
  const checks: TargetPreflight[] = (() => {
    const m = [
      ...media.map((x) => ({ id: x.id, kind: x.kind, filename: x.filename, mime: x.mime, size: x.size })),
      ...(video ? [{ id: video.id, kind: "video" as const, filename: video.filename, mime: video.mime, size: video.size }] : []),
    ];
    const perNetwork: Record<string, { text?: string }> = {};
    for (const [k, v] of Object.entries(overrides)) if (v.trim()) perNetwork[k] = { text: v };
    return preflight({
      text,
      link: link.trim() || undefined,
      media: m,
      targets: chosen.map((d) => ({ key: d.key, provider: d.provider, label: d.label })),
      perNetwork,
    });
  })();
  const blocked = checks.filter((c) => c.severity === "blocked");

  function toggle(key: string, on: boolean) {
    setSelected((s) => (on ? [...new Set([...s, key])] : s.filter((k) => k !== key)));
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      setPending((p) => [...p, { key, name: file.name, pct: 0 }]);
      try {
        const up = await uploadPostMedia(file, (pct) => setPending((p) => p.map((x) => (x.key === key ? { ...x, pct } : x))));
        const preview = up.kind === "image" ? URL.createObjectURL(file) : null;
        setMedia((m) => [...m, { id: up.id, kind: up.kind, filename: file.name, mime: file.type, size: up.size, previewUrl: preview }]);
      } catch (e) {
        toast.error(`${file.name}: ${(e as Error).message}`);
      } finally {
        setPending((p) => p.filter((x) => x.key !== key));
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeMedia(id: string) {
    setMedia((m) => m.filter((x) => x.id !== id));
    // Only an upload made here (not yet saved on a post) is deleted; a saved post's media is released on save.
    if (!editing?.media.some((x) => x.id === id)) void deleteUnattachedMedia(id);
  }

  async function ai(mode: "write" | "improve" | "shorten" | "hashtags", target: "all" | string) {
    const current = target === "all" ? text : (overrides[target] ?? text);
    setAiBusy(`${mode}:${target}`);
    try {
      const out = unwrap(await aiAssist(mode, current || (video ? `A short video called "${video.projectTitle}"` : ""), "standard"));
      const next = mode === "hashtags" ? `${current.trim()}\n\n${out.trim()}` : out;
      if (target === "all") setText(next);
      else setOverrides((o) => ({ ...o, [target]: next }));
      toast.success(mode === "hashtags" ? "Hashtags added." : "Done. Read it over before you post.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiBusy(null);
    }
  }

  function when(): Date | null {
    if (!day) return null;
    const [h, m] = time.split(":").map(Number);
    const d = new Date(day);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
  }

  function pickSlot(iso: string) {
    const d = new Date(iso);
    setDay(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
    setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  }

  // G8 timing check: does the chosen time land on a suggested slot (same weekday + hour, any week)?
  function timingKind(): "personalised" | "general" | "other" | "none" {
    const at = when();
    if (!at) return "none";
    const nets = (suggest?.networks ?? []).filter((n) => n.slots.length);
    const hit = (n: (typeof nets)[number]) =>
      n.slots.some((sl) => {
        const ref = n.personalised ? new Date(sl.next) : nextLocal(sl.weekday, sl.hour);
        const diff = (((at.getTime() - ref.getTime()) % WEEK) + WEEK) % WEEK;
        return diff < 3_600_000 || diff > WEEK - 3_600_000;
      });
    if (nets.some((n) => n.personalised && hit(n))) return "personalised";
    if (nets.some((n) => !n.personalised && hit(n))) return "general";
    return "other";
  }

  const perNetworkText: Record<string, string> = {};
  for (const d of chosen) if (overrides[d.key]?.trim()) perNetworkText[d.provider] = overrides[d.key];
  const score = scoreChecks({
    text,
    link: link.trim() || null,
    hasImage: media.some((m) => m.kind === "image"),
    hasVideo: Boolean(video) || media.some((m) => m.kind === "video"),
    providers: chosen.map((d) => d.provider),
    perNetwork: perNetworkText,
    timing: timingKind(),
  });

  async function runCritique() {
    setAiBusy("critique");
    try {
      setCritique(unwrap(await critiquePost(text, selected)));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiBusy(null);
    }
  }

  // G4: one click — a caption + hashtags for each selected network, written into each network's own version.
  async function copyEach() {
    setAiBusy("each");
    try {
      const brief = text.trim() || (video ? `A short video called "${video.projectTitle}"` : "");
      const out = unwrap(
        await writeCopyForNetworks({ brief, keys: selected, mediaIds: media.map((m) => m.id), video: Boolean(video), link: link.trim() || null }),
      );
      setOverrides((o) => {
        const n = { ...o };
        for (const c of out) n[c.key] = c.text;
        return n;
      });
      const bad = out.filter((c) => c.preflight.severity === "blocked");
      if (bad.length) toast.warning(`Written — but ${bad.map((b) => b.preflight.label ?? b.provider).join(", ")} still can't take it (see Channels).`);
      else toast.success(`Wrote a version for ${out.length} network${out.length === 1 ? "" : "s"}. Read them over in each tab.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiBusy(null);
    }
  }

  function submit(mode: SavePostInput["mode"]) {
    const at = when();
    if (mode === "schedule" && !at) {
      toast.error("Pick a day and time to schedule it.");
      return;
    }
    if ((mode === "publish" || mode === "schedule") && blocked.length) {
      toast.error(`Fix ${blocked.map((b) => b.label ?? providerName(b.provider)).join(", ")} first, or untick it.`);
      return;
    }
    const perNetwork: Record<string, { text?: string }> = {};
    for (const [k, v] of Object.entries(overrides)) if (v.trim() && selected.includes(k)) perNetwork[k] = { text: v };
    start(async () => {
      try {
        const r = unwrap(
          await savePost({
            id: editing?.id ?? null,
            text,
            link: link.trim() || null,
            providers: selected,
            perNetwork,
            mediaIds: media.map((m) => m.id),
            video: video ? { source: video.source, id: video.id } : null,
            scheduledAt: at?.toISOString() ?? null,
            mode,
            requireApproval: approval,
          }),
        );
        if (r.submitted && mode !== "draft") toast.success(mode === "schedule" ? "Scheduled and sent for approval — it goes out once approved." : "Sent for approval.");
        else if (mode === "publish") toast.success(`Publishing to ${r.publish?.queued ?? selected.length} channel(s)…`);
        else if (mode === "schedule") toast.success("Scheduled.");
        else if (mode === "queue") toast.success("Added to the Auto Post queue.");
        else toast.success("Draft saved.");
        router.push(
          r.submitted && mode === "publish" ? "/publish/review"
          : mode === "draft" ? "/publish/drafts" : mode === "schedule" ? "/publish/calendar" : mode === "queue" ? "/publish/auto" : "/publish/posts",
        );
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const aiButtons = (target: "all" | string) =>
    aiAvailable ? (
      <div className="flex flex-wrap gap-1.5">
        {([
          ["write", "Write it", Sparkles],
          ["improve", "Improve", Wand2],
          ["shorten", "Shorten", Wand2],
          ["hashtags", "Hashtags", Hash],
        ] as const).map(([mode, label, Icon]) => (
          <Button key={mode} type="button" size="sm" variant="outline" disabled={aiBusy !== null} onClick={() => void ai(mode, target)}>
            {aiBusy === `${mode}:${target}` ? <Loader2 className="animate-spin" /> : <Icon />}
            {label}
          </Button>
        ))}
        <span className="self-center text-xs text-muted-foreground">AI writing is free (0 credits).</span>
      </div>
    ) : null;

  const meter = (c: TargetPreflight) =>
    c.limit ? (
      <span className={cn("tabular-nums text-xs", c.count !== null && c.count > c.limit ? "text-destructive" : "text-muted-foreground")}>
        {c.count ?? 0} / {c.limit}
      </span>
    ) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="space-y-4">
        {prefill?.note || video ? (
          <Alert>
            <Film />
            <AlertTitle>{video ? `Publishing “${video.projectTitle}”` : prefill?.media?.length ? "From Waltz Image" : "From your video"}</AlertTitle>
            <AlertDescription>
              {prefill?.note ?? ""}
              {prefill && prefill.suggested.length === 0 && video ? " None of those networks is connected yet — tick the channels to post to, or connect one under Networks." : ""}
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Post</CardTitle>
            <CardDescription>Write once. Open a network&apos;s tab to give it its own version.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
              <div className="overflow-x-auto overflow-y-hidden pb-1">
                <TabsList>
                  <TabsTrigger value="all">All networks</TabsTrigger>
                  {chosen.map((d) => (
                    <TabsTrigger key={d.key} value={d.key}>
                      {d.label}
                      {overrides[d.key]?.trim() ? <span className="size-1.5 rounded-full bg-primary" aria-label="custom text" /> : null}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              <TabsContent value="all" className="space-y-3 pt-2">
                <Textarea
                  aria-label="Post text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="What do you want to say? Or type a short brief and press “Write it”."
                  className="min-h-40"
                />
                {aiButtons("all")}
                {aiAvailable && chosen.length ? (
                  <Button type="button" size="sm" variant="secondary" disabled={aiBusy !== null} onClick={() => void copyEach()}>
                    {aiBusy === "each" ? <Loader2 className="animate-spin" /> : <Languages />}
                    Write copy + hashtags for each network
                  </Button>
                ) : null}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {checks.map((c) => (
                    <span key={c.key} className="inline-flex items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">{c.label}</span> {meter(c)}
                    </span>
                  ))}
                </div>
              </TabsContent>
              {chosen.map((d) => {
                const c = checks.find((x) => x.key === d.key);
                const custom = overrides[d.key] !== undefined;
                return (
                  <TabsContent key={d.key} value={d.key} className="space-y-3 pt-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="flex items-center gap-2">
                        <Switch
                          checked={custom}
                          onCheckedChange={(on) =>
                            setOverrides((o) => {
                              const n = { ...o };
                              if (on) n[d.key] = o[d.key] ?? text;
                              else delete n[d.key];
                              return n;
                            })
                          }
                        />
                        Write a separate version for {d.label}
                      </Label>
                      {c ? meter(c) : null}
                    </div>
                    {custom ? (
                      <>
                        <Textarea
                          aria-label={`Text for ${d.label}`}
                          value={overrides[d.key]}
                          onChange={(e) => setOverrides((o) => ({ ...o, [d.key]: e.target.value }))}
                          className="min-h-36"
                        />
                        {aiButtons(d.key)}
                      </>
                    ) : null}
                    {c ? (
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">What {d.label} will receive</p>
                        <p className="text-sm whitespace-pre-wrap">{c.resolvedText || <span className="text-muted-foreground">Nothing yet.</span>}</p>
                      </div>
                    ) : null}
                  </TabsContent>
                );
              })}
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Link and media</CardTitle>
            <CardDescription>Images (JPG, PNG, GIF, WebP) and video (MP4, MOV, WebM) up to 200 MB. Large videos upload in parts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="post-link">Link (optional)</Label>
              <Input id="post-link" type="url" inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {video ? (
                <li className="flex items-center gap-3 rounded-lg border border-border p-2">
                  <Film className="size-8 shrink-0 text-[color:var(--cw-violet)]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{video.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      ClipWaltz {video.source} · {video.aspect ?? "video"}{video.size ? ` · ${mb(video.size)}` : ""}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove the video" onClick={() => setVideo(null)}><X /></Button>
                </li>
              ) : null}
              {media.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-lg border border-border p-2">
                  {m.kind === "image" && m.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed / blob preview URL, not a static asset
                    <img src={m.previewUrl} alt="" className="size-10 shrink-0 rounded object-cover" />
                  ) : m.kind === "image" ? (
                    <ImageIcon className="size-8 shrink-0 text-muted-foreground" />
                  ) : (
                    <Film className="size-8 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.filename}</p>
                    <p className="text-xs text-muted-foreground">{m.kind} · {mb(m.size)}</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${m.filename}`} onClick={() => removeMedia(m.id)}><X /></Button>
                </li>
              ))}
              {pending.map((p) => (
                <li key={p.key} className="space-y-1.5 rounded-lg border border-dashed border-border p-2">
                  <p className="truncate text-sm">{p.name}</p>
                  <Progress value={p.pct} aria-label={`Uploading ${p.name}`} />
                </li>
              ))}
            </ul>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm"
              multiple
              className="sr-only"
              id="post-media"
              onChange={(e) => void onFiles(e.target.files)}
            />
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              <Paperclip /> Add images or video
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-[calc(var(--cw-header-h)+1rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Channels</CardTitle>
            <CardDescription>
              {usable.length ? `${chosen.length} of ${usable.length} selected` : "No channels connected yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {usable.length === 0 ? (
              <Link href="/publish/networks" className={buttonVariants({ variant: "default", size: "sm" })}>Connect a network</Link>
            ) : (
              usable.map((d) => {
                const c = checks.find((x) => x.key === d.key);
                const on = selected.includes(d.key);
                return (
                  <div key={d.key} className="space-y-1">
                    <Label className="flex items-center gap-2 font-normal">
                      <Checkbox checked={on} onCheckedChange={(v) => toggle(d.key, Boolean(v))} />
                      <span className="min-w-0 flex-1 truncate">{d.label}</span>
                      <span className="text-xs text-muted-foreground">{providerName(d.provider)}</span>
                      {on && c?.severity === "blocked" ? <AlertTriangle className="size-4 text-destructive" aria-label="blocked" /> : null}
                      {on && c && !c.severity ? <CircleCheck className="size-4 text-emerald-600" aria-label="ready" /> : null}
                    </Label>
                    {on && c?.findings.length ? (
                      <ul className="ml-6 space-y-0.5">
                        {c.findings.map((f, i) => (
                          <li key={i} className={cn("text-xs", SEVERITY_STYLE[f.severity])}>{f.message}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })
            )}
            {destinations.some((d) => !d.configured) ? (
              <p className="pt-1 text-xs text-muted-foreground">
                <Info className="mr-1 inline size-3" />
                {destinations.filter((d) => !d.configured).length} paused or unfinished channel(s) are hidden. Manage them under Networks.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>When</CardTitle>
            <CardDescription>Publish now, schedule it, or save it for later.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger render={<Button type="button" variant="outline" className="flex-1 justify-start" />}>
                  <CalendarClock />
                  {day ? day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "Pick a day"}
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={day}
                    onSelect={setDay}
                    disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
                  />
                </PopoverContent>
              </Popover>
              <Input type="time" aria-label="Time" value={time} onChange={(e) => setTime(e.target.value)} className="w-28" />
            </div>
            {day ? (
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setDay(undefined)}>
                Clear the date
              </button>
            ) : null}
            {providerSet && suggest?.networks.length ? (
              <div className="space-y-1.5 rounded-lg border border-border p-2.5">
                <p className="flex items-center gap-1.5 text-xs font-medium"><Clock className="size-3.5" /> Suggested times</p>
                {suggest.networks.map((n) => (
                  <div key={n.provider} className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{providerName(n.provider)}</span> — {n.note}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {n.slots.map((sl) => {
                        // General guidance is office hours where YOU are; learnt slots are instants from your data.
                        const d = n.personalised ? new Date(sl.next) : nextLocal(sl.weekday, sl.hour);
                        return (
                          <Button
                            key={sl.next}
                            type="button"
                            size="xs"
                            variant={n.personalised ? "secondary" : "outline"}
                            title={n.personalised && sl.lift ? `${sl.posts} of your posts went out in this slot; ${sl.lift}× your average on ${providerName(n.provider)}` : "General guidance — not from your posts"}
                            onClick={() => pickSlot(d.toISOString())}
                          >
                            {hydrated ? `${WEEKDAY[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}` : `${WEEKDAY[sl.weekday]} ${pad(sl.hour)}:00`}
                            {n.personalised ? <span className="ml-0.5 text-[10px] opacity-70">Suggested</span> : null}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">Shown in your time zone. A pick fills the day and time above.</p>
              </div>
            ) : null}
            {approvalRule.required ? (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3 shrink-0" />
                {approvalRule.approver
                  ? "This workspace needs approval. You're an approver, so saving or publishing approves it."
                  : "This workspace needs approval. Publish or Schedule sends it to an approver; it goes out once approved."}
              </p>
            ) : (
              <Label className="flex items-center gap-2 font-normal">
                <Switch checked={approval} onCheckedChange={setApproval} />
                Ask an approver before it goes out
              </Label>
            )}
            {blocked.length ? (
              <p className="text-xs text-destructive">
                {blocked.length} channel{blocked.length === 1 ? "" : "s"} can&apos;t take this post as it is. See the notes under Channels.
              </p>
            ) : null}
            <div className="grid gap-2">
              <Button
                type="button"
                disabled={busy || !chosen.length || !text.trim() || pending.length > 0 || (approval && !approvalRule.required)}
                onClick={() => submit("publish")}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Send />} {reviewFirst ? "Send for approval" : "Publish now"}
              </Button>
              <Button type="button" variant="secondary" disabled={busy || !chosen.length || !text.trim() || pending.length > 0 || !day} onClick={() => submit("schedule")}>
                <CalendarClock /> {holdForApproval ? "Schedule & send for approval" : "Schedule"}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" disabled={busy || !text.trim() || !chosen.length || pending.length > 0} onClick={() => submit("draft")}>
                  Save draft
                </Button>
                <Button type="button" variant="outline" disabled={busy || !text.trim() || !chosen.length || pending.length > 0} onClick={() => submit("queue")}>
                  Add to queue
                </Button>
              </div>
              {approval && !approvalRule.required ? <p className="text-xs text-muted-foreground">Posts waiting for approval can be saved or scheduled, not published straight away.</p> : null}
            </div>
            {editing ? <Badge variant="outline">Editing a saved post</Badge> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Gauge className="size-4" /> Engagement estimate</CardTitle>
            <CardDescription>
              {calib?.showScore
                ? `An estimate, not a prediction: this checklist ranked your ${calib.posts} past posts in roughly the order they performed (rank correlation ${calib.rho}).`
                : `A checklist, not a prediction. A score appears once at least 20 of your published posts have results and the checklist ranks them in the order they performed${calib ? ` (now ${calib.posts} post${calib.posts === 1 ? "" : "s"}${calib.posts >= 3 ? `, correlation ${calib.rho}` : ""})` : ""}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {calib?.showScore ? (
              <p className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums">≈ {score.total}</span>
                <span className="text-sm text-muted-foreground">/ 100 · estimate</span>
              </p>
            ) : null}
            <ul className="space-y-1.5">
              {score.reasons.map((r) => (
                <li key={r.label} className="text-xs">
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      {r.points >= r.max ? <CircleCheck className="size-3.5 text-emerald-600" /> : <AlertTriangle className="size-3.5 text-amber-500" />}
                      {r.label}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{r.points}/{r.max}</span>
                  </span>
                  {r.tip ? <span className="ml-5 block text-muted-foreground">{r.tip}</span> : null}
                </li>
              ))}
            </ul>
            {aiAvailable ? (
              <Button type="button" size="sm" variant="outline" disabled={aiBusy !== null || !text.trim()} onClick={() => void runCritique()}>
                {aiBusy === "critique" ? <Loader2 className="animate-spin" /> : <Sparkles />} AI critique (free)
              </Button>
            ) : null}
            {critique ? (
              <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                <p className="mb-1 text-xs font-medium text-muted-foreground">The AI&apos;s opinion — check it against what you know works</p>
                <p className="text-xs whitespace-pre-wrap">{critique}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
