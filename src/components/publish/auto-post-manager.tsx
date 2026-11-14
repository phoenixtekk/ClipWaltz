"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bookmark, Copy, Loader2, Pencil, Plus, Repeat2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LocalDate } from "@/components/local-date";
import { unwrap } from "@/lib/action-result";
import {
  copyRule, deletePreset, duplicatePost, removeRule, savePreset, saveRule, setRuleOn,
} from "@/lib/social/ui-actions";
import type { DestinationView, PostView } from "@/lib/social/ui-types";

export interface RuleView {
  id: string;
  name: string;
  daysOfWeek: string;
  timeOfDay: string;
  timezone: string | null;
  providers: string;
  active: boolean;
  mode: string;
  seedPrompt: string;
  topics: string;
  links: string;
  linkUtm: boolean;
  reviewFirst: boolean;
  // Not editable until P3 (AI images / explainer video), but carried through so saving a rule never blanks them.
  imageMode: string;
  videoMode: string;
  imageSet: string;
  productId: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  postsTotal: number;
  postsRecent: number;
  clashesWith: string[];
}

export interface PresetView {
  id: string;
  name: string;
  daysOfWeek: string;
  timeOfDay: string;
  providers: string;
  mode: string;
  seedPrompt: string;
  topics: string;
  links: string;
  linkUtm: boolean;
  reviewFirst: boolean;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Draft {
  id: string | null;
  name: string;
  days: number[];
  times: string;
  timezone: string;
  providers: string[];
  mode: "queue" | "generate";
  seedPrompt: string;
  topics: string;
  links: string;
  linkUtm: boolean;
  reviewFirst: boolean;
  active: boolean;
  keep: { imageMode: string; videoMode: string; imageSet: string[]; productId: string | null };
}

function fromConfig(c: Partial<RuleView & PresetView>, id: string | null, tz: string): Draft {
  return {
    id,
    name: c.name ?? "New rule",
    days: (c.daysOfWeek ?? "1,2,3,4,5").split(",").filter(Boolean).map(Number),
    times: c.timeOfDay ?? "09:00",
    timezone: c.timezone || tz,
    providers: (c.providers ?? "").split(",").filter(Boolean),
    mode: c.mode === "generate" ? "generate" : "queue",
    seedPrompt: c.seedPrompt ?? "",
    topics: c.topics ?? "",
    links: c.links ?? "",
    linkUtm: Boolean(c.linkUtm),
    reviewFirst: Boolean(c.reviewFirst),
    active: c.active ?? true,
    keep: {
      imageMode: c.imageMode ?? "none",
      videoMode: c.videoMode ?? "none",
      imageSet: (c.imageSet ?? "").split(",").filter(Boolean),
      productId: c.productId ?? null,
    },
  };
}

/** Auto Post: recurring rules that post from the queue (or write a post with AI) on a schedule, presets, Re-Share. */
export function AutoPostManager({
  rules,
  presets,
  destinations,
  queued,
  published,
}: {
  rules: RuleView[];
  presets: PresetView[];
  destinations: DestinationView[];
  queued: number;
  published: PostView[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [presetName, setPresetName] = useState("");
  const usable = destinations.filter((d) => d.configured);
  const label = (k: string) => destinations.find((d) => d.key === k)?.label ?? k.split("#")[0];
  const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  function run(fn: () => Promise<unknown>, ok?: string) {
    start(async () => {
      try {
        await fn();
        if (ok) toast.success(ok);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function body(d: Draft) {
    return {
      name: d.name,
      daysOfWeek: d.days,
      timesOfDay: d.times.split(",").map((t) => t.trim()).filter(Boolean),
      timezone: d.timezone,
      providers: d.providers,
      active: d.active,
      mode: d.mode,
      seedPrompt: d.seedPrompt,
      topics: d.topics,
      links: d.links,
      linkUtm: d.linkUtm,
      reviewFirst: d.reviewFirst,
      ...d.keep,
    };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {queued} post{queued === 1 ? "" : "s"} waiting in the queue. A queue rule posts the oldest one at each time slot; an AI rule writes a fresh post when the queue is empty.
        </p>
        <Button onClick={() => setDraft(fromConfig({}, null, tz()))} disabled={usable.length === 0}>
          <Plus /> New rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No rules yet. {usable.length === 0 ? "Connect a channel under Networks first." : "Create one to post on a schedule."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rules.map((r) => (
            <Card key={r.id} size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {r.name}
                  <Badge variant={r.mode === "generate" ? "secondary" : "outline"}>{r.mode === "generate" ? "AI writes" : "Queue"}</Badge>
                </CardTitle>
                <CardDescription>
                  {r.daysOfWeek.split(",").filter(Boolean).map((d) => DAYS[Number(d)]).join(", ")} at {r.timeOfDay.split(",").join(", ")}
                  {r.timezone ? ` (${r.timezone})` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {r.providers.split(",").filter(Boolean).map((k) => <Badge key={k} variant="secondary">{label(k)}</Badge>)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.postsTotal} post{r.postsTotal === 1 ? "" : "s"} so far ({r.postsRecent} this week)
                  {r.active && r.nextRunAt ? <> · next <LocalDate value={r.nextRunAt} /></> : null}
                  {r.reviewFirst ? " · review first" : ""}
                </p>
                {r.clashesWith.length ? (
                  <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="size-3" /> Another rule posts to {r.clashesWith.map(label).join(", ")} at the same time.
                  </p>
                ) : null}
                <div className="flex items-center gap-2 pt-1">
                  <Label className="mr-auto flex items-center gap-2 font-normal">
                    <Switch checked={r.active} disabled={busy} onCheckedChange={(on) => run(async () => unwrap(await setRuleOn(r.id, on)), on ? "Rule on." : "Rule paused.")} />
                    {r.active ? "On" : "Off"}
                  </Label>
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setDraft(fromConfig(r, r.id, tz()))}><Pencil /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Duplicate ${r.name}`} disabled={busy} onClick={() => run(async () => unwrap(await copyRule(r.id)), "Rule copied. The copy starts switched off.")}><Copy /></Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${r.name}`}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Delete the rule “${r.name}”? Its posts stay.`)) run(async () => unwrap(await removeRule(r.id)), "Rule deleted.");
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Presets</CardTitle>
          <CardDescription>Saved rule settings. Start a new rule from one.</CardDescription>
        </CardHeader>
        <CardContent>
          {presets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No presets yet — use “Save as preset” in the rule editor.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <li key={p.id} className="flex items-center gap-1 rounded-lg border border-border py-1 pr-1 pl-2.5 text-sm">
                  <Bookmark className="size-3.5 text-muted-foreground" /> {p.name}
                  <Button size="xs" variant="ghost" onClick={() => setDraft(fromConfig({ ...p, name: `${p.name} rule` }, null, tz()))}>Use</Button>
                  <Button size="icon-xs" variant="ghost" aria-label={`Delete preset ${p.name}`} disabled={busy} onClick={() => run(async () => unwrap(await deletePreset(p.id)), "Preset deleted.")}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Repeat2 className="size-4" /> Re-Share</CardTitle>
          <CardDescription>Recycle your best posts: Re-share copies a post (text, link and media) into a new draft you can change, schedule or queue.</CardDescription>
        </CardHeader>
        <CardContent>
          {published.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to re-share yet — publish a post first.</p>
          ) : (
            <ul className="divide-y divide-border">
              {published.slice(0, 20).map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{p.text}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.publishedAt ? <LocalDate value={p.publishedAt} /> : null} · {p.destinations.map((d) => d.label).join(", ")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const id = unwrap(await duplicatePost(p.id));
                        router.push(`/publish/compose?post=${id}`);
                      }, "Copied into a new draft.")
                    }
                  >
                    <Repeat2 /> Re-share
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={draft !== null} onOpenChange={(o) => (o ? null : setDraft(null))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit rule" : "New Auto Post rule"}</DialogTitle>
            <DialogDescription>Times are read in the rule&apos;s time zone. Publishing costs no credits.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rule-name">Name</Label>
                <Input id="rule-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} />
              </div>
              <div className="space-y-1.5">
                <Label>Days</Label>
                <div className="flex flex-wrap gap-3">
                  {DAYS.map((d, i) => (
                    <Label key={d} className="flex items-center gap-1.5 font-normal">
                      <Checkbox
                        checked={draft.days.includes(i)}
                        onCheckedChange={(on) => setDraft({ ...draft, days: on ? [...draft.days, i].sort() : draft.days.filter((x) => x !== i) })}
                      />
                      {d}
                    </Label>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rule-times">Times (24h, comma-separated)</Label>
                  <Input id="rule-times" value={draft.times} placeholder="09:00, 17:30" onChange={(e) => setDraft({ ...draft, times: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rule-tz">Time zone</Label>
                  <Input id="rule-tz" value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Channels</Label>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {usable.map((d) => (
                    <Label key={d.key} className="flex items-center gap-2 font-normal">
                      <Checkbox
                        checked={draft.providers.includes(d.key)}
                        onCheckedChange={(on) => setDraft({ ...draft, providers: on ? [...draft.providers, d.key] : draft.providers.filter((k) => k !== d.key) })}
                      />
                      <span className="truncate">{d.label}</span>
                    </Label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>What it posts</Label>
                <Select
                  value={draft.mode}
                  onValueChange={(v) => setDraft({ ...draft, mode: v === "generate" ? "generate" : "queue" })}
                  items={[{ value: "queue", label: "The next post in my queue" }, { value: "generate", label: "A new post the AI writes" }]}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="queue">The next post in my queue</SelectItem>
                    <SelectItem value="generate">A new post the AI writes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {draft.mode === "generate" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="rule-seed">Brief for the AI</Label>
                    <Textarea id="rule-seed" value={draft.seedPrompt} onChange={(e) => setDraft({ ...draft, seedPrompt: e.target.value })} placeholder="Who we are, who we're talking to, the tone to use." />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rule-topics">Topics (one per line — used in turn)</Label>
                    <Textarea id="rule-topics" value={draft.topics} onChange={(e) => setDraft({ ...draft, topics: e.target.value })} />
                  </div>
                </>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="rule-links">Links to rotate (one per line, optional)</Label>
                <Textarea id="rule-links" value={draft.links} onChange={(e) => setDraft({ ...draft, links: e.target.value })} placeholder="https://" />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 font-normal">
                  <Switch checked={draft.linkUtm} onCheckedChange={(v) => setDraft({ ...draft, linkUtm: v })} /> Add UTM tags to links
                </Label>
                <Label className="flex items-center gap-2 font-normal">
                  <Switch checked={draft.reviewFirst} onCheckedChange={(v) => setDraft({ ...draft, reviewFirst: v })} /> Hold AI posts as drafts for me to review first
                </Label>
                <Label className="flex items-center gap-2 font-normal">
                  <Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} /> Rule is on
                </Label>
              </div>
              <div className="flex items-end gap-2 border-t border-border pt-3">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="preset-name">Save these settings as a preset</Label>
                  <Input id="preset-name" value={presetName} placeholder="Preset name" onChange={(e) => setPresetName(e.target.value)} />
                </div>
                <Button
                  variant="outline"
                  disabled={busy || !presetName.trim()}
                  onClick={() => {
                    const b = body(draft);
                    run(async () => {
                      unwrap(await savePreset(presetName, { ...b, providers: b.providers }));
                      setPresetName("");
                    }, "Preset saved.");
                  }}
                >
                  <Bookmark /> Save as preset
                </Button>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={busy || !draft || draft.providers.length === 0 || draft.days.length === 0}
              onClick={() => {
                const d = draft;
                if (!d) return;
                run(async () => {
                  unwrap(await saveRule(d.id, body(d)));
                  setDraft(null);
                }, d.id ? "Rule saved." : "Rule created.");
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : null} {draft?.id ? "Save" : "Create rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
