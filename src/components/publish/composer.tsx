"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, CalendarClock, CircleCheck, Film, Hash, ImageIcon, Info, Loader2, Paperclip, Send, Sparkles, Wand2, X,
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
import { aiAssist, deleteUnattachedMedia, savePost, type SavePostInput } from "@/lib/social/ui-actions";
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

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** The multi-network composer: one text, optional per-network versions, live limits and pre-flight per channel. */
export function Composer({
  destinations,
  prefill,
  editing,
  aiAvailable,
}: {
  destinations: DestinationView[];
  prefill: ComposePrefill | null;
  editing: PostView | null;
  aiAvailable: boolean;
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
        if (mode === "publish") toast.success(`Publishing to ${r.publish?.queued ?? selected.length} channel(s)…`);
        else if (mode === "schedule") toast.success("Scheduled.");
        else if (mode === "queue") toast.success("Added to the Auto Post queue.");
        else toast.success("Draft saved.");
        router.push(mode === "draft" ? "/publish/drafts" : mode === "schedule" ? "/publish/calendar" : mode === "queue" ? "/publish/auto" : "/publish/posts");
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
            <Label className="flex items-center gap-2 font-normal">
              <Switch checked={approval} onCheckedChange={setApproval} />
              Ask an approver before it goes out
            </Label>
            {blocked.length ? (
              <p className="text-xs text-destructive">
                {blocked.length} channel{blocked.length === 1 ? "" : "s"} can&apos;t take this post as it is. See the notes under Channels.
              </p>
            ) : null}
            <div className="grid gap-2">
              <Button type="button" disabled={busy || !chosen.length || !text.trim() || pending.length > 0 || approval} onClick={() => submit("publish")}>
                {busy ? <Loader2 className="animate-spin" /> : <Send />} Publish now
              </Button>
              <Button type="button" variant="secondary" disabled={busy || !chosen.length || !text.trim() || pending.length > 0 || !day} onClick={() => submit("schedule")}>
                <CalendarClock /> Schedule
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" disabled={busy || !text.trim() || !chosen.length || pending.length > 0} onClick={() => submit("draft")}>
                  Save draft
                </Button>
                <Button type="button" variant="outline" disabled={busy || !text.trim() || !chosen.length || pending.length > 0} onClick={() => submit("queue")}>
                  Add to queue
                </Button>
              </div>
              {approval ? <p className="text-xs text-muted-foreground">Posts waiting for approval can be saved or scheduled, not published straight away.</p> : null}
            </div>
            {editing ? <Badge variant="outline">Editing a saved post</Badge> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
